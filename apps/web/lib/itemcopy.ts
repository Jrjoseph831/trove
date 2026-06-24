/**
 * Deterministic, token-free copy for an item's own page. Reads the seed
 * attributes (tier, archetype, category, sectors, edition) and composes a short
 * "feels real" product description — no AI, stable across builds.
 */
import { sectorLabel, type Item, type SectorKey } from "@trove/data";

const ARCH_LABEL: Record<string, string> = {
  micro_consumable: "Everyday essential",
  bulk_consumable: "Bulk supply good",
  commodity: "Traded commodity",
  component: "Precision component",
  light_equipment: "Light equipment",
  heavy_equipment: "Heavy equipment",
  vehicle: "Vehicle",
  luxury_good: "Luxury good",
  collectible: "Collector's piece",
};

const ARCH_PHRASE: Record<string, string> = {
  micro_consumable: "an everyday essential",
  bulk_consumable: "a bulk supply good",
  commodity: "a traded commodity",
  component: "a precision component",
  light_equipment: "a piece of light equipment",
  heavy_equipment: "heavy equipment",
  vehicle: "a working vehicle",
  luxury_good: "a luxury good",
  collectible: "a collector's piece",
};

const TIER_LABEL: Record<string, string> = {
  mass: "Mass-market",
  mid: "Mid-range",
  premium: "Premium",
  luxury: "Luxury",
};

const TIER_PHRASE: Record<string, string> = {
  mass: "a mass-market",
  mid: "a mid-range",
  premium: "a premium",
  luxury: "a flagship luxury",
};

const TIER_LINE: Record<string, string> = {
  mass: "Built to move in volume and keep sites and shelves stocked.",
  mid: "A dependable middle-tier choice — balanced on cost, build, and longevity.",
  premium: "Premium materials and tighter tolerances put it a clear step above the field.",
  luxury: "Top of its class — made in small numbers and finished to a standard few can match.",
};

export const archLabel = (it: Item): string =>
  ARCH_LABEL[it.archetype] ?? "Piece";
export const tierLabel = (it: Item): string => TIER_LABEL[it.tier] ?? it.tier;

/** The item's sectors, heaviest weight first (top 3). */
export function topSectors(it: Item): SectorKey[] {
  return Object.entries(it.weights ?? {})
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 3)
    .map(([k]) => k);
}

function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export interface ItemCopy {
  lede: string;
  body: string;
  supply: string;
  sectors: SectorKey[];
}

export function itemCopy(it: Item): ItemCopy {
  const tierP = TIER_PHRASE[it.tier] ?? "a";
  const archP = ARCH_PHRASE[it.archetype] ?? "a piece";
  const sectors = topSectors(it);
  const useLine = sectors.length
    ? ` Its price tracks demand across ${listJoin(sectors.map(sectorLabel))}.`
    : "";
  const supply =
    it.edition !== null
      ? it.edition === 1
        ? "Only one was ever made — once it's claimed, it's gone from the floor for good."
        : `Issued as a numbered run of ${it.edition}. Each copy is tracked from the floor into a single vault.`
      : "Carried as open stock and restocked on the floor each cycle, so supply ebbs with how fast it's bought.";
  return {
    lede: `The ${it.name} is ${tierP} ${archP} from ${it.brand}, listed under ${it.sub}.`,
    body: `${TIER_LINE[it.tier] ?? ""}${useLine}`.trim(),
    supply,
    sectors,
  };
}
