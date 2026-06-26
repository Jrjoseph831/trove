import type { WorldState } from "@trove/engine";

/** Phase 1 — The Ladder. A snappy progression spine: your rank climbs with net
 *  worth, each tier unlocks something, and there's always a visible next goal.
 *  Early tiers are intentionally close together so a new viewer sees an unlock
 *  within minutes. */
export interface Tier {
  name: string;
  /** Net worth needed to reach this tier. */
  at: number;
  /** Short headline of what this tier unlocks. */
  unlock: string;
  blurb: string;
  /** Feature this tier gates, if any (only "factory" is enforced in v1). */
  gate?: "factory" | "modules" | "expand" | "multiplayer" | "automation";
}

export const LADDER: Tier[] = [
  { name: "Trader", at: 0, unlock: "Catalog & Order Desk", blurb: "Buy low, sell high." },
  { name: "Dealer", at: 35_000, unlock: "Factory — build a production line", blurb: "Make it, don't just trade it.", gate: "factory" },
  { name: "Manufacturer", at: 80_000, unlock: "Line modules — engineer your lines", blurb: "Tune output, upkeep, quality.", gate: "modules" },
  { name: "Operator", at: 200_000, unlock: "Floor expansion & in-house supply", blurb: "Scale the floor.", gate: "expand" },
  { name: "Industrialist", at: 600_000, unlock: "Multiplayer order routing", blurb: "Fill real players' orders.", gate: "multiplayer" },
  { name: "Magnate", at: 2_500_000, unlock: "Automation — Auto-Router & more", blurb: "Run it hands-off.", gate: "automation" },
  { name: "Titan", at: 10_000_000, unlock: "Titan status", blurb: "Top of the board." },
];

export function tierIndexFor(nw: number): number {
  let i = 0;
  for (let k = 0; k < LADDER.length; k++) if (nw >= LADDER[k]!.at) i = k;
  return i;
}
export function tierFor(nw: number): Tier {
  return LADDER[tierIndexFor(nw)]!;
}
export function nextTierFor(nw: number): Tier | null {
  const i = tierIndexFor(nw);
  return i + 1 < LADDER.length ? LADDER[i + 1]! : null;
}
/** 0..1 progress through the current tier's band toward the next. */
export function bandProgress(nw: number): number {
  const i = tierIndexFor(nw);
  const cur = LADDER[i]!.at;
  const nxt = LADDER[i + 1]?.at;
  if (nxt == null) return 1;
  return Math.max(0, Math.min(1, (nw - cur) / (nxt - cur)));
}

// ── Peak net worth (so your rank never drops mid-stream) ─────────────────────
// Stored client-side per browser. Permanent server-side peak is a v2 follow-up.
const PEAK_KEY = "trove.ladder.peak";
export function getPeak(): number {
  if (typeof window === "undefined") return 0;
  const v = Number(window.localStorage.getItem(PEAK_KEY) ?? "0");
  return Number.isFinite(v) ? v : 0;
}
export function bumpPeak(nw: number): number {
  const p = getPeak();
  if (nw > p && typeof window !== "undefined") {
    window.localStorage.setItem(PEAK_KEY, String(Math.round(nw)));
    return nw;
  }
  return Math.max(p, nw);
}

/** Whether a gated feature is open: the gating tier is reached, or the player is
 *  grandfathered by having already used it (so we never lock anyone out of what
 *  they already built). */
export function gateUnlocked(
  gate: NonNullable<Tier["gate"]>,
  peak: number,
  state: WorldState,
): boolean {
  const at = LADDER.find((t) => t.gate === gate)?.at ?? 0;
  if (peak >= at) return true;
  if (gate === "factory" || gate === "modules")
    return (state.factories?.length ?? 0) > 0;
  if (gate === "expand") return (state.floorSlots ?? 0) > 2;
  return false;
}
