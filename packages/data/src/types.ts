/**
 * Canonical types for the Trove catalog (see specs/03_DATA_SCHEMA.md).
 * These describe the *seed* shape on disk. Runtime fields the engine adds
 * (stock, remaining, owners, value, …) live in @trove/engine, not here.
 */

/** Canonical sector id, e.g. "construction", "logistics". */
export type SectorKey = string;

export interface Sector {
  label: string;
  blurb: string;
}

export type Tier = "mass" | "mid" | "premium" | "luxury";

export type Archetype =
  | "micro_consumable"
  | "bulk_consumable"
  | "commodity"
  | "component"
  | "light_equipment"
  | "heavy_equipment"
  | "vehicle"
  | "luxury_good"
  | "collectible";

export interface Item {
  /** Stable unique int — primary key. */
  id: number;
  name: string;
  /** FK → Brand.name */
  brand: string;
  tier: Tier;
  category: string;
  sub: string;
  archetype: Archetype;
  icon: string;
  /** Sector cascade weights, e.g. { construction: 0.6, manufacturing: 0.4 }. */
  weights: Record<SectorKey, number>;
  /** Baseline price. */
  base: number;
  /** Normal floor units (open items). */
  stockNormal: number;
  /** Units returned per cycle (0 for editions). */
  restock: number;
  /** null = open commodity; N = finite run of N. */
  edition: number | null;
  /** 0..1 volatility beta + collectible glow. */
  elaborate: number;
}

export interface Brand {
  name: string;
  homeSector: SectorKey;
  tiers: Tier[];
  categories: string[];
  sectors: SectorKey[];
}

/** One spoken line in a news broadcast, delivered by anchor A or B. */
export interface BroadcastSegment {
  anchor: "A" | "B";
  /** What the anchor says (also used as the browser-speech fallback text). */
  text: string;
  kind?: "intro" | "story" | "handoff" | "signoff";
  /** The story shown on the backdrop while this line is read. */
  story?: { kick: string; head: string; sector?: SectorKey };
  /** Pre-rendered audio path (relative to the site root), if available. */
  audio?: string;
}

/** A pre-generated twice-daily news broadcast for the studio scene. */
export interface Broadcast {
  /** ISO timestamp the segment was generated. */
  generatedAt: string;
  /** Edition number for the on-screen bug. */
  edition: number;
  /** Anchor display names. */
  anchors: { A: string; B: string };
  segments: BroadcastSegment[];
}

/** Authored flavor copy for a brand's company page. */
export interface BrandLore {
  /** Sharp one-liner, ≤ 8 words. */
  tagline: string;
  /** Plausible founding year. */
  founded: number;
  /** ~60–90 word company backstory. */
  story: string;
}

export interface News {
  id: string;
  /** Eyebrow / category label. */
  kick: string;
  head: string;
  body: string;
  /** HIDDEN sector deltas — never shipped to the client. */
  effects: Record<SectorKey, number>;
  /** Cycles the effect influences demand. */
  dur: number;
  /** Selection weight (quiet days = 0.4). */
  weight: number;
}

export interface TaxonomyNode {
  sectors: Record<SectorKey, number>;
  subs: Record<string, string[]>;
}

export type Taxonomy = Record<string, TaxonomyNode>;

export interface Stats {
  total_items: number;
  total_brands: number;
  total_sectors: number;
  total_categories: number;
  total_subcategories: number;
  editions: number;
  items_by_archetype: Record<string, number>;
  item_appearances_by_sector: Record<string, number>;
  price_range: [number, number];
}
