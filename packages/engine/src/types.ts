import type { CompanyTier, Item, News, SectorKey } from "@trove/data";

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

/** An AI company on the floor — a real economic actor with a treasury. */
export interface Trader {
  name: string;
  cash: number;
  /** Home sector it leans toward, or null for an index-style trader. */
  bias: SectorKey | null;
  /** Poisson countdown until its next action (in cycles). */
  next: number;
  /** Size tier — drives income, reserve floor, and max order size. */
  tier?: CompanyTier;
  /** Revenue added to the treasury each cycle (keeps the big names afloat). */
  income?: number;
}

/** A production line the player owns. Economics (rate/upkeep/recipe) are derived
 *  live from the output item via @trove/data, so only identity + timing persist. */
export interface Factory {
  id: string;
  /** Output item id. */
  itemId: number;
  /** Cycle it was built. */
  builtCycle: number;
  /** Cycle it comes online and starts producing. */
  onlineCycle: number;
  /** Installed line-module ids (engineer the line's economics). */
  modules: string[];
  /** Shipping bay this line routes to (undefined = auto by slot order). */
  bay?: number;
  /** Per-input sourcing: input itemId → feeder line id that makes it in-house.
   *  Absent for an input = bought from the market (auto-supplied). */
  sources?: Record<number, string>;
  /** Last settle outcome, for UI: building → running → idle (short on inputs). */
  status: "building" | "running" | "idle";
}

/** A bulk contract on the player's desk (sandbox). A client opens with a visible
 *  `companyOffer` and haggles within a HIDDEN budget; once a price is agreed the
 *  order flips to "accepted" and is fulfilled from the vault by the deadline. */
