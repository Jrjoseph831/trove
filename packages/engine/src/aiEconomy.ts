/**
 * @trove/engine — AI companies as real economic actors.
 *
 * Two extensions to the base model (see specs/02_ENGINE.md):
 *  1. A "ripple" multiplier that ties AI income/aggression to how much real
 *     players are actually doing, so the world doesn't stay static while a
 *     player gets rich. Bounded — it can only ever raise AI activity above the
 *     already-invariant-tested flat baseline, never below it.
 *  2. AI virtual material consumption — AI companies draw on the same shared
 *     item stock a player's factory would, without needing per-company
 *     Factory objects (no new per-tick Lambda cost; this evaluates once per
 *     company per 6h settlement, the same cadence AI trading already runs on).
 *
 * Hard constraint: nothing in this file may call `rand()` from ./rng. Every
 * new draw would shift the RNG sequence for everything settleCycle runs after
 * it, silently changing existing tests' concrete values. Use the deterministic
 * hash pattern instead where variety is needed (see companies.ts `hash01`,
 * mirrored below).
 */
import {
  AI_APPETITE_MUL,
  canProduce,
  COMPANY_TIERS,
  effectiveSpec,
  items as catalog,
  recipeOf,
  type CompanyTier,
  type Item,
  type SectorKey,
} from "@trove/data";
import type { RuntimeItem, Trader, WorldState } from "./types";

// ── Real-player activity → the ripple multiplier ────────────────────────────

/** Sum of qty×value across every item owner that ISN'T an AI trader — i.e. the
 *  real players' footprint on the shared floor (goods produced/bought), not
 *  idle cash sitting in a wallet. Works unmodified in both contexts the engine
 *  runs in: the live shared doc (non-trader owner keys are real player ids,
 *  already folded in by the production Lambda — no new I/O here) and sandbox
 *  (the only non-trader key is "YOU"). */
export function realPlayerFootprint(state: WorldState): number {
  const traderNames = new Set(state.traders.map((t) => t.name));
  let v = 0;
  for (const it of state.items) {
    for (const [owner, qty] of Object.entries(it.owners)) {
      if (!traderNames.has(owner)) v += qty * it.value;
    }
  }
  return v;
}

/** Smoothing for the activity EMA — roughly a 1–2 day time constant at the
 *  6h settlement cadence, so a single big trade doesn't jerk the ripple. */
const ACTIVITY_EMA_ALPHA = 0.15;
/** Footprint ($) representing "about one active player running a couple of
 *  lines" — the reference point the ripple's log curve is scaled against. */
const ACTIVITY_REFERENCE = 150_000;
const RIPPLE_MIN = 1.0;
const RIPPLE_MAX = 1.5;
const RIPPLE_K = 0.18;

/** Refresh the rolling activity EMA from the current footprint. Must run
 *  BEFORE settleCycle's step 0 (accrueIncome) so this cycle's income already
 *  reflects it — see settleCycle's call order. */
export function updatePlayerActivity(state: WorldState): void {
  const raw = realPlayerFootprint(state);
  const prev = state.playerActivityEma ?? 0;
  state.playerActivityEma = prev + (raw - prev) * ACTIVITY_EMA_ALPHA;
}

/** Bounded, monotonic multiplier from the activity EMA: exactly 1.0 on a
 *  dormant world (no player footprint yet — byte-identical to the old flat
 *  behavior), rising smoothly toward 1.5 as real-player activity grows, never
 *  beyond it. log10-compressed so it can't run away with a single huge spike. */
export function rippleMultiplier(state: WorldState): number {
  const ema = state.playerActivityEma ?? 0;
  const ratio = ema / ACTIVITY_REFERENCE;
  const raw = 1 + RIPPLE_K * Math.log10(1 + Math.max(0, ratio));
  return Math.max(RIPPLE_MIN, Math.min(RIPPLE_MAX, raw));
}

// ── Representative item per AI company (memoized, deterministic) ───────────
// Mirrors @trove/data's factory.ts production-tier grouping (RAW/PART/GOODS)
// without needing that file to export it — this only reads the public
// `archetype`/`weights` fields already on Item.
type AiTierGroup = "raw" | "part" | "goods" | "none";

