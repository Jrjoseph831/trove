/**
 * Production Lambda — the FAST factory clock (every few minutes), decoupled from
 * the 6h market settlement so the floor feels alive. For each producer it:
 *   0. settles any STANDING supply orders whose input is short, directly
 *      against the seller's live storefront (see ../standingOrders) — BEFORE
 *      production runs, so the same tick can consume what was just delivered,
 *   1. advances their factories on the production tick (wallProdCycle) — lines
 *      come online and produce a batch every PROD_SEC_PER_CYCLE; output folds
 *      into the shared world doc under their player id,
 *   2. runs rep-gated Auto-Fulfill against the freshly-produced stock,
 *   3. captures a report row per 6h market flip (wallCycle) from the flows
 *      accumulated across the period, so the Trove-day calendar (2 flips/day)
 *      stays intact even though production runs much faster.
 *
 * World doc (produced holdings) + the affected player records — INCLUDING any
 * standing-order seller who isn't otherwise a producer this tick — commit in
 * ONE transaction under the world version, so a racing trade (or another
 * production tick) can't split the write. Everything above lives inside the
 * retry loop below, so a lost race recomputes shortfalls/seller stock against
 * a fresh read rather than replaying stale numbers.
 */
import {
  autoFulfillOrders,
  captureFlip,
  runProduction,
  wallCycle,
  wallProdCycle,
  type WorldState,
} from "@trove/engine";
import {
  allPlayers,
  commitSettlement,
  docToWorld,
  extractPlayer,
  getPlayers,
  holdingsOf,
  setPlayerHoldings,
  loadWorld,
  playerView,
  worldToDoc,
  type Player,
  type WorldDoc,
} from "../repo";
import { planStandingSettlements } from "../standingOrders";

const MAX_PROD_CATCHUP = 12; // ~1h of ticks if the cron was down; else 1/run
const MAX_FLIP_CATCHUP = 4; // ~1 day of missed report flips
const RETRIES = 4;
/** DynamoDB caps a transaction at 100 items; 1 is always reserved for the
 *  world doc. Standing-order sellers who AREN'T already producers this tick
 *  compete for whatever's left after every producer claims a slot. */
const TX_ITEM_CAP = 99;

/** A player needs the production pass if they run a line, list produced stock,
 *  or have Auto-Fulfill armed (delivers ready contracts on this beat). */
function needsProduction(p: Player): boolean {
  return (
    (p.factories?.length ?? 0) > 0 ||
    Object.values(p.listed ?? {}).some(Boolean) ||
    !!p.deskAuto?.autoFulfill
  );
}

/** Every seller id any of these players' factories reference via a standing
 *  source — a cheap, synchronous scan (no I/O) so the caller only fetches
 *  the sellers actually referenced this tick, not the whole player table. */
function standingSellerIds(producers: Player[]): string[] {
  const ids = new Set<string>();
  for (const p of producers) {
    for (const f of p.factories ?? []) {
      for (const src of Object.values(f.standingSources ?? {})) ids.add(src.sellerId);
    }
  }
  return [...ids];
}

