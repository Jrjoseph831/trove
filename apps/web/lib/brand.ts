import { items, sectorLabel, type Item, type Tier } from "@trove/data";

const TIER_ORDER: Tier[] = ["mass", "mid", "premium", "luxury"];
const TIER_LABEL: Record<Tier, string> = {
  mass: "Mass",
  mid: "Mid",
  premium: "Premium",
  luxury: "Luxury",
};

// All base prices, sorted once — for the house valuation percentile.
const ALL_BASES = items.map((i) => i.base).sort((a, b) => a - b);

function percentile(value: number): number {
  let lo = 0;
  let hi = ALL_BASES.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((ALL_BASES[mid] ?? 0) < value) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((lo / ALL_BASES.length) * 100);
}

export interface BrandStanding {
  count: number;
  min: number;
  max: number;
  avg: number;
  /** 0–100: how richly the house's catalog is valued vs the whole floor. */
  houseIndex: number;
  topTier: string;
  flagship: Item[];
}

export function brandStanding(brandItems: Item[]): BrandStanding {
  const bases = brandItems.map((i) => i.base).sort((a, b) => a - b);
  const median = bases.length
    ? (bases[Math.floor((bases.length - 1) / 2)] ?? 0)
    : 0;
  const avg = bases.length ? bases.reduce((a, b) => a + b, 0) / bases.length : 0;
  const topTier = TIER_ORDER.reduce<Tier>((best, t) => {
    return brandItems.some((i) => i.tier === t) ? t : best;
  }, "mass");
  const flagship = [...brandItems]
    .sort((a, b) => b.base - a.base)
    .slice(0, 5);
  return {
    count: brandItems.length,
    min: bases[0] ?? 0,
    max: bases[bases.length - 1] ?? 0,
    avg,
    houseIndex: percentile(median),
    topTier: TIER_LABEL[topTier],
    flagship,
  };
}

export function sectorLabels(keys: string[]): string[] {
  return keys.map(sectorLabel);
}
