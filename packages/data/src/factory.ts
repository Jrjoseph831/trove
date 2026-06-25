/**
 * @trove/data — Factory production model (recipes + economics).
 *
 * A factory "line" produces ONE output item each cycle. What it costs to build,
 * how fast it runs, and what it consumes are all derived from the item's
 * archetype + base price, so the whole 1,753-item catalog is producible without
 * hand-authoring each one. The rules read sector-coherently: a line's inputs are
 * lower-tier goods that share the output's home sector.
 *
 * Production tiers (low → high):
 *   RAW   — micro_consumable, bulk_consumable, commodity  (extracted; no inputs)
 *   PART  — component                                     (needs RAW)
 *   GOODS — light/heavy_equipment, vehicle, luxury_good   (needs PART + RAW)
 *   collectibles / editions are NOT producible (finite by definition).
 */
import { items } from "./index";
import type { Archetype, Item, SectorKey } from "./types";

export interface RecipeInput {
  itemId: number;
  qty: number;
}
export interface Recipe {
  /** Empty = raw extraction (cash + upkeep only, no input items). */
  inputs: RecipeInput[];
}
export interface FactorySpec {
  /** One-time cash to stand the line up. */
  buildCost: number;
  /** Units produced per cycle when inputs are available. */
  rate: number;
  /** Cash burned per cycle (running, even when idle). */
  upkeep: number;
  /** Cycles between building and coming online (anticipation tax). */
  buildCycles: number;
}

type TierGroup = "raw" | "part" | "goods" | "none";

function tierOf(a: Archetype): TierGroup {
  switch (a) {
    case "micro_consumable":
    case "bulk_consumable":
    case "commodity":
      return "raw";
    case "component":
      return "part";
    case "light_equipment":
    case "heavy_equipment":
    case "vehicle":
    case "luxury_good":
      return "goods";
    default:
      return "none"; // collectible
  }
}

/** Can this item be produced by a factory at all? */
export function canProduce(it: Item): boolean {
  return it.edition === null && tierOf(it.archetype) !== "none";
}

/** The sector an item leans into hardest. */
function topSector(it: Item): SectorKey {
  let best: SectorKey = "";
  let bestW = -1;
  for (const [s, w] of Object.entries(it.weights)) {
    if (w > bestW) {
      bestW = w;
      best = s;
    }
  }
  return best;
}

// ── Input buckets (lazy, memoized) ─────────────────────────────────────────
// bucket[sector][tier] = catalog items of that tier whose home sector matches,
// sorted by base price ascending. Built once on first recipe lookup (avoids a
// module-init order dependency with ./index).
type Buckets = Record<SectorKey, Record<TierGroup, Item[]>>;
let _buckets: Buckets | null = null;
let _globalRaw: Item[] | null = null;
let _globalPart: Item[] | null = null;

function buckets(): Buckets {
  if (_buckets) return _buckets;
  const b: Buckets = {};
  const raw: Item[] = [];
  const part: Item[] = [];
  for (const it of items) {
    if (it.edition !== null) continue; // editions aren't inputs
    const tier = tierOf(it.archetype);
    if (tier !== "raw" && tier !== "part") continue; // only RAW/PART are inputs
    const s = topSector(it);
    (b[s] ??= { raw: [], part: [], goods: [], none: [] })[tier].push(it);
    (tier === "raw" ? raw : part).push(it);
  }
  const byBase = (x: Item, y: Item) => x.base - y.base;
  for (const s of Object.keys(b)) {
    b[s]!.raw.sort(byBase);
    b[s]!.part.sort(byBase);
  }
  raw.sort(byBase);
  part.sort(byBase);
  _buckets = b;
  _globalRaw = raw;
  _globalPart = part;
  return b;
}

