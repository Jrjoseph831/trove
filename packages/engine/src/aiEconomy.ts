/**
 * @trove/engine — AI companies as real economic actors.
 *
 * Two extensions to the base model (see specs/02_ENGINE.md):
 *  1. A "ripple" multiplier that ties AI income/aggression to how much real
 *     players are actually doing, so the world doesn't stay static while a
 *     player gets rich. Bounded — it can only ever raise AI activity above the
 *     already-invariant-tested flat baseline, never below it.
 *  2. AI virtual material consumption (added in a later step of this file's
 *     build-out) — AI companies draw on the same shared item stock a player's
 *     factory would, without needing per-company Factory objects.
 *
 * Hard constraint: nothing in this file may call `rand()` from ./rng. Every
 * new draw would shift the RNG sequence for everything settleCycle runs after
 * it, silently changing existing tests' concrete values. Use the deterministic
 * hash pattern instead where variety is needed (see companies.ts `hash01`).
 */
import type { WorldState } from "./types";

// ── Real-player activity → the ripple multiplier ────────────────────────────

/** Sum of qty×value across every item owner that ISN'T an AI trader — i.e. the
 *  real players' footprint on the shared floor (goods produced/bought), not
 *  idle cash sitting in a wallet. Works unmodified in both contexts the engine
 *  runs in: the live shared doc (non-trader owner keys are real player ids,
 *  already folded in by the production Lambda — no new I/O here) and sandbox
 *  (the only non-trader key is "YOU"). */
export function realPlayerFootprint(state: WorldState): number {
  const traderNames = new Set(state.traders.map((t) => t.name));
  let v = 0;
  for (const it of state.items) {
    for (const [owner, qty] of Object.entries(it.owners)) {
      if (!traderNames.has(owner)) v += qty * it.value;
    }
  }
  return v;
}

/** Smoothing for the activity EMA — roughly a 1–2 day time constant at the
 *  6h settlement cadence, so a single big trade doesn't jerk the ripple. */
const ACTIVITY_EMA_ALPHA = 0.15;
/** Footprint ($) representing "about one active player running a couple of
 *  lines" — the reference point the ripple's log curve is scaled against. */
const ACTIVITY_REFERENCE = 150_000;
const RIPPLE_MIN = 1.0;
const RIPPLE_MAX = 1.5;
const RIPPLE_K = 0.18;

/** Refresh the rolling activity EMA from the current footprint. Must run
 *  BEFORE settleCycle's step 0 (accrueIncome) so this cycle's income already
 *  reflects it — see settleCycle's call order. */
export function updatePlayerActivity(state: WorldState): void {
  const raw = realPlayerFootprint(state);
  const prev = state.playerActivityEma ?? 0;
  state.playerActivityEma = prev + (raw - prev) * ACTIVITY_EMA_ALPHA;
}

/** Bounded, monotonic multiplier from the activity EMA: exactly 1.0 on a
 *  dormant world (no player footprint yet — byte-identical to the old flat
 *  behavior), rising smoothly toward 1.5 as real-player activity grows, never
 *  beyond it. log10-compressed so it can't run away with a single huge spike. */
export function rippleMultiplier(state: WorldState): number {
  const ema = state.playerActivityEma ?? 0;
  const ratio = ema / ACTIVITY_REFERENCE;
  const raw = 1 + RIPPLE_K * Math.log10(1 + Math.max(0, ratio));
  return Math.max(RIPPLE_MIN, Math.min(RIPPLE_MAX, raw));
}
