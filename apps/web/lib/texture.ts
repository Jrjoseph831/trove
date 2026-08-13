import type { CSSProperties } from "react";
import type { RuntimeItem } from "@trove/engine";
import { primarySector } from "./ui";

/** The catalogue and the item page hold the same product as different types
 *  (RuntimeItem carries live price/stock, Item doesn't). The plate only needs
 *  what both have, so it asks for that rather than forcing a cast at each
 *  call site. */
type Plateable = Pick<RuntimeItem, "id" | "weights">;

/**
 * Surface identity without artwork.
 *
 * The project ships twelve sector photographs, one per sector. Spread across
 * ~1,456 catalogue items that is the same picture roughly a hundred and twenty
 * times over, which reads cheaper than no picture at all — so the depth here is
 * material rather than pictorial: hue, gradient, grain and elevation.
 *
 * Each item's plate is derived from its own id, so every card differs slightly
 * from its neighbours and always in the same way. Nothing is fetched, generated
 * or cached: it is arithmetic on a number the client already has, handed to CSS
 * as three custom properties.
 */

/** Sector hues, read off the reel's gradient palette so the two agree rather
 *  than being a second, competing colour language. */
const SECTOR_HUE: Record<string, number> = {
  construction: 35, // warm brown
  logistics: 187, // teal
  automotive: 2, // red
  technology: 213, // blue
  energy: 44, // gold
  agriculture: 98, // green
  manufacturing: 250, // near-neutral, desaturated below
  medical: 187, // cyan
  hospitality: 272, // violet
  consumer: 313, // magenta
  textiles: 258, // indigo
  luxury: 42, // gold
};

/** Sectors whose identity is a material, not a colour — kept nearly grey so
 *  the catalogue doesn't turn into a paint chart. */
const MUTED = new Set(["manufacturing"]);

/** FNV-1a over a small integer, so the spread is even across neighbouring ids.
 *  Two adjacent catalogue entries should not come out looking like a pair. */
function hash(n: number): number {
  let h = 0x811c9dc5;
  const s = String(n);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

export function sectorHue(sector: string): number {
  return SECTOR_HUE[sector] ?? 210;
}

/**
 * The CSS variables one item's plate is drawn from: a hue near its sector's,
 * an angle, and a saturation. Returned as a style object so the values live on
 * the element and the drawing stays entirely in the stylesheet.
 */
export function itemPlate(it: Plateable): CSSProperties {
  const sector = primarySector(it as RuntimeItem);
  const h = hash(it.id);
  const h2 = hash(it.id * 7 + 13);
  // ±14° around the sector hue: enough that no two adjacent cards match,
  // narrow enough that a department still reads as one colour family.
  const hue = Math.round(sectorHue(sector) + (h - 0.5) * 28);
  const sat = MUTED.has(sector) ? 8 : 26 + Math.round(h2 * 12);
  const angle = Math.round(h2 * 360);
  return {
    ["--plate-h" as string]: String(hue),
    ["--plate-s" as string]: `${sat}%`,
    ["--plate-a" as string]: `${angle}deg`,
  } as CSSProperties;
}

/** The same treatment keyed to a sector rather than an item — for department
 *  headers, where the whole section shares one identity. */
export function sectorPlate(sector: string): CSSProperties {
  const h = hash(sectorHue(sector));
  return {
    ["--plate-h" as string]: String(sectorHue(sector)),
    ["--plate-s" as string]: MUTED.has(sector) ? "10%" : "30%",
    ["--plate-a" as string]: `${Math.round(h * 360)}deg`,
  } as CSSProperties;
}
