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

export type BeatSize = "flash" | "standard" | "major";

/** One dated event in a company's memory (append-only). */
export interface CompanyEvent {
  cycle: number;
  kind: string;
  size: BeatSize;
  head: string;
  body: string;
  effects: Record<SectorKey, number>;
}

/** An AI-owned house's persistent memory: identity, personality, event log. */
export interface Company {
  aiOwned: boolean;
  homeSector: SectorKey;
  founded: number;
  ceo: string;
  ceoSince: number;
  personality: { volatility: number; trait: string };
  arc: string | null;
  lastEventCycle: number;
  events: CompanyEvent[];
}

/** A live newsroom beat (a company event currently on air). */
export interface NewsroomBeat {
  company: string;
  sector: SectorKey;
  kind: string;
  size: BeatSize;
  head: string;
  body: string;
  cycle: number;
  /** On-air lifetime in 6h cycles (flash 1, standard 2, major 8). */
  dur: number;
}

export interface Newsroom {
  generatedAt: string;
  beats: NewsroomBeat[];
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

/** A buyable real-estate asset in the Property Market (endgame money sink).
 *  Some pay rent each settlement period; appreciation-only ones (rentYield 0)
 *  just hold/trade. All are sellable back at their current value. `img` is the
 *  art subject for the marketplace card (the UI overlays all wording). */
export interface Property {
  id: number;
  slug: string;
  name: string;
  category:
    | "Residential"
    | "Estate"
    | "Land"
    | "Retail"
    | "Office"
    | "Tower"
    | "Industrial"
    | "Hospitality"
    | "Flagship";
  /** List/base price in dollars (real-life-scaled: $185K homes → $5B trophies). */
  price: number;
  /** Rent paid per settlement period as a fraction of price; 0 = appreciation-only. */
  rentYield: number;
  /** How much the value drifts each period with the economy (appreciation swing). */
  volatility: number;
  scarcity: "common" | "rare" | "1of1";
  icon: string;
  /** Image-generation subject for the card art. */
  img: string;
}
