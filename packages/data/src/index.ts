/**
 * @trove/data — typed loaders over the seed catalog in ./catalog/*.json.
 *
 * The JSON here is copied from the repo-root `data/` handoff (the home of the
 * Python generators). To grow the world: edit the generator rules, rerun, then
 * re-copy the JSON into ./catalog. See specs/03_DATA_SCHEMA.md.
 */
import sectorsJson from "../catalog/sectors.json" with { type: "json" };
import brandsJson from "../catalog/brands.json" with { type: "json" };
import itemsJson from "../catalog/items.json" with { type: "json" };
import newsJson from "../catalog/news.json" with { type: "json" };
import taxonomyJson from "../catalog/taxonomy.json" with { type: "json" };
import statsJson from "../catalog/stats.json" with { type: "json" };
import loreJson from "../catalog/lore.json" with { type: "json" };
import broadcastJson from "../catalog/broadcast.json" with { type: "json" };

import type {
  Brand,
  BrandLore,
  Broadcast,
  Item,
  News,
  Sector,
  SectorKey,
  Stats,
  Taxonomy,
} from "./types";

export * from "./types";

/** All 12 sectors, keyed by canonical sector id. */
export const sectors: Record<SectorKey, Sector> = sectorsJson as Record<
  SectorKey,
  Sector
>;

/** Ordered list of sector ids (insertion order from sectors.json). */
export const sectorKeys: SectorKey[] = Object.keys(sectors);

/** The 76-brand bible. */
export const brands: Brand[] = brandsJson as Brand[];

/** THE CATALOG — ~1,456 items. */
export const items: Item[] = itemsJson as Item[];

/** The pre-generated news bank — 69 scenarios. */
export const news: News[] = newsJson as News[];

/** sector → category → sub → leaf tree. */
export const taxonomy: Taxonomy = taxonomyJson as Taxonomy;

/** Summary counts for balancing reference. */
export const stats: Stats = statsJson as unknown as Stats;

/** Authored backstories, keyed by exact brand name. */
export const lore: Record<string, BrandLore> = loreJson as Record<
  string,
  BrandLore
>;

/** The latest pre-generated news broadcast (regenerated twice daily). */
export const broadcast: Broadcast = broadcastJson as unknown as Broadcast;

// ── Lookups ──────────────────────────────────────────────────────────────

const itemsById = new Map<number, Item>(items.map((it) => [it.id, it]));
const brandsByName = new Map<string, Brand>(brands.map((b) => [b.name, b]));

export function getItem(id: number): Item | undefined {
  return itemsById.get(id);
}

export function getBrand(name: string): Brand | undefined {
  return brandsByName.get(name);
}

/** URL-safe slug for a brand name, e.g. "Skarngrove & Sons" → "skarngrove-sons". */
export function brandSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const brandBySlug = new Map<string, Brand>(
  brands.map((b) => [brandSlug(b.name), b]),
);

export function getBrandBySlug(slug: string): Brand | undefined {
  return brandBySlug.get(slug);
}

export function getLore(name: string): BrandLore | undefined {
  return lore[name];
}

/** Items made by a brand. */
export function itemsByBrand(name: string): Item[] {
  return items.filter((it) => it.brand === name);
}

export function sectorLabel(key: SectorKey): string {
  return sectors[key]?.label ?? key;
}
