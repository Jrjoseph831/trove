/**
 * Settlement Lambda — the heartbeat of the shared world.
 *
 * Triggered by EventBridge on the UTC 6h marks (00/06/12/18). It hydrates the
 * world, runs the engine's `settleCycle` (the exact same code the client sandbox
 * runs), and writes it back. The server owns the clock; no client input can
 * advance it. Idempotent and self-healing: it catches up to the wall-clock cycle
 * if a fire was missed, capped so a long outage can't roll a hundred stories.
 */
import { settleCycle, wallCycle } from "@trove/engine";
import {
  docToWorld,
  loadWorld,
  saveWorld,
  seedWorld,
  worldToDoc,
} from "../repo";

const MAX_CATCHUP = 4; // at most ~1 day of missed cycles rolled in one run

export async function handler(): Promise<{ settled: number; cycle: number }> {
  const cur = await loadWorld();
  if (!cur) {
    const seeded = await seedWorld();
    console.log(`seeded Live world at cycle ${seeded.cycle}`);
    return { settled: 0, cycle: seeded.cycle };
  }

  const target = wallCycle();
  if (cur.cycle >= target) {
    console.log(`already settled through cycle ${cur.cycle} (target ${target})`);
    return { settled: 0, cycle: cur.cycle };
  }

  const state = docToWorld(cur);
  let settled = 0;
  while (state.cycle < target && settled < MAX_CATCHUP) {
    settleCycle(state);
    settled++;
  }

  const next = worldToDoc(state, cur.version + 1);
  await saveWorld(next, cur.version);
  console.log(`settled ${settled} cycle(s) → ${next.cycle}; front: ${next.front?.head ?? "—"}`);
  return { settled, cycle: next.cycle };
}
