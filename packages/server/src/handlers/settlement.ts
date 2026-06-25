/**
 * Settlement Lambda — the heartbeat of the shared world.
 *
 * Triggered by EventBridge on the UTC 6h marks (00/06/12/18). It hydrates the
 * world, runs the engine's `settleCycle` (the exact same code the client sandbox
 * runs) to advance prices/news/sectors, then runs each player's own per-cycle
 * work — factories produce, listings sell, the report row is captured — against
 * those freshly-settled prices via `settlePlayerCycle`. World doc (with the newly
 * produced holdings) and the affected player records commit in ONE transaction
 * guarded by the world version, so a racing trade can't split the write.
 *
 * The server owns the clock; no client input can advance it. Idempotent and
 * self-healing: it catches up to the wall-clock cycle if a fire was missed,
 * capped so a long outage can't roll a hundred stories — and because production
 * is gated on the world cycle advancing, a retry never double-produces.
 */
import {
  autoFulfillOrders,
  settleCycle,
  settlePlayerCycle,
  wallCycle,
} from "@trove/engine";
import {
  allPlayers,
  commitSettlement,
  docToWorld,
  extractPlayer,
  loadWorld,
  playerView,
  seedWorld,
  worldToDoc,
  type Player,
} from "../repo";

const MAX_CATCHUP = 4; // at most ~1 day of missed cycles rolled in one run
const RETRIES = 4;

/** A player needs settlement work if they run a line, list produced stock, or
 *  have Auto-Fulfill armed (which delivers ready contracts on the heartbeat). */
function needsSettlement(p: Player): boolean {
  return (
    (p.factories?.length ?? 0) > 0 ||
    Object.values(p.listed ?? {}).some(Boolean) ||
    !!p.deskAuto?.autoFulfill
  );
}

export async function handler(): Promise<{ settled: number; cycle: number; producers: number }> {
  for (let attempt = 0; ; attempt++) {
    const cur = await loadWorld();
    if (!cur) {
      const seeded = await seedWorld();
      console.log(`seeded Live world at cycle ${seeded.cycle}`);
      return { settled: 0, cycle: seeded.cycle, producers: 0 };
    }

    const target = wallCycle();
    if (cur.cycle >= target) {
      console.log(`already settled through cycle ${cur.cycle} (target ${target})`);
      return { settled: 0, cycle: cur.cycle, producers: 0 };
    }

    // 1. Advance the shared market (prices/news/sectors) on the singleton.
    const full = docToWorld(cur);
    let settled = 0;
    while (full.cycle < target && settled < MAX_CATCHUP) {
      settleCycle(full);
      settled++;
    }

    // 2. Run each producer's own factories/listings against the new prices.
    //    Project from a doc carrying the settled prices but the pre-settlement
    //    holdings, then fold produced output back into `full` under each id.
    const priced = worldToDoc(full, cur.version + 1);
    const players = await allPlayers();
    const now = Date.now();
    const byId = new Map(full.items.map((it) => [it.id, it]));
    const updated: Player[] = [];
    for (const p of players) {
      if (!needsSettlement(p)) continue;
      const pv = playerView(priced, p);
      for (let i = 0; i < settled; i++) settlePlayerCycle(pv);
      // Auto-Fulfill (rep-gated): deliver any accepted order now coverable by
      // freshly-produced stock. No-op unless the player has it armed.
      autoFulfillOrders(pv, now);
      for (const it of pv.items) {
        const f = byId.get(it.id);
        if (!f) continue;
        const v = it.owners["YOU"] ?? 0;
        if (v > 0) f.owners[p.playerId] = v;
        else delete f.owners[p.playerId];
      }
      updated.push({ ...extractPlayer(pv, p), lastCycle: full.cycle });
    }

    // 3. Commit holdings + producers atomically under the world version.
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
        console.log(`settlement raced (attempt ${attempt}); retrying`);
        continue;
      }
      throw err;
    }
    console.log(
      `settled ${settled} cycle(s) → ${next.cycle}; ${updated.length} producer(s); front: ${next.front?.head ?? "—"}`,
    );
    return { settled, cycle: next.cycle, producers: updated.length };
  }
}
