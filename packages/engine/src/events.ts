/**
 * Telegraphed market events (Phase 2b, v1). A deterministic, global schedule:
 * the next event is a pure function of the wall clock, so every client AND the
 * server compute the same event with zero coordination. The real impact happens
 * when a caller sets `state.activeEvent` before running the engine — `demandHeat`
 * then boosts that sector exactly like the news does.
 *
 * v1 ships one kind ("surge" = a sector demand spike). The schedule carries a
 * telegraphed RANGE but resolves to an exact magnitude, so the payoff is still a
 * reveal. A headline can be attached later by the newsroom cron for flavour.
 */
export interface MarketEvent {
  slot: number;
  sector: string;
  kind: "surge";
  /** Resolved demand multiplier applied while active, e.g. 1.19. */
  mult: number;
  /** Telegraphed magnitude range in %, e.g. [10, 30]. */
  range: [number, number];
  /** ms epoch — when it goes live. */
  fireAt: number;
  /** ms epoch — when it ends. */
  endAt: number;
}

const SLOT_MS = 20 * 60 * 1000; // a new event slot every 20 real minutes
const ACTIVE_MS = 7 * 60 * 1000; // live for the last 7 minutes of its slot
const LO = 0.1; // +10% min surge
const HI = 0.3; // +30% max surge

/** Deterministic 0..1 hash of an integer. */
function hash01(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function eventForSlot(
  slot: number,
  sectors: readonly string[],
): MarketEvent {
  const a = hash01(slot);
  const b = hash01(slot * 7 + 13);
  const sector =
    sectors.length > 0 ? sectors[Math.floor(a * sectors.length)]! : "market";
  const pct = LO + b * (HI - LO);
  const start = slot * SLOT_MS;
  return {
    slot,
    sector,
    kind: "surge",
    mult: 1 + pct,
    range: [Math.round(LO * 100), Math.round(HI * 100)],
    fireAt: start + (SLOT_MS - ACTIVE_MS),
    endAt: start + SLOT_MS,
  };
}

/** The event currently live (inside its active window), or null. */
export function activeMarketEvent(
  now: number,
  sectors: readonly string[],
): MarketEvent | null {
  const ev = eventForSlot(Math.floor(now / SLOT_MS), sectors);
  return now >= ev.fireAt && now < ev.endAt ? ev : null;
}

/** The next event to fire — this slot's if it hasn't fired yet, else the next. */
export function nextMarketEvent(
  now: number,
  sectors: readonly string[],
): MarketEvent {
  const slot = Math.floor(now / SLOT_MS);
  const ev = eventForSlot(slot, sectors);
  return now < ev.fireAt ? ev : eventForSlot(slot + 1, sectors);
}
