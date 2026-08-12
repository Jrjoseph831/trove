/**
 * @trove/engine — AI companies as real economic actors.
 *
 * Three extensions to the base model (see specs/02_ENGINE.md):
 *  1. A "ripple" multiplier that ties AI income/aggression to how much real
 *     players are actually doing, so the world doesn't stay static while a
 *     player gets rich. Bounded — it can only ever raise AI activity above the
 *     already-invariant-tested flat baseline, never below it.
 *  2. AI virtual production — AI companies draw material inputs from the same
 *     shared item stock a player's factory would, and credit real output to
 *     their own holdings, without needing per-company Factory objects (no new
 *     per-tick Lambda cost; this evaluates once per company per 6h
 *     settlement, the same cadence AI trading already runs on).
 *  3. Named AI-to-AI trading — when sourcing an input, a company prefers
 *     buying directly from another company that actually MAKES that item
 *     (a real, visible, logged transaction) over the anonymous floor,
 *     whenever one exists and holds stock. Reroutes WHO gets paid, never
 *     changes the total amount spent or consumed — see consumeFor().
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
  companyRoster,
  effectiveSpec,
  items as catalog,
  recipeOf,
  type CompanyTier,
  type Item,
  type SectorKey,
} from "@trove/data";
import type { RuntimeItem, Trader, WorldState } from "./types";

/** Append one floor-activity entry, same cap as index.ts's own `pushLog` —
 *  kept local to avoid a circular import (index.ts imports FROM this file,
 *  not the other way; same pattern orders.ts already uses for demandHeat). */
function logActivity(state: WorldState, who: string, verb: string, it: string): void {
  state.log.unshift({ who, verb, it });
  if (state.log.length > 30) state.log.pop();
}

/** Verb variety for the production log line — picked deterministically per
 *  company+item (hash01, not rand — see the file-level constraint above) so
 *  the same company reads the same way cycle to cycle instead of flickering,
 *  while the feed as a whole still reads as more than one repeated verb. */
const PRODUCE_VERBS = ["produced", "made", "turned out", "manufactured"];
function produceVerb(name: string, item: string): string {
  const idx = Math.floor(hash01(`${name}:${item}:produce`) * PRODUCE_VERBS.length);
  return PRODUCE_VERBS[idx] ?? PRODUCE_VERBS[0]!;
}

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

/** Every item id referenced as an input by ANY producible recipe in the
 *  whole catalog — built once, lazily. Materials-specialist companies (see
 *  PART_PRODUCER_FRACTION below) pick from the intersection of this and
 *  their sector's bucket, which GUARANTEES their chosen output is something
 *  at least one other recipe actually needs, rather than hoping a generic
 *  price-ranked sector pick happens to coincide with someone's input by
 *  chance (it rarely does — a materials tier needs to be built deliberately,
 *  not left to coincidence). */
