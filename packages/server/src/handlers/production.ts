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

  const all = await allPlayers();
  const producers = all.filter(needsProduction);
  if (producers.length === 0) return { producers: 0, worked: 0 };

  const sellerIds = standingSellerIds(producers);

  for (let attempt = 0; ; attempt++) {
    const cur = await loadWorld();
    if (!cur) return { producers: producers.length, worked: 0 };

    const full = docToWorld(cur); // all players' holdings
    const byId = new Map(full.items.map((it) => [it.id, it]));
    const updated: Player[] = [];
    let worked = 0;

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

      // Fold this player's holdings back into the shared doc (others untouched).
      for (const it of pv.items) {
        const f = byId.get(it.id);
        if (!f) continue;
        const v = it.owners["YOU"] ?? 0;
        if (v > 0) f.owners[p.playerId] = v;
        else delete f.owners[p.playerId];
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
      for (const [idStr, delta] of Object.entries(patch.producedDelta)) {
        const id = Number(idStr);
        producedQty[id] = Math.max(0, (producedQty[id] ?? 0) + delta);
      }
      updated.push({ ...seller, cash: seller.cash + patch.cashDelta, producedQty });
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
