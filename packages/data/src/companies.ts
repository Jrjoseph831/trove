/**
 * @trove/data — the AI company roster (the floor's institutional players).
 *
 * These are real economic actors: each holds a treasury and trades / orders only
 * within its means, and earns steady per-cycle income scaled by its TIER so the
 * big names stay solvent (a "titan" is the BlackRock of the floor — effectively
 * always afloat), while small houses can struggle but never bleed to zero. Their
 * cash + holdings = an auditable net worth players can inspect.
 *
 * One roster drives both the market traders AND the order-desk demand, so the
 * company that buys on the floor is the same one that can send you a contract.
 */
import companiesJson from "../catalog/companies.json" with { type: "json" };
import type { SectorKey } from "./types";

export type CompanyTier = "boutique" | "mid" | "large" | "titan";

export interface CompanyTierSpec {
  /** Starting treasury. */
  cash: number;
  /** Revenue added to the treasury each 6h cycle (keeps them afloat). */
  income: number;
  /** Cash reserve the company won't spend below (kept liquid). */
  floor: number;
  /** Soft ceiling on a single order's value (a small firm won't order millions). */
  maxOrder: number;
}

export const COMPANY_TIERS: Record<CompanyTier, CompanyTierSpec> = {
  boutique: { cash: 90_000, income: 4_000, floor: 18_000, maxOrder: 45_000 },
  mid: { cash: 320_000, income: 14_000, floor: 60_000, maxOrder: 220_000 },
  large: { cash: 900_000, income: 45_000, floor: 180_000, maxOrder: 900_000 },
  titan: { cash: 3_000_000, income: 180_000, floor: 700_000, maxOrder: 5_000_000 },
};

export interface CompanySpec {
  name: string;
  /** Home sector it leans toward (trades + orders here), or null = broad/index. */
  sector: SectorKey | null;
  tier: CompanyTier;
}

/** Deterministic 0..1 hash of a name (FNV-1a) — fixes each house's tier. */
function hash01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/** Tier each house into a stable pyramid: a few titans, some large, a broad
 *  middle, and a long boutique tail — so liquidity is anchored but the floor is
 *  mostly small/mid firms. */
function tierFor(name: string): CompanyTier {
  const r = hash01(name);
  return r < 0.03 ? "titan" : r < 0.15 ? "large" : r < 0.55 ? "mid" : "boutique";
}

type RawCompany = { homeSector: SectorKey | null };

/** The institutional roster: a broad-index titan anchors liquidity, then EVERY
 *  backstoried house (companies.json — CEO, history, newsroom beats) trades on
 *  the floor with its home sector and a deterministic tier. One roster drives the
 *  market traders, the order-desk demand, the leaderboard, and the directory. */
const houses: CompanySpec[] = Object.entries(
  companiesJson as Record<string, RawCompany>,
).map(([name, c]) => ({ name, sector: c.homeSector ?? null, tier: tierFor(name) }));

export const companyRoster: CompanySpec[] = [
  { name: "Open_Index", sector: null, tier: "titan" }, // broad index — the anchor
  ...houses,
];

const byName = new Map(companyRoster.map((c) => [c.name, c]));
export const getCompanySpec = (name: string): CompanySpec | undefined =>
  byName.get(name);