let _allRecipeInputIds: Set<number> | null = null;
function allRecipeInputIds(): Set<number> {
  if (_allRecipeInputIds) return _allRecipeInputIds;
  const ids = new Set<number>();
  for (const it of catalog) {
    if (!canProduce(it)) continue;
    const recipe = recipeOf(it);
    if (!recipe) continue;
    for (const inp of recipe.inputs) ids.add(inp.itemId);
  }
  _allRecipeInputIds = ids;
  return ids;
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

/** Fraction of companies (deterministic, by name hash — independent of the
 *  hash used to pick WHICH item within a bucket) that specialize in MATERIALS
 *  — a RAW or PART tier item some OTHER recipe actually needs — instead of
 *  the GOODS-tier finished product most companies default to. Without this,
 *  EVERY company's representative item would be a GOODS-tier product, and
 *  GOODS-tier recipes draw their inputs from RAW/PART tier — items nobody in
 *  the roster ever produces as their OWN output. That leaves no company able
 *  to be another's natural producer, so named AI-to-AI trading (see below)
 *  would be correct but permanently inert. Specialists pick from
 *  `materialPool()` — the intersection of their sector's raw/part inventory
 *  and `allRecipeInputIds()` — which GUARANTEES their output is something at
 *  least one other recipe actually needs, rather than hoping a generic
 *  price-ranked pick coincides with someone's input by chance (checked
 *  empirically: it essentially never does on its own). */
const PART_PRODUCER_FRACTION = 0.3;

// sector → the raw/part items in that sector that are ALSO referenced as a
// recipe input somewhere in the catalog, price-ranked. Lazily built per
// sector (most sectors are only ever queried a handful of times).
const _materialPoolCache = new Map<SectorKey, Item[]>();
function materialPool(bias: SectorKey): Item[] {
  const cached = _materialPoolCache.get(bias);
  if (cached) return cached;
  const buckets = sectorBuckets()[bias];
  const inputIds = allRecipeInputIds();
  const pool = [...(buckets?.raw ?? []), ...(buckets?.part ?? [])]
    .filter((it) => inputIds.has(it.id))
    .sort((x, y) => y.base - x.base);
  _materialPoolCache.set(bias, pool);
  return pool;
}

/** The item an AI company notionally manufactures. Most companies make a
 *  GOODS-tier finished product; a deterministic ~30% specialize in a real
 *  materials role instead (see PART_PRODUCER_FRACTION) — the supplier tier
 *  that makes named AI-to-AI trading possible. A sector with no such
 *  materials falls back to the normal GOODS→PART→RAW preference, same as a
 *  non-specialist. Picks from the ~5 priciest items in the chosen pool,
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
  const materials = materialPool(bias);
  const specializesInMaterials =
    materials.length > 0 && hash01(`${name}:tier`) < PART_PRODUCER_FRACTION;
  const pool = specializesInMaterials
    ? materials
    : buckets?.goods.length
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

// ── Named AI-to-AI trading: who actually makes this item? ──────────────────

/** Reverse index: item id → the deterministic-order list of company names
 *  whose OWN representativeItem is that exact item — i.e. its natural
 *  producers. Built once from the static roster (representativeItem only
 *  depends on name+sector, both fixed per company), so this needs no
 *  `state` and can't drift from what representativeItem itself would say. */
let _producersByItem: Map<number, string[]> | null = null;
function producersByItem(): Map<number, string[]> {
  if (_producersByItem) return _producersByItem;
  const m = new Map<number, string[]>();
  for (const c of companyRoster) {
    if (!c.sector) continue; // Open_Index: the broad-index anchor, not a producer
    const rep = representativeItem(c.name, c.sector);
    if (!rep) continue;
    const list = m.get(rep.id) ?? [];
    list.push(c.name);
    m.set(rep.id, list);
  }
  for (const list of m.values()) list.sort(); // deterministic try-order
  _producersByItem = m;
  return m;
}

/** Which AI companies (if any) count `itemId` as the thing they make. */
function naturalProducersOf(itemId: number): string[] {
  return producersByItem().get(itemId) ?? [];
}

// ── AI virtual production (consume inputs, credit real output) ─────────────

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

/** One 6h settlement's worth of AI production: every company with a sector
 *  bias notionally runs a virtual production line sized by its tier (and the
 *  `ripple` multiplier — 1 = today's flat baseline). A GOODS/PART-tier
 *  representative item draws real inputs from the SAME shared item stock a
 *  player's factory would (real competition, both directions) — preferring a
 *  named AI producer over the anonymous floor when one exists (see the
 *  trading section below). A RAW-tier one (raw extraction — no inputs) pays a
 *  flat upkeep instead, mirroring a player's own extraction line. Either way
 *  the output is credited to the company's OWN holdings — companyValuation/
 *  Deal Room equity math already sums held(it, owner)*value generically, so
 *  real production flows straight into net worth/stake pricing with no
 *  further code changes. Market-sourced input cost still leaves as cash with
 *  no counterparty — mirrors how a player factory's market-sourced inputs
 *  already work in produceFactories().
 *
 *  A starved company degrades gracefully instead of hard-failing like a player
 *  factory's binary idle: every input scales down TOGETHER by one fill factor
 *  (preserving the recipe's ratios), and output scales down with it (can't
 *  manufacture more than what was actually sourced) — bounded so cash never
 *  drops below the company's tier reserve, stock never drops below 0, and
 *  (see MAX_ITEM_DRAW_FRAC) no single item can be drawn past its per-cycle
 *  cap no matter how many companies converge on it. */
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
  const repRuntime = state.items.find((x) => x.id === rep.id);
  if (!repRuntime) return;
  const recipe = recipeOf(rep);
  if (!recipe) return; // not producible at all — shouldn't happen, representativeItem only picks canProduce() items

  const tier: CompanyTier = t.tier ?? "mid";
  const rate = effectiveSpec(rep, []).rate * AI_APPETITE_MUL[tier] * ripple;
  if (!(rate > 0)) return;

  const reserve = COMPANY_TIERS[tier].floor;
  const budget = Math.max(0, t.cash - reserve);
  if (budget <= 0) return;

  if (recipe.inputs.length === 0) {
    // Raw extraction: no inputs to source, just a flat upkeep cost — mirrors
    // the upkeep ratio a PLAYER's own raw-extraction line already pays
    // (factorySpec's ~5% of output value). Bounded by the same cash-reserve
    // gate as everything else. This is what lets a "materials company" (a
    // RAW-tier representative item, e.g. Steel Coil) actually hold sellable
    // stock of the SPECIFIC named materials most GOODS-tier recipes' primary
    // input resolves to (@trove/data's primaryMaterial regex list) — without
    // it, raw-tier reps could never be a natural producer for the single
    // most common kind of recipe input, and named AI-to-AI trading would
    // only ever fire for the rarer PART-tier secondary-slot matches.
    const upkeep = rate * rep.base * 0.05;
    if (!(upkeep > 0)) return;
    const fillScale = Math.max(0, Math.min(1, budget / upkeep));
    if (fillScale <= 0) return;
    t.cash -= upkeep * fillScale;
    const output = Math.floor(rate * fillScale);
    if (output > 0) {
      repRuntime.owners[t.name] = (repRuntime.owners[t.name] ?? 0) + output;
      logActivity(state, t.name, produceVerb(t.name, rep.name), `${output}× ${rep.name}`);
    }
    return;
  }

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

  // fillScale (above) is computed ONLY from market-stock-cap + cash — i.e.
  // exactly as if every unit had to come from the anonymous floor. A named
  // AI-to-AI trade below never increases how MUCH gets filled this cycle,
  // only WHERE the (already-determined) spend goes — reroutes the payment to
  // a real counterparty when one exists, instead of the market/void. Total
  // cash out and total units consumed for `p` are identical either way.
  for (const p of plan) {
    let remaining = p.need * fillScale;
    if (remaining <= 0) continue;

    // Prefer a real company that actually makes this input, if one holds
    // any — a visible, named transaction at the same per-unit price a
    // market draw would cost. Tries every matching producer (their own held
    // stock is already small/self-limiting, per how little they themselves
    // produce each cycle) before falling back to the floor for the rest.
    for (const sellerName of naturalProducersOf(p.it.id)) {
      if (remaining <= 0) break;
      if (sellerName === t.name) continue; // can't be your own supplier
      const have = p.it.owners[sellerName] ?? 0;
      if (have <= 0) continue;
      const seller = state.traders.find((x) => x.name === sellerName);
      if (!seller) continue;
      // Floored to a whole unit — same reason production output is floored
      // (see above): a fractional remainder left in owners[sellerName] could
      // later go negative when traderAct()'s sell branch decrements it by
      // exactly `1`, phantom-creating a unit. Whole units change hands.
      const take = Math.floor(Math.min(remaining, have));
      if (take <= 0) continue;
      const left = have - take;
      if (left > 0) p.it.owners[sellerName] = left;
      else delete p.it.owners[sellerName];
      const amount = take * p.it.value;
      t.cash -= amount;
      seller.cash += amount;
      logActivity(state, t.name, `bought ${take}× ${p.it.name} from`, sellerName);
      remaining -= take;
    }

    // Whatever a producer couldn't cover still draws from the abstract
    // floor, exactly as before — and only THIS portion counts against the
    // shared per-item draw cap (a direct sale isn't a floor purchase).
    if (remaining > 0) {
      t.cash -= remaining * p.it.value;
      p.it.stock = Math.max(0, p.it.stock - remaining);
      budgets.get(p.it.id)!.drawn += remaining;
    }
  }

  // Produce: credit the company's OWN holdings with what it just made — real
  // inventory, not vanished value. Scales with the SAME fillScale as the
  // inputs (can't manufacture more than what was actually sourced). Goes to
  // owners[name], never floor `stock` — the existing traderAct() sell branch
  // (unchanged) is what eventually puts some of this back on the floor for
  // anyone to buy; nothing new needed there.
  //
  // Floored to a whole unit (same as produceFactories() already floors a
  // player line's rate) — NOT because fractional accounting is unsafe in
  // general (the input side above stays continuous on purpose), but because
  // traderAct()'s existing sell branch decrements a held quantity by exactly
  // `1`. A fractional credit here (rate × AI_APPETITE_MUL is often non-integer)
  // could leave a sub-1 remainder that decrement pushes negative, which then
  // gets deleted as "empty" while stock still gained a full unit back —
  // phantom unit creation. Whole units in, whole units out.
  const output = Math.floor(rate * fillScale);
  if (output > 0) {
    repRuntime.owners[t.name] = (repRuntime.owners[t.name] ?? 0) + output;
    logActivity(state, t.name, produceVerb(t.name, rep.name), `${output}× ${rep.name}`);
  }
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