export interface Order {
  id: string;
  /** End-user client firm requesting the goods. */
  company: string;
  sector: SectorKey;
  itemId: number;
  qty: number;
  /** The client's current visible offer (negotiate up from here). */
  companyOffer: number;
  /** HIDDEN — the most they'll pay. */
  budget: number;
  /** HIDDEN — at/below this they accept on the spot. */
  target: number;
  round: number;
  maxRounds: number;
  /** Agreed payout once accepted (0 while negotiating). */
  quote: number;
  status: "offer" | "accepted";
  createdAt: number;
  expiresAt: number;
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

/** Order-Desk automation, unlocked by reputation. */
export interface DeskAuto {
  /** Procurement Specialist: auto-negotiates incoming offers. */
  specialist: boolean;
  /** Auto-delivers accepted orders once you have the stock. */
  autoFulfill: boolean;
  /** Margin floor the specialist holds: agreed price ≥ source value × (1+this). */
  minMargin: number;
}

/** A player's company website (the manufacturing storefront). Public-facing,
 *  built from their LISTED produced goods — list it in the Vault and it appears
 *  on the site, unlist it and it's hidden. Identity + storefront only; private
 *  vault holdings and net worth never go on the site. */
export type SiteSectionId =
  | "masthead"
  | "about"
  | "storefront"
  | "standing"
  | "contact";

export interface SiteSection {
  id: SiteSectionId;
  /** Whether the section renders (masthead + storefront are always on). */
  on: boolean;
}

export interface SiteConfig {
  /** URL handle / sidebar slug (derived from the holding name, editable). */
  handle: string;
  /** One-line headline under the company name. */
  tagline?: string;
  /** The "About / The House" body copy. */
  about?: string;
  /** Accent theme for the page. */
  accent?: "gold" | "steel" | "ink";
  /** Section order + visibility (modular builder). */
  sections?: SiteSection[];
  /** Live on the directory? Drafts stay private to the owner. */
  published?: boolean;
}

/** A player-to-player bulk order (multiplayer routing). A buyer requests goods
 *  from a seller's storefront; one counter round of haggling, then it settles
 *  atomically (goods seller→buyer, cash buyer→seller). `turn` is whose move it
 *  is; `price` is the current total on the table (the buyer's offer, or the
 *  seller's counter once they've used their one counter). */
export interface PvpOrder {
  id: string;
  sellerId: string;
  sellerName: string;
  buyerId: string;
  buyerName: string;
  itemId: number;
  itemName: string;
  qty: number;
  /** Current total price on the table. */
  price: number;
  /** Whose move it is: the seller (a fresh offer) or the buyer (after a counter). */
  turn: "seller" | "buyer";
  /** The seller has used their one counter. */
  countered: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Floor-wide infrastructure upgrades (one-time buys that boost every line). */
export interface Infra {
  /** Power Plant — −20% upkeep on every line. */
  power: boolean;
  /** Auto-Router — +1 belt lane per bay. */
  router: boolean;
  /** QC Hub — +6% on everything you sell. */
  qc: boolean;
}

/** Per-item flow within a period (for the report's item-detail breakdown). */
export interface ItemFlow {
  produced: number;
  sold: number; // units sold (listing + order + market)
  soldRev: number;
  bought: number;
  spent: number;
}

/** Running tally of cash/goods flows within the current report period. */
export interface Ledger {
  produced: number; // units produced
  listingUnits: number; // units sold via your market listings
  listingRev: number;
  orderUnits: number; // units delivered on accepted orders
  orderRev: number;
  bought: number; // units bought from the market
  spent: number; // cash spent buying
  soldUnits: number; // units dumped back to market
  soldRev: number;
  upkeep: number; // factory upkeep + input spend
  /** Per-item breakdown (itemId → flow). */
  items: Record<number, ItemFlow>;
}

/** A snapshot captured each "flip" (settlement) — one row of the report log. */
export interface Report {
  /** Absolute period index (continuous across sessions). */
  period: number;
  /** Trove day (2 flips per in-game day). */
  day: number;
  /** 0 = first half (AM), 1 = second half (PM). */
  half: 0 | 1;
  /** Real ms when captured (stamped by the client; 0 until then). */
  at: number;
  netWorth: number;
  cash: number;
  assets: number;
  debt: number;
  flows: Ledger;
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
  /** Player-owned production lines. */
  factories: Factory[];
  /** Factory-floor capacity: how many lines can run at once. Expandable. */
  floorSlots: number;
  /** Installed floor infrastructure upgrades. */
  infra: Infra;
  /** Transient: the live telegraphed market event boosting a sector's demand
   *  this tick (set from the wall clock by the caller; null/undefined = none). */
  activeEvent?: { sector: SectorKey; mult: number } | null;
  /** Your sell-price markup per item (× the live market price; 1 = at market).
   *  What your produced version lists/sells for, and what desk offers anchor to. */
  listPrices: Record<number, number>;
  /** Units of each item you PRODUCED and still hold (the rest of your holding is
   *  BOUGHT). Produced stock can't be dumped to market — only sold via listings
   *  or orders; bought stock stays freely sellable. */
  producedQty: Record<number, number>;
  /** Per-item listing switch. Absent/true = listed (produced stock sells
   *  passively); false = held (you keep it, no passive sale). */
  listed: Record<number, boolean>;
  /** Order Desk (sandbox): bulk contracts clients send for your goods. */
  orders: Order[];
  /** Desk standing — rises on fulfilment, dips on missed contracts. */
  reputation: number;
  /** Order-Desk automation settings (rep-gated). */
  deskAuto: DeskAuto;
  /** Last time (ms) an order was rolled onto the desk. */
  lastOrderAt: number;
  /** Flows accumulating in the current report period. */
  ledger: Ledger;
  /** Captured per-flip report snapshots (newest last). */
  reports: Report[];
  /** Absolute period counter (continuous across sessions via persistence). */
  periodNo: number;
  log: LogEntry[];
  /** Indices of recently-shown news scenarios (most recent last) — avoids
   *  recycling a story until the pool has moved well past it. */
  recentNewsIdx: number[];
  /** Net-worth history for the chart. */
  nwHist: number[];
}
