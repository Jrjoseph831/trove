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

/** The institutional roster. Names echo the firms quoted in the news so the world
 *  reads as one place. Tiers span the floor; the two titans anchor liquidity. */
export const companyRoster: CompanySpec[] = [
  { name: "Open_Index", sector: null, tier: "titan" }, // broad index — the floor's anchor
  { name: "Halcyon_Holdings", sector: "luxury", tier: "titan" },
  { name: "Bedrock_Capital", sector: "construction", tier: "large" },
  { name: "Meridian_Tech", sector: "technology", tier: "large" },
  { name: "Cindral_Power", sector: "energy", tier: "large" },
  { name: "Forgewright_Industrial", sector: "manufacturing", tier: "large" },
  { name: "Thal_Medical", sector: "medical", tier: "large" },
  { name: "Wayfront_Logistics", sector: "logistics", tier: "mid" },
  { name: "Marrowgear_Motors", sector: "automotive", tier: "mid" },
  { name: "Harrow_Agro", sector: "agriculture", tier: "mid" },
  { name: "Carrow_Hospitality", sector: "hospitality", tier: "mid" },
  { name: "Drust_Goods", sector: "consumer", tier: "mid" },
  { name: "Garrweave_Mills", sector: "textiles", tier: "boutique" },
];

const byName = new Map(companyRoster.map((c) => [c.name, c]));
export const getCompanySpec = (name: string): CompanySpec | undefined =>
  byName.get(name);