function archetypeTier(a: Item["archetype"]): AiTierGroup {
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

/** The sector an item leans into hardest (same idea as factory.ts's private
 *  topSector, reimplemented here since it isn't exported). */
function topSectorOf(it: Item): SectorKey {
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

// sector → tier → producible items in that sector, sorted by base price
// descending. Built once on first lookup.
let _sectorBuckets: Record<SectorKey, Record<AiTierGroup, Item[]>> | null = null;
function sectorBuckets(): Record<SectorKey, Record<AiTierGroup, Item[]>> {
  if (_sectorBuckets) return _sectorBuckets;
  const b: Record<SectorKey, Record<AiTierGroup, Item[]>> = {};
  for (const it of catalog) {
    if (!canProduce(it)) continue;
    const tier = archetypeTier(it.archetype);
    if (tier === "none") continue;
    const s = topSectorOf(it);
    if (!s) continue;
    (b[s] ??= { raw: [], part: [], goods: [], none: [] })[tier].push(it);
  }
  for (const s of Object.keys(b)) {
    (["raw", "part", "goods"] as const).forEach((t) =>
      b[s]![t].sort((x, y) => y.base - x.base),
    );
  }
  _sectorBuckets = b;
  return b;
}

/** Deterministic 0..1 hash of a company name (same FNV-1a @trove/data's
 *  companies.ts uses for tierFor) — picks which representative item a company
 *  gets without any `rand()` call, so it never shifts the RNG sequence. */
function hash01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

const _repItemCache = new Map<string, Item | null>();

/** The item an AI company notionally manufactures. GOODS tier preferred,
 *  falling back to PART then RAW for sectors with no GOODS-tier inventory
 *  (consumer, textiles). Picks from the ~5 priciest items in that bucket,
 *  varied per company by name so many houses in one sector don't all draw the
 *  exact same item — while many of them still converge on the same underlying
 *  raw materials via each item's own recipe (that convergence is what makes
 *  the shared-scarcity competition real). `null` for the broad-index anchor
 *  (`bias === null`) or a sector with no producible inventory at all. */
export function representativeItem(name: string, bias: SectorKey | null): Item | null {
  if (!bias) return null;
  const cached = _repItemCache.get(name);
  if (cached !== undefined) return cached;
  const buckets = sectorBuckets()[bias];
  const pool = buckets?.goods.length
    ? buckets.goods
    : buckets?.part.length
      ? buckets.part
      : (buckets?.raw ?? []);
  let result: Item | null = null;
  if (pool.length) {
    const window = Math.min(5, pool.length);
    result = pool[Math.floor(hash01(name) * window)] ?? pool[0]!;
  }
  _repItemCache.set(name, result);
  return result;
}

// ── AI virtual material consumption ─────────────────────────────────────────

/** Ceiling on how much of an item's stock ALL AI companies combined may draw
 *  in one 6h cycle, as a fraction of that item's stock at the START of this
 *  pass. Without this, a material that many companies converge on as a
 *  primary input (steel is the classic case — the primaryMaterial for most
 *  expensive GOODS across construction/automotive/energy) sees its combined
 *  appetite vastly exceed its restock rate and gets pinned at 0 forever, with
 *  no recovery — a permanent floor, not the rising-and-falling market this is
 *  meant to create. Capping the CYCLE's draw (not the appetite itself) means a
 *  heavily-converged material still gets squeezed hard and visibly, but always
 *  keeps enough of a base to recover via restock — self-limiting regardless of
 *  how many companies happen to share that input, so it doesn't need
 *  per-material tuning as the catalog or roster grow. */
const MAX_ITEM_DRAW_FRAC = 0.35;

interface ItemDrawBudget {
  /** Stock this item had before any AI drew from it this cycle. */
  start: number;
  /** Combined units drawn by AI companies so far this cycle. */
  drawn: number;
}

/** One 6h settlement's worth of AI material draw: every company with a sector
 *  bias notionally runs a virtual production line sized by its tier (and the
 *  `ripple` multiplier — 1 = today's flat baseline), drawing real inputs from
 *  the SAME shared item stock a player's factory would (real competition, both
 *  directions). Nothing is credited to the company's holdings — cash leaves
 *  for the input spend with no counterparty, mirroring how a player factory's
 *  market-sourced inputs already work in produceFactories(); this keeps
 *  companyValuation/Deal Room equity math untouched by the feature.
 *
 *  A starved company degrades gracefully instead of hard-failing like a player
 *  factory's binary idle: every input scales down TOGETHER by one fill factor
 *  (preserving the recipe's ratios), bounded so cash never drops below the
 *  company's tier reserve, stock never drops below 0, and (see
 *  MAX_ITEM_DRAW_FRAC) no single item can be drawn past its per-cycle cap no
 *  matter how many companies converge on it. */
export function aiVirtualConsumption(state: WorldState, ripple = 1): void {
  const budgets = new Map<number, ItemDrawBudget>();
  for (const t of state.traders) {
    consumeFor(state, t, ripple, budgets);
  }
}

/** Remaining per-cycle draw allowance for an item, across ALL companies
 *  combined — lazily seeds the budget from the item's stock the first time
 *  it's touched this cycle (i.e. before anyone has drawn from it yet). */
function drawBudgetLeft(
  budgets: Map<number, ItemDrawBudget>,
  it: RuntimeItem,
): number {
  let b = budgets.get(it.id);
  if (!b) {
    b = { start: it.stock, drawn: 0 };
    budgets.set(it.id, b);
  }
  return Math.max(0, b.start * MAX_ITEM_DRAW_FRAC - b.drawn);
}

function consumeFor(
  state: WorldState,
  t: Trader,
  ripple: number,
  budgets: Map<number, ItemDrawBudget>,
): void {
  if (!t.bias) return; // Open_Index: the broad-index anchor, not a producer
  const rep = representativeItem(t.name, t.bias);
  if (!rep) return;
  const recipe = recipeOf(rep);
  if (!recipe || recipe.inputs.length === 0) return; // raw extraction: no inputs to draw

  const tier: CompanyTier = t.tier ?? "mid";
  const rate = effectiveSpec(rep, []).rate * AI_APPETITE_MUL[tier] * ripple;
  if (!(rate > 0)) return;

  const reserve = COMPANY_TIERS[tier].floor;
  const budget = Math.max(0, t.cash - reserve);
  if (budget <= 0) return;

  const plan: { it: RuntimeItem; need: number }[] = [];
  let cost = 0;
  for (const inp of recipe.inputs) {
    const it = state.items.find((x) => x.id === inp.itemId);
    if (!it) continue;
    const need = inp.qty * rate;
    plan.push({ it, need });
    cost += need * it.value;
  }
  if (plan.length === 0 || cost <= 0) return;

  // Scale every input by ONE factor so the recipe's ratios hold — never buy
  // 100% of the steel and 0% of the fasteners just because steel ran short.
  // Bound by whatever's left of THIS cycle's shared per-item draw cap, not raw
  // live stock — that's what keeps a heavily-converged material from being
  // wiped to zero by whichever company happens to go first.
  let capFrac = 1;
  for (const p of plan) {
    if (p.need <= 0) continue;
    capFrac = Math.min(capFrac, drawBudgetLeft(budgets, p.it) / p.need);
  }
  const cashFrac = budget / cost;
  const fillScale = Math.max(0, Math.min(1, capFrac, cashFrac));
  if (fillScale <= 0) return;

  for (const p of plan) {
    const draw = p.need * fillScale;
    p.it.stock = Math.max(0, p.it.stock - draw);
    budgets.get(p.it.id)!.drawn += draw;
  }
  t.cash -= cost * fillScale;
}

// ── Feeding consumption into the sector cascade ─────────────────────────────

/** How much a small, hard-clamped depletion signal can nudge a sector's index
 *  target, alongside news effects. Kept well under a typical news effect so
 *  news stays the dominant, primary driver of sentiment and this reads as a
 *  secondary hum underneath it, not a competing narrative. */
const SECTOR_PRESSURE_CLAMP = 0.05;
const SECTOR_PRESSURE_SCALE = 0.08;

/** Item-level scarcity alone can't deliver "steel scarce → everything made
 *  from steel rises" — priceItem() only reads an item's OWN stock, never its
 *  inputs'. This aggregates how depleted a sector's items are (weighted by
 *  each item's own weight in that sector — reusing the same signal scarcity()
 *  already uses per item, just summed), and settleCycle folds a small, clamped
 *  version of it into that sector's demand target. Because raw materials and
 *  the finished goods that consume them typically share sector weights, a
 *  sector-wide depletion pressure genuinely lifts demand — and so price — for
 *  both the scarce input and everything else in that sector, using the
 *  cascade that already exists rather than a new pricing path. */
export function sectorConsumptionPressure(state: WorldState, sector: SectorKey): number {
  let num = 0;
  let den = 0;
  for (const it of state.items) {
    const w = it.weights[sector];
    if (!w || it.edition !== null || it.stockNormal <= 0) continue;
    num += w * (1 - it.stock / it.stockNormal);
    den += w;
  }
  const depletion = den ? num / den : 0;
  return Math.max(-SECTOR_PRESSURE_CLAMP, Math.min(SECTOR_PRESSURE_CLAMP, depletion * SECTOR_PRESSURE_SCALE));
}
