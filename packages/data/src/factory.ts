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

/** Bill of materials: which input CATEGORIES plausibly go into each output
 *  category. Sector alone is too coarse (it let tyres pull transmission fluid);
 *  this keeps inputs to sensible materials/components — tyres draw rubber/fabric
 *  + metal + fasteners, compute draws boards + cells + wiring, etc. Output
 *  categories not listed (mostly raw materials) fall back to extraction or any
 *  cheaper raw input. */
const INPUT_CATEGORIES: Record<string, string[]> = {
  "Fasteners & Fixings": ["Structural Materials"],
  "Plumbing & Fixtures": ["Structural Materials", "Fasteners & Fixings"],
  "Wire & Cable": ["Structural Materials"],
  Lighting: ["Wire & Cable", "Power & Storage", "Structural Materials"],
  "Power & Storage": ["Wire & Cable", "Structural Materials"],
  Packaging: ["Raw Textiles", "Structural Materials"],
  "Material Handling": [
    "Structural Materials",
    "Fasteners & Fixings",
    "Power & Storage",
    "Wire & Cable",
  ],
  Vehicles: ["Auto Parts", "Structural Materials", "Power & Storage", "Wire & Cable"],
  "Auto Parts": [
    "Structural Materials",
    "Wire & Cable",
    "Raw Textiles",
    "Fasteners & Fixings",
  ],
  Compute: ["Wire & Cable", "Power & Storage", "Structural Materials"],
  Devices: ["Compute", "Power & Storage", "Wire & Cable"],
  "Farm Inputs": ["Packaging", "Raw Textiles"],
  "Farm Equipment": [
    "Structural Materials",
    "Auto Parts",
    "Power & Storage",
    "Wire & Cable",
  ],
  Earthmoving: ["Structural Materials", "Auto Parts", "Power & Storage"],
  "Industrial Machines": [
    "Structural Materials",
    "Power & Storage",
    "Wire & Cable",
    "Compute",
  ],
  "Medical Consumables": ["Raw Textiles", "Packaging"],
  "Medical Equipment": [
    "Compute",
    "Power & Storage",
    "Wire & Cable",
    "Structural Materials",
  ],
  "Food Service": ["Structural Materials", "Power & Storage", "Wire & Cable"],
  "Cleaning & Jansan": ["Packaging", "Raw Textiles", "Power & Storage"],
  "Apparel Goods": ["Raw Textiles"],
  "Household Goods": ["Structural Materials", "Raw Textiles", "Wire & Cable"],
  "Hardware & Tools": ["Structural Materials", "Power & Storage"],
  Timepieces: ["Compute", "Power & Storage", "Fasteners & Fixings"],
  "Fine Goods": ["Structural Materials"],
  "Structural Materials": ["Structural Materials"],
  "Raw Textiles": ["Raw Textiles"],
};

// Category → its RAW/PART items (sorted by base), for bill-of-materials inputs.
let _catPool: Record<string, Item[]> | null = null;
function catPools(): Record<string, Item[]> {
  if (_catPool) return _catPool;
  const m: Record<string, Item[]> = {};
  for (const it of items) {
    if (it.edition !== null) continue;
    const t = tierOf(it.archetype);
    if (t !== "raw" && t !== "part") continue;
    (m[it.category] ??= []).push(it);
  }
  for (const k of Object.keys(m)) m[k]!.sort((a, b) => a.base - b.base);
  _catPool = m;
  return m;
}

/** Products map to the raw material they're chiefly MADE OF, by name keyword,
 *  so a tyre pulls rubber — not the cheapest hex bolt in its sector. First match
 *  wins; the named material must exist in the catalog and be cheaper than the
 *  output, else we fall back to the bill-of-materials pool below. */
