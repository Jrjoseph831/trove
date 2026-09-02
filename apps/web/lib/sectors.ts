/**
 * A colour per department.
 *
 * The command bar gave every destination a tone; the storefront's twelve
 * departments are the one other place a player picks from a long fixed list,
 * so they get the same treatment. Colour plus a fixed position is what makes
 * a list navigable without reading it — the whole reason the deck works.
 *
 * Drawn from the same muted jewel range as the nav tiles: saturated enough to
 * separate twelve entries, never candy.
 */
export const SECTOR_TONE: Record<string, string> = {
  construction: "#a8642c",
  logistics: "#3f8f57",
  automotive: "#4a7ba8",
  technology: "#6f61c8",
  energy: "#c8851f",
  agriculture: "#6f9440",
  manufacturing: "#7a7264",
  medical: "#2f8f9b",
  hospitality: "#b0568a",
  consumer: "#c0492b",
  textiles: "#8a5296",
  luxury: "#9c7b34",
};

export function sectorTone(key: string | null | undefined): string {
  return (key && SECTOR_TONE[key]) || "var(--ink-faint)";
}
