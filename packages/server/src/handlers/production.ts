/**
 * Production Lambda — the FAST factory clock (every few minutes), decoupled from
 * the 6h market settlement so the floor feels alive. For each producer it:
 *   1. advances their factories on the production tick (wallProdCycle) — lines
 *      come online and produce a batch every PROD_SEC_PER_CYCLE; output folds
 *      into the shared world doc under their player id,
 *   2. runs rep-gated Auto-Fulfill against the freshly-produced stock,
 *   3. captures a report row per 6h market flip (wallCycle) from the flows
 *      accumulated across the period, so the Trove-day calendar (2 flips/day)
 *      stays intact even though production runs much faster.
 *
 * World doc (produced holdings) + the affected player records commit in ONE
 * transaction under the world version, so a racing trade can't split the write.
 * Production is gated on the tick advancing, so a retry never double-produces.
 */
import {
  autoFulfillOrders,
  captureFlip,
  runProduction,
  wallCycle,
  wallProdCycle,
} from "@trove/engine";
import {
  allPlayers,
  commitSettlement,
  docToWorld,
  extractPlayer,
  loadWorld,
  playerView,
  worldToDoc,
  type Player,
  type WorldDoc,
} from "../repo";

const MAX_PROD_CATCHUP = 12; // ~1h of ticks if the cron was down; else 1/run
const MAX_FLIP_CATCHUP = 4; // ~1 day of missed report flips
const RETRIES = 4;

/** A player needs the production pass if they run a line, list produced stock,
 *  or have Auto-Fulfill armed (delivers ready contracts on this beat). */
function needsProduction(p: Player): boolean {
  return (
    (p.factories?.length ?? 0) > 0 ||
    Object.values(p.listed ?? {}).some(Boolean) ||
    !!p.deskAuto?.autoFulfill
  );
}

export async function handler(): Promise<{ producers: number; worked: number }> {
  const now = Date.now();
  const prodTarget = wallProdCycle(now);
  const flipTarget = wallCycle(now);

  const all = await allPlayers();
  const producers = all.filter(needsProduction);
  if (producers.length === 0) return { producers: 0, worked: 0 };

  for (let attempt = 0; ; attempt++) {
    const cur = await loadWorld();
    if (!cur) return { producers: producers.length, worked: 0 };

    const full = docToWorld(cur); // all players' holdings
    const byId = new Map(full.items.map((it) => [it.id, it]));
    const updated: Player[] = [];
    let worked = 0;

    for (const p of producers) {
      const pv = playerView(cur as WorldDoc, p);
      let changed = false;

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