const PRIMARY_MATERIAL: [RegExp, string][] = [
  [/\b(tyre|tire|tread|hose|gasket|seal|bushing|grommet|wiper|rubber|o-ring|belt)\b/i, "Rubber Compound"],
  [/\b(glove|nitrile|latex)\b/i, "Rubber Compound"],
  [/\b(jacket|boot|vest|coverall|garment|apparel|uniform|sock|shirt|trouser)\b/i, "Cotton Bale Grade A"],
  [/\b(mask|gown|drape|dressing|gauze|bandage|wipe|filter|sponge|tubing)\b/i, "Polyester Fiber Roll"],
  [/\b(wire|cable|harness|conduit|busbar|winding|coil|spool)\b/i, "Copper Cathode"],
  [/\b(chip|gpu|ssd|cpu|ram|memory|module|server|switch|sensor|processor|wafer|circuit|board|monitor|scanner|printer|tablet|thermostat)\b/i, "Silicon Wafer"],
  [/\b(window|lens|glass|mirror|pane|display|screen|optic|decanter|crystal)\b/i, "Glass Sheet Stock"],
  [/\b(bottle|jug|case|crate|bin|tote|container|sleeve|tray|housing|enclosure|shell|mailer|wrap|film|pellet|box|bag)\b/i, "Plastic Resin Pellets"],
  [/\b(can|foil|tin|ingot|cookware|kettle)\b/i, "Aluminum Ingot"],
  [/\b(beam|girder|frame|chassis|rebar|stud|plate|bracket|rail|caliper|alternator|shock|spring|wrench|socket|driver|grinder|press|lathe|excavator|loader|baler|harrow|auger|drill|mixer|range|freezer|scrubber|vac|pump|valve|pipe|fitting|flange|duct|manifold|faucet|nozzle|fixture)\b/i, "Steel Coil"],
  [/\b(lumber|plywood|cabinet|furniture|desk|table|shelf|dinnerware|mattress|pallet)\b/i, "Hardwood Lumber"],
  [/\b(concrete|cement|mortar|block|brick|slab|insulation|drywall)\b/i, "Portland Cement"],
];

let _byName: Map<string, Item> | null = null;
function itemByName(name: string): Item | undefined {
  if (!_byName) {
    _byName = new Map();
    for (const it of items) if (it.edition === null) _byName.set(it.name.trim().toLowerCase(), it);
  }
  return _byName.get(name.trim().toLowerCase());
}

