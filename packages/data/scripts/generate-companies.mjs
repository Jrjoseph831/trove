#!/usr/bin/env node
/**
 * Trove — add new companies (brands) + their catalog items.
 *
 * Appends ~24 new brands and ~10–15 items each to brands.json / items.json,
 * mirroring the real data shapes so they show up on the floor, in movers, the
 * ticker, and each gets an auto-generated /brand dossier page. Item numbers,
 * icons, weights, and archetypes are cloned from existing items in the same
 * category, so new goods look like real ones. Deterministic. Recomputes stats.
 *
 * Backstories (lore) are written separately and merged into lore.json.
 * Run:  npm run gen:companies -w @trove/data
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "..", "catalog");
const rootDataDir = join(here, "..", "..", "..", "data");
const read = (n) => JSON.parse(readFileSync(join(catalogDir, n), "utf8"));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(77003);
const rand = () => rng();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const intB = (a, b) => Math.floor(a + rand() * (b - a + 1));
const jit = (v, lo, hi) => v * (lo + rand() * (hi - lo));

const brands = read("brands.json");
const items = read("items.json");
const taxonomy = read("taxonomy.json");

const existingBrandNames = new Set(brands.map((b) => b.name));
const slug = (n) => n.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const existingSlugs = new Set(brands.map((b) => slug(b.name)));

// existing items grouped by category (numeric/archetype/icon profile templates)
const byCategory = {};
for (const it of items) (byCategory[it.category] ||= []).push(it);

// existing brands grouped by home sector (to copy a valid category/tier profile)
const brandsBySector = {};
for (const b of brands) (brandsBySector[b.homeSector] ||= []).push(b);

const STYLE = ["HD", "Pro", "Series X", "Mk II", "Standard", "Compact", "Heavy", "XR", "Series 2", "Pro Pack", "Field", "Mk III"];

// 24 new houses, two per industry, in the world's naming style.
const NEW = [
  ["Marrowstone Build", "construction"], ["Halcrow & Vance", "construction"],
  ["Drayton Freight", "logistics"], ["Vantor Lines", "logistics"],
  ["Kessel Drive", "automotive"], ["Brunmark Motors", "automotive"],
  ["Aperture Compute", "technology"], ["Halhold Systems", "technology"],
  ["Boreas Power", "energy"], ["Greywater Grid", "energy"],
  ["Tillage & Co.", "agriculture"], ["Greenmarsh Agro", "agriculture"],
  ["Steg Tooling", "manufacturing"], ["Carrowforge", "manufacturing"],
  ["Ardent Health", "medical"], ["Castle Devices", "medical"],
  ["Hearthstone Group", "hospitality"], ["Maison & Vale", "hospitality"],
  ["Wold & Bramm", "consumer"], ["Ornewright Goods", "consumer"],
  ["Garrweave Mills", "textiles"], ["Holtgate Cloth", "textiles"],
  ["Varnvale House", "luxury"], ["Thronehaus & Co.", "luxury"],
];

let maxId = items.reduce((m, it) => Math.max(m, it.id), -1);
const newBrands = [];
const newItems = [];

for (const [name, homeSector] of NEW) {
  if (existingBrandNames.has(name) || existingSlugs.has(slug(name))) {
    console.warn(`skip duplicate brand ${name}`);
    continue;
  }
  // copy a valid category/tier/sector profile from an existing same-sector house
  const tmplBrand = pick(brandsBySector[homeSector] ?? brands);
  // keep categories that actually have item templates
  const categories = tmplBrand.categories.filter((c) => (byCategory[c]?.length ?? 0) > 0);
  if (!categories.length) {
    console.warn(`skip ${name}: no item templates for its categories`);
    continue;
  }
  const brand = {
    name,
    homeSector,
    tiers: [...tmplBrand.tiers],
    categories: [...tmplBrand.categories],
    sectors: [...tmplBrand.sectors],
  };
  newBrands.push(brand);
  existingBrandNames.add(name);
  existingSlugs.add(slug(name));

  const n = intB(10, 15);
  for (let k = 0; k < n; k++) {
    const category = pick(categories);
    const subs = taxonomy[category]?.subs ?? {};
    const subNames = Object.keys(subs);
    const sub = subNames.length ? pick(subNames) : (pick(byCategory[category]).sub);
    const leaves = subs[sub] ?? [];
    const leaf = leaves.length ? pick(leaves) : sub;
    const tmpl = pick(byCategory[category]);
    const isEdition = tmpl.edition !== null;
    newItems.push({
      id: ++maxId,
      name: `${pick(STYLE)} ${leaf}`,
      brand: name,
      tier: pick(brand.tiers),
      category,
      sub,
      archetype: tmpl.archetype,
      icon: tmpl.icon,
      // canonical category→sector weights (how the real items derive theirs)
      weights: taxonomy[category]?.sectors ?? tmpl.weights,
      base: Math.round(jit(tmpl.base, 0.78, 1.28) * 100) / 100,
      stockNormal: isEdition ? 0 : Math.max(1, Math.round(jit(tmpl.stockNormal || 1, 0.7, 1.3))),
      restock: isEdition ? 0 : Math.round(jit(tmpl.restock || 0, 0.7, 1.3)),
      edition: isEdition ? pick([1, 2, 3, 5, 8, 12]) : null,
      elaborate: Math.round((tmpl.elaborate ?? 0.2) * 1000) / 1000,
    });
  }
}

const mergedBrands = [...brands, ...newBrands].sort((a, b) => a.name.localeCompare(b.name));
const mergedItems = [...items, ...newItems].sort((a, b) => a.id - b.id);

// recompute stats.json
const cats = new Set(mergedItems.map((i) => i.category));
const subs = new Set(mergedItems.map((i) => `${i.category}/${i.sub}`));
const byArch = {};
const bySector = {};
let minP = Infinity, maxP = 0;
for (const i of mergedItems) {
  byArch[i.archetype] = (byArch[i.archetype] ?? 0) + 1;
  for (const s of Object.keys(i.weights)) bySector[s] = (bySector[s] ?? 0) + 1;
  minP = Math.min(minP, i.base);
  maxP = Math.max(maxP, i.base);
}
const stats = {
  total_items: mergedItems.length,
  total_brands: mergedBrands.length,
  total_sectors: read("sectors.json") && Object.keys(read("sectors.json")).length,
  total_categories: cats.size,
  total_subcategories: subs.size,
  editions: mergedItems.filter((i) => i.edition !== null).length,
  items_by_archetype: byArch,
  item_appearances_by_sector: bySector,
  price_range: [Math.round(minP * 100) / 100, Math.round(maxP * 100) / 100],
};

for (const dir of [catalogDir, rootDataDir]) {
  writeFileSync(join(dir, "brands.json"), JSON.stringify(mergedBrands, null, 2) + "\n");
  writeFileSync(join(dir, "items.json"), JSON.stringify(mergedItems, null, 2) + "\n");
  writeFileSync(join(dir, "stats.json"), JSON.stringify(stats, null, 2) + "\n");
}

console.log(`added ${newBrands.length} brands, ${newItems.length} items`);
console.log(`brands: ${brands.length} -> ${mergedBrands.length}; items: ${items.length} -> ${mergedItems.length}`);
console.log(`new brands: ${newBrands.map((b) => b.name).join(", ")}`);