export async function handler(): Promise<{ producers: number; worked: number }> {
  const now = Date.now();
  const prodTarget = wallProdCycle(now);
  const flipTarget = wallCycle(now);

  for (let attempt = 0; ; attempt++) {
    // Players are re-read EVERY attempt rather than hoisted out of the loop.
    // Player writes are guarded on each record's rev now, so a retry that
    // re-sent the records from the first read would lose the same race every
    // time and the tick would silently produce nothing. Fresh reads are what
    // make the retry mean anything.
    const all = await allPlayers();

    // Finish moving goods off the shared world record. /portfolio migrates an
    // account when its owner loads the game, but that leaves anyone who hasn't
    // logged in stranded — and their goods can't be stripped from the doc until
    // they've landed somewhere else. This runs every tick over every player, so
    // the migration completes on its own rather than depending on who shows up.
    // The write is conditional on `holdings` being absent, so it can never
    // overwrite a real trade, and a first-load race just fails harmlessly.
    if (attempt === 0) {
      const cur0 = await loadWorld();
      const stale = cur0 ? all.filter((p) => !p.holdings) : [];
      for (const p of stale) {
        try {
          await setPlayerHoldings(p.playerId, holdingsOf(cur0 as WorldDoc, p));
        } catch (err) {
          if ((err as { name?: string }).name !== "ConditionalCheckFailedException") throw err;
        }
      }
      if (stale.length) console.log(`migrated holdings for ${stale.length} player(s)`);
    }

    const producers = all.filter(needsProduction);
    if (producers.length === 0) return { producers: 0, worked: 0 };

    const sellerIds = standingSellerIds(producers);

    const cur = await loadWorld();
    if (!cur) return { producers: producers.length, worked: 0 };

    const full = docToWorld(cur); // all players' holdings
    const byId = new Map(full.items.map((it) => [it.id, it]));
    const updated: Player[] = [];
    let worked = 0;

    // Reclaim the space: drop player goods from the shared record now that they
    // live on the players' own. ONLY for accounts proven to have migrated — an
    // owner id with no record, or a record the backfill hasn't reached, is left
    // exactly where it is and reported. Deleting goods we can't account for is
    // the one outcome worth avoiding entirely, so the check is "prove it's safe"
    // rather than "assume it is".
    const houses = new Set(full.traders.map((t) => t.name));
    const migrated = new Set(all.filter((p) => p.holdings).map((p) => p.playerId));
    let dropped = 0;
    const orphans = new Set<string>();
    for (const it of full.items) {
      for (const owner of Object.keys(it.owners)) {
        if (houses.has(owner)) continue; // AI holdings stay resident
        if (migrated.has(owner)) {
          delete it.owners[owner];
          dropped++;
        } else {
          orphans.add(owner);
        }
      }
    }
    if (dropped) console.log(`world doc: dropped ${dropped} migrated player entries`);
    if (orphans.size) {
      console.warn(
        `world doc: ${orphans.size} owner id(s) with no migrated record — KEPT: ` +
          [...orphans].join(", "),
      );
    }

    // Build every producer's player-view UP FRONT (rather than inline per
    // producer, as before) so the standing-order pre-step and the main loop
    // below share the exact same view objects — a fill's cash/item mutation
    // is then just... already there by the time production runs on it.
    const pvById = new Map<string, WorldState>();
    for (const p of producers) {
      const pv = playerView(cur as WorldDoc, p);
      // Standing sources are evaluated against the FAST production-tick basis
      // (Factory.onlineCycle is stamped from wallProdCycle, per buildFactory),
      // not the slow 6h world cycle playerView defaults `.cycle` to.
      pv.cycle = prodTarget;
      pvById.set(p.playerId, pv);
    }

    // 0. Standing-order settlement pre-step (no-op, zero extra I/O, if nobody
    //    has one configured — the common case while this feature is new).
    const touchedByFill = new Set<string>();
    let sellerPatches: ReturnType<typeof planStandingSettlements>["sellerPatches"] = new Map();
    let sellersById = new Map<string, Player>();
    if (sellerIds.length) {
      const sellers = await getPlayers(sellerIds);
      sellersById = new Map(sellers.map((s) => [s.playerId, s]));
      const txBudget = Math.max(0, TX_ITEM_CAP - producers.length);
      const plan = planStandingSettlements(cur as WorldDoc, full, producers, pvById, sellers, txBudget);
      sellerPatches = plan.sellerPatches;
      for (const f of plan.fills) {
        touchedByFill.add(f.buyerId);
        if (pvById.has(f.sellerId)) touchedByFill.add(f.sellerId); // seller also a producer
      }
    }

    for (const p of producers) {
      const pv = pvById.get(p.playerId)!;
      let changed = touchedByFill.has(p.playerId);

      // 1. Factory production on the fast clock. A brand-new producer starts one
      //    tick back so its first run produces a batch (and persists lastProdTick);
      //    otherwise it would sit at `prodTarget`, never enter the loop, never get
      //    saved, and never produce anything.
      let tick = p.lastProdTick ?? prodTarget - 1;
      pv.cycle = tick;
      let pc = 0;
      while (tick < prodTarget && pc < MAX_PROD_CATCHUP) {
        tick++;
        pv.cycle = tick;
        runProduction(pv);
        pc++;
        changed = true;
      }

      // 2. Auto-Fulfill ready contracts (no-op unless armed + coverable).
      if (autoFulfillOrders(pv, now)) changed = true;

      // 3. Report capture per 6h market flip.
      let flip = p.lastFlip ?? flipTarget;
      let fc = 0;
      while (flip < flipTarget && fc < MAX_FLIP_CATCHUP) {
        captureFlip(pv);
        flip++;
        fc++;
        changed = true;
      }

      if (!changed) continue;
      worked++;

      // The player's own goods are captured by extractPlayer below, onto their
      // record — NOT folded back into the shared doc any more. Writing them
      // here would just re-add what the strip above removed, every tick.
      //
      // What still has to fold back is any OTHER owner the engine created
      // during this tick: playerView leaves only "YOU" in this map, so anything
      // else is an AI house taking delivery of a contract via autoFulfillOrders.
      // Those are deltas from zero, so they add on.
      for (const it of pv.items) {
        const f = byId.get(it.id);
        if (!f) continue;
        delete f.owners[p.playerId]; // belt and braces with the strip above
        for (const [owner, qty] of Object.entries(it.owners)) {
          if (owner === "YOU" || !(qty > 0)) continue;
          f.owners[owner] = (f.owners[owner] ?? 0) + qty;
        }
      }
      updated.push({ ...extractPlayer(pv, p), lastProdTick: tick, lastFlip: flip });
    }

    // Standing-order sellers who AREN'T otherwise producers this tick have no
    // pv of their own to fold — apply their patch straight onto their loaded
    // record instead (their item-ownership delta was already written onto
    // `full`/`byId` directly by the planner).
    for (const [sellerId, patch] of sellerPatches) {
      const seller = sellersById.get(sellerId);
      if (!seller) continue;
      const producedQty = { ...(seller.producedQty ?? {}) };
      // Goods leave the seller's OWN record now, not just the doc.
      const holdings = { ...holdingsOf(cur as WorldDoc, seller) };
      for (const [idStr, delta] of Object.entries(patch.holdingsDelta)) {
        const id = Number(idStr);
        const left = (holdings[id] ?? 0) + delta;
        if (left > 0) holdings[id] = left;
        else delete holdings[id];
      }
      for (const [idStr, delta] of Object.entries(patch.producedDelta)) {
        const id = Number(idStr);
        producedQty[id] = Math.max(0, (producedQty[id] ?? 0) + delta);
      }
      updated.push({ ...seller, cash: seller.cash + patch.cashDelta, producedQty, holdings });
    }

    if (updated.length === 0) return { producers: producers.length, worked: 0 };

    const next = worldToDoc(full, cur.version + 1);
    try {
      await commitSettlement(next, cur.version, updated);
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (
        (name === "TransactionCanceledException" ||
          name === "ConditionalCheckFailedException") &&
        attempt < RETRIES
      ) {
        console.log(`production raced (attempt ${attempt}); retrying`);
        continue;
      }
      throw err;
    }
    console.log(`production: ${worked}/${producers.length} producer(s) advanced → cycle ${next.cycle}`);
    return { producers: producers.length, worked };
  }
}