/** The raw material this product is chiefly made of (by name), or null. */
function primaryMaterial(it: Item): Item | null {
  const hay = `${it.name} ${it.sub ?? ""}`;
  for (const [re, name] of PRIMARY_MATERIAL) {
    if (re.test(hay)) {
      const mat = itemByName(name);
      if (mat && mat.id !== it.id && mat.base < it.base) return mat;
    }
  }
  return null;
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
    // Inputs come from this product's bill of materials — plausible material /
    // component categories, not just anything in the same sector — and must be
    // cheaper than the output. So tyres draw rubber/fabric + metal, not
    // transmission fluid.
    const inCats = INPUT_CATEGORIES[it.category] ?? [];
    const matPool = inCats
      .flatMap((c) => catPools()[c] ?? [])
      .filter((x) => x.id !== it.id && x.base < it.base);
    const pool = matPool.length
      ? matPool
      : _globalRaw!.filter((x) => x.base < it.base);
    const partPool = pool.filter((x) => tierOf(x.archetype) === "part");
    const rawPool = pool.filter((x) => tierOf(x.archetype) === "raw");
    const inputs: RecipeInput[] = [];
    const used = new Set<number>([it.id]);
    // Slot 1: the material this product is chiefly made of, by name (rubber for
    // a tyre, copper for a harness, silicon for a chip). Then a secondary input
    // from the bill of materials so it isn't a single ingredient.
    const primMat = primaryMaterial(it);
    if (primMat) {
      const qty = Math.max(1, Math.min(9999, Math.round((it.base * 0.4) / primMat.base)));
      inputs.push({ itemId: primMat.id, qty });
      used.add(primMat.id);
    }
    // PART: cheaper materials. GOODS: a component + a material. With a named
    // primary material we only need one secondary input.
    const slots: { pool: Item[]; share: number }[] = primMat
      ? [{ pool: tier === "part" ? rawPool : partPool, share: 0.2 }]
      : tier === "part"
        ? [
            { pool: rawPool.length ? rawPool : pool, share: 0.3 },
            { pool: rawPool.length ? rawPool : pool, share: 0.25 },
          ]
        : [
            { pool: partPool.length ? partPool : pool, share: 0.32 },
            { pool: rawPool.length ? rawPool : pool, share: 0.23 },
          ];
    slots.forEach((slot, i) => {
      const picked = pickInput(
        (slot.pool.length ? slot.pool : pool).filter((x) => !used.has(x.id)),
        it.base * slot.share,
        it.id,
        i + 1,
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

/** Build/run economics for a line producing this item (before any modules). */
export function factorySpec(it: Item): FactorySpec {
  const cap = RATE_CAP[it.archetype] ?? 1;
  const rate = Math.max(1, Math.min(cap, Math.round(THROUGHPUT / it.base)));
  const buildCost = Math.max(
    1500,
    Math.min(8_000_000, Math.round(rate * it.base * 1.5)),
  );
  // Upkeep scales with the line's OUTPUT VALUE per cycle (rate × base), not its
  // build cost — so a cheap-good line isn't crushed by a flat floor that would
  // eat most of its tiny output. ~5% of output value, with a small floor so an
  // idle line still costs something.
  const upkeep = Math.max(8, Math.round(rate * it.base * 0.05));
  return { buildCost, rate, upkeep, buildCycles: BUILD_CYCLES[it.archetype] ?? 2 };
}

// ── Line modules (engineer the line) ─────────────────────────────────────────
// Installable upgrades that re-shape a line's economics. Each is a trade-off;
// composing them is the engineering puzzle. Effects multiply (rate/upkeep/input)
// or add (premium). `stage` is a display hint for which step it bolts onto.

export interface LineModule {
  id: string;
  name: string;
  /** One-line effect summary for the UI (terse). */
  blurb: string;
  /** Plain-English description of what it does + the trade-off. */
  desc: string;
  /** Install cost as a fraction of the line's base build cost. */
  costFactor: number;
  rateMul: number;
  upkeepMul: number;
  /** Input consumed per unit (×). <1 = less waste. */
  inputMul: number;
  /** Additive quality premium on the output's realizable value. */
  premium: number;
  /** Process step this module visually attaches to. */
  stage: string;
}

export const MODULES: LineModule[] = [
  {
    id: "auto",
    name: "Automation Arm",
    blurb: "rate ×1.5 · upkeep +30%",
    desc: "Robotic arms speed up assembly — more output for a higher power bill.",
    costFactor: 0.6,
    rateMul: 1.5,
    upkeepMul: 1.3,
    inputMul: 1,
    premium: 0,
    stage: "Assemble",
  },
  {
    id: "bulk",
    name: "Bulk Feeder",
    blurb: "rate ×2 · input +10% · upkeep +25%",
    desc: "A second feed line floods the machine with raw stock — double output, a touch more waste.",
    costFactor: 0.8,
    rateMul: 2,
    upkeepMul: 1.25,
    inputMul: 1.1,
    premium: 0,
    stage: "Feed",
  },
  {
    id: "power",
    name: "Power Optimizer",
    blurb: "upkeep −25% · rate −10%",
    desc: "Trims the power bill — for a little less throughput. Great on a line you run idle.",
    costFactor: 0.5,
    rateMul: 0.9,
    upkeepMul: 0.75,
    inputMul: 1,
    premium: 0,
    stage: "Refine",
  },
  {
    id: "eff",
    name: "Efficiency Tuner",
    blurb: "input −20% · upkeep +5%",
    desc: "Tighter tooling wastes less material per unit — cheaper to feed.",
    costFactor: 0.7,
    rateMul: 1,
    upkeepMul: 1.05,
    inputMul: 0.8,
    premium: 0,
    stage: "Machine",
  },
  {
    id: "qc",
    name: "QC Station",
    blurb: "sells +6% · rate −10%",
    desc: "Quality control lets you charge a premium — a bit slower, but every unit sells for more.",
    costFactor: 0.55,
    rateMul: 0.9,
    upkeepMul: 1.1,
    inputMul: 1,
    premium: 0.06,
    stage: "Inspect",
  },
  {
    id: "shift",
    name: "Second Shift",
    blurb: "rate ×1.8 · upkeep ×1.8",
    desc: "Runs the line around the clock — big output bump, but you pay the upkeep to match.",
    costFactor: 0.4,
    rateMul: 1.8,
    upkeepMul: 1.8,
    inputMul: 1,
    premium: 0,
    stage: "Pack",
  },
];

const moduleById = new Map(MODULES.map((m) => [m.id, m]));
export const getModule = (id: string): LineModule | undefined =>
  moduleById.get(id);

/** Cash to install a module on a line (scales with the line's build cost). */
export function moduleCost(it: Item, moduleId: string): number {
  const m = moduleById.get(moduleId);
  if (!m) return 0;
  return Math.max(500, Math.round(factorySpec(it).buildCost * m.costFactor));
}

export interface EffectiveSpec {
  rate: number;
  upkeep: number;
  /** Input-per-unit multiplier (1 = recipe as-is). */
  inputMul: number;
  /** Quality premium on realizable output value (0 = market). */
  premium: number;
  buildCycles: number;
}

/** A line's live economics with its installed modules folded in. */
export function effectiveSpec(it: Item, moduleIds: string[]): EffectiveSpec {
  const base = factorySpec(it);
  let rate = base.rate;
  let upkeep = base.upkeep;
  let inputMul = 1;
  let premium = 0;
  for (const id of moduleIds) {
    const m = moduleById.get(id);
    if (!m) continue;
    rate *= m.rateMul;
    upkeep *= m.upkeepMul;
    inputMul *= m.inputMul;
    premium += m.premium;
  }
  return {
    rate: Math.max(1, Math.round(rate)),
    upkeep: Math.max(1, Math.round(upkeep)),
    inputMul,
    premium,
    buildCycles: base.buildCycles,
  };
}

// ── Production stages (the visible line flow) ───────────────────────────────
// Cosmetic process steps by archetype; FEED (inputs) and PACK (output) bracket
// them. The line "looks" like a factory without each step having its own math.
const STAGE_STEPS: Record<Archetype, string[]> = {
  micro_consumable: ["Mill"],
  bulk_consumable: ["Form"],
  commodity: ["Refine"],
  component: ["Machine", "Assemble"],
  light_equipment: ["Fabricate", "Assemble", "Test"],
  heavy_equipment: ["Fabricate", "Assemble", "Test"],
  vehicle: ["Stamp", "Weld", "Assemble", "Inspect"],
  luxury_good: ["Craft", "Finish", "Inspect"],
  collectible: [],
};

export interface LineStage {
  key: string;
  label: string;
  kind: "feed" | "process" | "output";
}

/** The ordered stages of a line: Feed/Source → process steps → Pack. */
export function productionStages(it: Item): LineStage[] {
  const recipe = recipeOf(it);
  const hasInputs = !!recipe && recipe.inputs.length > 0;
  const stages: LineStage[] = [
    { key: "feed", label: hasInputs ? "Feed" : "Source", kind: "feed" },
  ];
  (STAGE_STEPS[it.archetype] ?? []).forEach((s, i) =>
    stages.push({ key: `p${i}`, label: s, kind: "process" }),
  );
  stages.push({ key: "out", label: "Pack", kind: "output" });
  return stages;
}