/** Stable small hash so input choice varies across the catalog but is fixed. */
function hash(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Pick an input item for a slot: prefer one whose base sits just under the
 *  target spend, so qty lands ≥ 1. Deterministic, with a hash nudge for variety. */
function pickInput(
  pool: Item[],
  target: number,
  outId: number,
  slot: number,
  exclude: number,
): RecipeInput | null {
  const cands = pool.filter((it) => it.id !== exclude && it.base > 0);
  if (!cands.length) return null;
  // Candidates at or below target (qty ≥ 1); fall back to the cheapest overall.
  const under = cands.filter((it) => it.base <= target);
  const ranked = under.length ? under : [cands[0]!];
  // Nudge selection within the top of the ranked window for variety.
  const window = Math.min(ranked.length, 4);
  const start = ranked.length - window; // the priciest-under-target end
  const chosen = ranked[start + (hash(outId * 7 + slot) % window)]!;
  const qty = Math.max(1, Math.min(9999, Math.round(target / chosen.base)));
  return { itemId: chosen.id, qty };
}

const recipeCache = new Map<number, Recipe | null>();

/** Production recipe for an item, or null if it can't be produced.
 *  inputs:[] means raw extraction (no input items, just cash + upkeep). */
export function recipeOf(it: Item): Recipe | null {
  if (recipeCache.has(it.id)) return recipeCache.get(it.id)!;
  let result: Recipe | null;
  const tier = tierOf(it.archetype);
  if (it.edition !== null || tier === "none") {
    result = null;
  } else if (tier === "raw") {
    result = { inputs: [] }; // extraction
  } else {
    buckets();
    const s = topSector(it);
    const sec = _buckets![s] ?? { raw: [], part: [], goods: [], none: [] };
    const rawPool = sec.raw.length ? sec.raw : _globalRaw!;
    const partPool = sec.part.length ? sec.part : _globalPart!;
    // PART: two RAW inputs. GOODS: one PART + one RAW.
    const slots: { pool: Item[]; share: number }[] =
      tier === "part"
        ? [
            { pool: rawPool, share: 0.3 },
            { pool: rawPool, share: 0.25 },
          ]
        : [
            { pool: partPool.length ? partPool : rawPool, share: 0.32 },
            { pool: rawPool, share: 0.23 },
          ];
    const inputs: RecipeInput[] = [];
    const used = new Set<number>([it.id]);
    slots.forEach((slot, i) => {
      const picked = pickInput(
        slot.pool.filter((x) => !used.has(x.id)),
        it.base * slot.share,
        it.id,
        i,
        it.id,
      );
      if (picked) {
        used.add(picked.itemId);
        inputs.push(picked);
      }
    });
    // A GOODS/PART line with no resolvable inputs falls back to extraction.
    result = { inputs };
  }
  recipeCache.set(it.id, result);
  return result;
}

// ── Economics ──────────────────────────────────────────────────────────────
// Throughput target sets the rate; archetype caps keep heavy goods low-volume.
const THROUGHPUT = 18_000; // ~$ of output value a line targets per cycle
const RATE_CAP: Record<Archetype, number> = {
  micro_consumable: 2000,
  bulk_consumable: 800,
  commodity: 200,
  component: 30,
  light_equipment: 8,
  heavy_equipment: 3,
  vehicle: 1,
  luxury_good: 2,
  collectible: 0,
};
const BUILD_CYCLES: Record<Archetype, number> = {
  micro_consumable: 1,
  bulk_consumable: 1,
  commodity: 1,
  component: 2,
  light_equipment: 2,
  heavy_equipment: 3,
  vehicle: 3,
  luxury_good: 2,
  collectible: 0,
};

/** Build/run economics for a line producing this item. */
export function factorySpec(it: Item): FactorySpec {
  const cap = RATE_CAP[it.archetype] ?? 1;
  const rate = Math.max(1, Math.min(cap, Math.round(THROUGHPUT / it.base)));
  const buildCost = Math.max(
    1500,
    Math.min(8_000_000, Math.round(rate * it.base * 1.5)),
  );
  const upkeep = Math.max(50, Math.round(buildCost * 0.04));
  return { buildCost, rate, upkeep, buildCycles: BUILD_CYCLES[it.archetype] ?? 2 };
}
