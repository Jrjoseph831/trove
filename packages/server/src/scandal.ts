/**
 * Regulatory scandal — injects a price shock and live news article into the
 * shared world when a player's bust roll fires in production.ts.
 *
 * All mutations land on the `full` WorldState that the production Lambda
 * commits at the end of its tick, making them atomic with the cash fine and
 * heat reset on the busted player's record.
 */
import { items as catalog } from "@trove/data";
import type { News } from "@trove/data";
import type { WorldState } from "@trove/engine";
import type { Player } from "./repo";

const catById = new Map(catalog.map((it) => [it.id, it]));

/** Top sector by summed item-weight across a set of item IDs. */
function primarySector(itemIds: number[]): string | null {
  const tally: Record<string, number> = {};
  for (const id of itemIds) {
    const c = catById.get(id);
    if (!c) continue;
    for (const [sector, w] of Object.entries(c.weights)) {
      tally[sector] = (tally[sector] ?? 0) + w;
    }
  }
  let best: string | null = null;
  let bestW = -1;
  for (const [s, w] of Object.entries(tally)) {
    if (w > bestW) {
      bestW = w;
      best = s;
    }
  }
  return best;
}

/**
 * Shock the shared world when a player is busted:
 *   1. Dock produced item prices −15% immediately (price.value in full.items)
 *   2. Push a scandal ActiveStory — sector demand −12% for 2 market cycles
 *      (12 real hours), propagated by the next settleCycle pass
 *   3. Take the front page and add a Wire archive entry
 *
 * No-op if the player has no produced goods — a player with no brand can't be
 * publicly implicated (the fine and heat reset still fire on the caller side).
 */
export function applyScandal(
  full: WorldState,
  player: Player,
  cycle: number,
): void {
  const producedIds = new Set(
    Object.keys(player.producedQty ?? {})
      .map(Number)
      .filter((id) => (player.producedQty?.[id] ?? 0) > 0),
  );
  if (producedIds.size === 0) return;

  const sector = primarySector([...producedIds]);
  const firmName = player.name ?? "a market operator";

  // 1. Direct price shock on the firm's produced goods.
  //    Shell Brands (Shadow T2): front companies absorb scrutiny, halving the hit.
  const shockMul = (player.unlockedNodes ?? []).includes("shell-brands") ? 0.92 : 0.85;
  for (const it of full.items) {
    if (producedIds.has(it.id)) {
      it.prevValue = it.value;
      it.value = Math.max(1, Math.round(it.value * shockMul * 100) / 100);
    }
  }

  // 2. Sector ripple: a negative-demand story active for 2 cycles.
  //    settleCycle picks this up and applies effects[] to sectorIdx — the
  //    same path every normal news story uses, so correlated brands drift
  //    down naturally over the next market cycle.
  const story: News = {
    id: `scandal-${player.playerId}-${cycle}`,
    kick: "REGULATORY ACTION",
    head: `Authorities move against ${firmName}`,
    body: `TROVE regulators have initiated formal proceedings against ${firmName} following documented market irregularities. Operations under review; contracted parties are advised to seek alternative sourcing.`,
    effects: sector ? { [sector]: -0.12 } : {},
    dur: 2,
    weight: 0,
  };
  full.active.push({ news: story, cyclesLeft: story.dur });

  // 3. Front page — a live regulatory bust takes precedence.
  full.front = { ...story, cycle };

  // 4. Archive entry persists after the story expires so the Wire's history
  //    shows what happened to latecomers.
  full.archive.push({ head: story.head, kick: story.kick, cycle });
}
