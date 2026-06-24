import type { Item, News, SectorKey } from "@trove/data";

/**
 * A catalog Item with the runtime fields the engine layers on top of the seed.
 * (See specs/02_ENGINE.md "State shape".)
 */
export interface RuntimeItem extends Item {
  /** Open items: units on the floor. Editions: copies in the full run. */
  stock: number;
  /** Editions: copies still claimable. Open items: Infinity. */
  remaining: number;
  /** ownerId → quantity held. "YOU" is the player. */
  owners: Record<string, number>;
  /** Current price. */
  value: number;
  /** Price at the previous cycle boundary (for Δ display). */
  prevValue: number;
  /** Edition copy numbers the player owns (e.g. [2] → "#2 of 3"). */
  myCopies: number[];
  /** Price the player last bought at (for P/L). */
  buyAt?: number;
}

/** An AI trader on the floor. */
export interface Trader {
  name: string;
  cash: number;
  /** Home sector it leans toward, or null for an index-style trader. */
  bias: SectorKey | null;
  /** Poisson countdown until its next action (in cycles). */
  next: number;
}

/** A news story currently influencing sector demand. */
export interface ActiveStory {
  news: News;
  cyclesLeft: number;
}

/** A past headline kept for The Wire archive. */
export interface ArchiveEntry {
  head: string;
  kick: string;
  cycle: number;
}

/** One line of floor activity. */
export interface LogEntry {
  who: string;
  verb: string;
  it: string;
}

/** The full state of one world (Live or Sandbox). */
export interface WorldState {
  cycle: number;
  /** 0..1 progress within the current cycle. */
  cycleFrac: number;
  cash: number;
  debt: number;
  /** Interest per cycle. */
  rate: number;
  items: RuntimeItem[];
  /** Demand index per sector; 1.0 = normal. */
  sectorIdx: Record<SectorKey, number>;
  active: ActiveStory[];
  archive: ArchiveEntry[];
  front: (News & { cycle: number }) | null;
  traders: Trader[];
  log: LogEntry[];
  /** Indices of recently-shown news scenarios (most recent last) — avoids
   *  recycling a story until the pool has moved well past it. */
  recentNewsIdx: number[];
  /** Net-worth history for the chart. */
  nwHist: number[];
}
