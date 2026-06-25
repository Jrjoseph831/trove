/**
 * @trove/engine — the economic engine.
 *
 * Pure logic, DOM-free, identical client-side (sandbox) and server-side
 * (Lambda settlement). Behavioral source of truth: prototype/vault-terminal.html.
 * Model spec: specs/02_ENGINE.md. Every random draw goes through ./rng so the
 * whole simulation is deterministic under a seeded RNG.
 */
import {
  brands,
  canProduce,
  effectiveSpec,
  factorySpec,
  items as catalog,
  moduleCost,
  news as newsBank,
  recipeOf,
  sectorKeys,
} from "@trove/data";
import type { News, SectorKey } from "@trove/data";
import { rand, rexp } from "./rng";
import type {
  ActiveStory,
  Factory,
  ItemFlow,
  Ledger,
  RuntimeItem,
  Trader,
  WorldState,
} from "./types";

/** A zeroed report-period ledger. */
export function emptyLedger(): Ledger {
  return {
    produced: 0,
    listingUnits: 0,
    listingRev: 0,
    orderUnits: 0,
    orderRev: 0,
    bought: 0,
    spent: 0,
    soldUnits: 0,
    soldRev: 0,
    upkeep: 0,
    items: {},
  };
}

/** Get-or-create a per-item flow row in a ledger. */
export function itemFlow(led: Ledger, id: number): ItemFlow {
  return (led.items[id] ??= {
    produced: 0,
    sold: 0,
    soldRev: 0,
    bought: 0,
    spent: 0,
  });
}

export * from "./types";
export * from "./orders";
export { setRng, resetRng, rand, rexp, mulberry32 } from "./rng";

// ── Constants ────────────────────────────────────────────────────────────────

/** 1 cycle = 6 real hours — the world settles on the UTC 6h marks
 *  (00:00 / 06:00 / 12:00 / 18:00), the same beats the newsroom cron fires on. */
export const SEC_PER_CYCLE = 21600;
/** One cycle in milliseconds (for wall-clock alignment). */
export const CYCLE_MS = SEC_PER_CYCLE * 1000;

/** The global 6h cycle index since the epoch — identical to the number the
 *  newsroom generator stamps on its beats, so client + feed share one clock. */
export function wallCycle(now: number = Date.now()): number {
  return Math.floor(now / CYCLE_MS);
}

/** Progress (0..1) through the current 6h block. At a UTC 6h mark this is ~0,
 *  so a world seeded with it settles exactly on the next mark. */
export function wallCycleFrac(now: number = Date.now()): number {
  return (now % CYCLE_MS) / CYCLE_MS;
}

/** Live factory clock — DECOUPLED from the 6h market/news cycle so the floor
 *  feels alive. Lines come online and produce a batch on this fast beat while
 *  news + prices still turn on the slow 6h cycle. The production cron and the
 *  factory build path both index factory cycles by this, so onlineCycle and the
 *  produce check share one basis. */
export const PROD_SEC_PER_CYCLE = 300; // 5 real minutes per factory batch
export const PROD_CYCLE_MS = PROD_SEC_PER_CYCLE * 1000;
/** The live production-tick index since the epoch (one every PROD_SEC_PER_CYCLE). */
export function wallProdCycle(now: number = Date.now()): number {
  return Math.floor(now / PROD_CYCLE_MS);
}
/** Starting player cash. */
export const START_CASH = 25000;
// ── Factory floor ───────────────────────────────────────────────────────────
/** Line slots a fresh floor holds. */
export const STARTING_SLOTS = 2;
/** Slots gained per expansion. */
export const SLOTS_PER_EXPAND = 2;
/** Line slots served by one shipping bay. */
export const SLOTS_PER_BAY = 2;
/** Belt lanes each bay can move. */
export const LANES_PER_BAY = 3;
/** Output units one belt lane carries per cycle. */
export const LANE_UNITS = 2500;
/** Cash upkeep per shipping bay per cycle. */
export const BAY_UPKEEP = 120;
/** Interest accrued on debt per cycle. */
export const DEBT_RATE = 0.0005;
/** Cycles a fresh world is warmed up so it opens mid-story, not flat. */
export const WARMUP_CYCLES = 8;
/** How many recent news scenarios to avoid repeating. */
export const RECENT_NEWS_WINDOW = 14;

// brand → home sector, for trader bias matching.
const brandHomeSector = new Map<string, SectorKey>(
  brands.map((b) => [b.name, b.homeSector]),
);

// ── World construction ─────────────────────────────────────────────────────

function freshTraders(): Trader[] {
  const has = (s: string) => sectorKeys.includes(s);
  return [
    { name: "Bedrock_Capital", cash: 160_000, bias: has("construction") ? "construction" : null, next: rexp(1.1) },
    { name: "Wayfront_Logistics", cash: 120_000, bias: has("logistics") ? "logistics" : null, next: rexp(1.0) },
    { name: "Halcyon_Holdings", cash: 200_000, bias: has("luxury") ? "luxury" : null, next: rexp(1.4) },
    { name: "Meridian_Tech", cash: 150_000, bias: has("technology") ? "technology" : null, next: rexp(1.2) },
    { name: "Open_Index", cash: 140_000, bias: null, next: rexp(1.3) },
  ];
}

/** A pristine world: every item at baseline, sectors at 1.0, no news yet. */
export function freshState(): WorldState {
  const items: RuntimeItem[] = catalog.map((d) => ({
    ...d,
    stock: d.edition === null ? d.stockNormal : d.edition,
    remaining: d.edition === null ? Infinity : d.edition,
    owners: {},
    value: d.base,
    prevValue: d.base,
    myCopies: [],
  }));

  const sectorIdx: Record<SectorKey, number> = {};
  for (const s of sectorKeys) sectorIdx[s] = 1;

  return {
    cycle: 1,
    cycleFrac: 0,
    cash: START_CASH,
    debt: 0,
    rate: DEBT_RATE,
    items,
    sectorIdx,
    active: [],
    archive: [],
    front: null,
    traders: freshTraders(),
    factories: [],
    floorSlots: STARTING_SLOTS,
    infra: { power: false, router: false, qc: false },
    listPrices: {},
    producedQty: {},
    listed: {},
    orders: [],
    reputation: 0,
    deskAuto: { specialist: false, autoFulfill: false, minMargin: 0.1 },
    lastOrderAt: 0,
    ledger: emptyLedger(),
    reports: [],
    periodNo: 0,
    log: [],
    recentNewsIdx: [],
    nwHist: [START_CASH],
  };
}

/**
 * A ready-to-play world: fresh, then warmed up so it opens with a front page
 * and some sector drift (the prototype warms 8 cycles, then resets the clock).
 */
export function createWorld(warmup = WARMUP_CYCLES): WorldState {
  const S = freshState();
  for (let i = 0; i < warmup; i++) settleCycle(S);
  S.cycle = 1;
  S.nwHist = [START_CASH];
  // Warmup settlements aren't real gameplay — clear the report log + counters so
  // Day 1 starts when the player does (the client may then hydrate saved history).
  S.reports = [];
  S.periodNo = 0;
  S.ledger = emptyLedger();
  return S;
}

// ── Pricing (pure) ───────────────────────────────────────────────────────────

/** Item's effective demand = weighted blend of its sectors' indices. */
export function itemDemand(state: WorldState, it: RuntimeItem): number {
  let num = 0;
  let den = 0;
  for (const s in it.weights) {
    const w = it.weights[s] ?? 0;
    num += (state.sectorIdx[s] ?? 1) * w;
    den += w;
  }
  return den ? num / den : 1;
}

/** Demand elasticity — slow-restock items swing harder (can't replenish). */
export function elasticity(it: RuntimeItem): number {
  return it.edition !== null ? 1.4 : 0.5 + Math.min(1.2, 1200 / (it.restock + 40));
}

/** Scarcity pressure: depleted stock firms price; abundance softens it. */
export function scarcity(it: RuntimeItem): number {
  if (it.edition !== null) {
    return 1 + ((it.edition - it.remaining) / it.edition) * 0.6;
  }
  if (it.stockNormal <= 0) return 1;
  const ratio = it.stock / it.stockNormal;
  return Math.max(0.7, Math.min(2.2, 1 + (1 - ratio) * 0.8));
}

/** Target price for an item given current demand + scarcity. */
export function priceItem(state: WorldState, it: RuntimeItem): number {
  const dem = itemDemand(state, it);
  const target = it.base * (1 + (dem - 1) * elasticity(it)) * scarcity(it);
  return Math.max(it.base * 0.25, target);
}

// ── Holdings / wealth ────────────────────────────────────────────────────────

export function held(it: RuntimeItem, owner: string): number {
  return it.owners[owner] ?? 0;
}

export function canBuy(it: RuntimeItem): boolean {
  return it.edition !== null ? it.remaining > 0 : it.stock > 0;
}

export function assetsValue(state: WorldState, owner: string): number {
  let v = 0;
  for (const it of state.items) v += held(it, owner) * it.value;
  return v;
}

export function netWorth(state: WorldState, owner: string): number {
  const base =
    owner === "YOU"
      ? state.cash - state.debt
      : state.traders.find((t) => t.name === owner)?.cash ?? 0;
  return base + assetsValue(state, owner);
}

export function creditLimit(state: WorldState): number {
  return Math.floor(assetsValue(state, "YOU") * 0.5);
}

// ── Activity log ─────────────────────────────────────────────────────────────

export function pushLog(
  state: WorldState,
  who: string,
  verb: string,
  it: string,
): void {
  state.log.unshift({ who, verb, it });
  if (state.log.length > 30) state.log.pop();
}

// ── News sequencing (zero runtime AI) ────────────────────────────────────────

/**
 * Pick the next scenario by `weight`, avoiding any of the last
 * RECENT_NEWS_WINDOW stories so the same headline doesn't recycle quickly.
 */
function pickNewsIdx(state: WorldState): number {
  const recent = new Set(state.recentNewsIdx);
  let candidates: number[] = [];
  for (let i = 0; i < newsBank.length; i++) {
    if (!recent.has(i)) candidates.push(i);
  }
  if (candidates.length === 0) {
    candidates = newsBank.map((_, i) => i);
  }
  let total = 0;
  for (const i of candidates) total += newsBank[i]?.weight ?? 1;
  let r = rand() * total;
  let idx = candidates[0] ?? 0;
  for (const i of candidates) {
    r -= newsBank[i]?.weight ?? 1;
    if (r <= 0) {
      idx = i;
      break;
    }
  }
  return idx;
}

// ── Trading ──────────────────────────────────────────────────────────────────

/** AI trader takes one action: ~30% sell a holding, else chase rising demand. */
export function traderAct(state: WorldState, t: Trader): void {
  const owned = state.items.filter((i) => held(i, t.name) > 0);
  if (owned.length && rand() < 0.3) {
    const it = owned[Math.floor(rand() * owned.length)]!;
    it.owners[t.name]!--;
    if ((it.owners[t.name] ?? 0) <= 0) delete it.owners[t.name];
    if (it.edition !== null) it.remaining++;
    else it.stock++;
    t.cash += it.value;
    pushLog(state, t.name, "sold", it.name);
    return;
  }

  // Traders read the HIDDEN sector signal, never the news text.
  let best: RuntimeItem | null = null;
  let bestW = -Infinity;
  for (const i of state.items) {
    if (!canBuy(i) || i.value > t.cash) continue;
    const dem = itemDemand(state, i);
    const w =
      (dem - 1) * 3 +
      (brandHomeSector.get(i.brand) === t.bias ? 0.5 : 0) +
      (i.edition !== null ? 0.4 : 0) +
      rand() * 0.6;
    if (w > bestW) {
      bestW = w;
      best = i;
    }
  }
  if (!best) return;

  best.owners[t.name] = (best.owners[t.name] ?? 0) + 1;
  if (best.edition !== null) best.remaining--;
  else best.stock = Math.max(0, best.stock - 1);
  t.cash -= best.value;
  pushLog(state, t.name, "acquired", best.name);
}

export interface BuyResult {
  ok: true;
  it: RuntimeItem;
  /** Edition copy number claimed (for the reveal), or null for open items. */
  copyNo: number | null;
}

export function playerBuy(state: WorldState, id: number): BuyResult | null {
  const it = state.items[id];
  if (!it || !canBuy(it) || it.value > state.cash) return null;
  it.owners["YOU"] = (it.owners["YOU"] ?? 0) + 1;
  let copyNo: number | null = null;
  if (it.edition !== null) {
    copyNo = it.edition - it.remaining + 1;
    it.remaining--;
    it.myCopies.push(copyNo);
  } else {
    it.stock = Math.max(0, it.stock - 1);
  }
  state.cash -= it.value;
  it.buyAt = it.value;
  state.ledger.bought += 1;
  state.ledger.spent += it.value;
  const bf = itemFlow(state.ledger, it.id);
  bf.bought += 1;
  bf.spent += it.value;
  return { ok: true, it, copyNo };
}

export interface SellResult {
  ok: true;
  it: RuntimeItem;
  /** Realized profit/loss on the unit. */
  pl: number;
}

export function playerSell(state: WorldState, id: number): SellResult | null {
  const it = state.items[id];
  if (!it || held(it, "YOU") <= 0) return null;
  // Liquidity rule: you can only dump BOUGHT units to the market. Produced units
  // must be sold via listings (passive) or orders — not liquidated at will.
  const produced = state.producedQty?.[id] ?? 0;
  const bought = held(it, "YOU") - produced;
  if (bought <= 0) return null;
  const pl = it.value - (it.buyAt ?? it.value);
  it.owners["YOU"]!--;
  if ((it.owners["YOU"] ?? 0) <= 0) delete it.owners["YOU"];
  if (it.edition !== null) {
    it.remaining++;
    it.myCopies.pop();
  } else {
    it.stock++;
  }
  state.cash += it.value;
  state.ledger.soldUnits += 1;
  state.ledger.soldRev += it.value;
  const sf = itemFlow(state.ledger, it.id);
  sf.sold += 1;
  sf.soldRev += it.value;
  return { ok: true, it, pl };
}

// ── Debt ─────────────────────────────────────────────────────────────────────

export function borrow(state: WorldState, amount: number): boolean {
  const room = creditLimit(state) - state.debt;
  const a = Math.min(amount, room);
  if (a <= 0) return false;
  state.debt += a;
  state.cash += a;
  return true;
}

export function repay(state: WorldState, amount: number): boolean {
  const a = Math.min(amount, state.debt, state.cash);
  if (a <= 0) return false;
  state.debt -= a;
  state.cash -= a;
  return true;
}

// ── Time ───────────────────────────────────────────────────────────────────

/**
 * Settle one cycle: decay news, roll a new front page, re-index sectors,
 * restock the floor, reprice everything. The real overnight gap.
 */
export function settleCycle(state: WorldState): void {
  state.cycle++;

  // 1. Decay active stories; expire finished ones.
  state.active = state.active.filter((a: ActiveStory) => {
    a.cyclesLeft--;
    return a.cyclesLeft > 0;
  });

  // 2. Roll a new front-page story (weighted, avoiding recent repeats).
  const idx = pickNewsIdx(state);
  state.recentNewsIdx.push(idx);
  if (state.recentNewsIdx.length > RECENT_NEWS_WINDOW) {
    state.recentNewsIdx.shift();
  }
  const n = newsBank[idx] as News;
  state.front = { ...n, cycle: state.cycle };
  state.archive.unshift({ head: n.head, kick: n.kick, cycle: state.cycle });
  if (state.archive.length > 10) state.archive.pop();
  if (Object.keys(n.effects).length) {
    state.active.push({ news: n, cyclesLeft: n.dur });
  }

  // 3. Recompute sector indices: ease toward 1 + summed active effects.
  for (const s of sectorKeys) {
    let target = 1;
    for (const a of state.active) {
      const e = a.news.effects[s];
      if (e) target += e * (a.cyclesLeft / a.news.dur);
    }
    const cur = state.sectorIdx[s] ?? 1;
    state.sectorIdx[s] = Math.max(
      0.55,
      cur + (target - cur) * 0.55 + (rand() - 0.5) * 0.01,
    );
  }

  // 4. Restock open items (capped at normal); reprice everything.
  for (const it of state.items) {
    if (it.edition === null) {
      it.stock = Math.min(it.stockNormal, it.stock + it.restock);
    }
    it.prevValue = it.value;
    it.value = priceItem(state, it);
  }

  // 5. Run player factories: pay upkeep, consume inputs, produce to the vault.
  produceFactories(state);

  // 5b. Sell produced stock through your market listings (the passive channel).
  sellListings(state);

  // 6. Snapshot net worth + capture this period's report row.
  state.nwHist.push(netWorth(state, "YOU"));
  if (state.nwHist.length > 30) state.nwHist.shift();
  captureReport(state);
}

/**
 * One LIVE production tick for a player, on the FAST factory clock (decoupled
 * from the 6h market cycle). Factories produce and listings sell against the
 * market prices already settled on the singleton; flows accumulate in the ledger
 * but the report is NOT captured here — that happens per market flip (6h) so the
 * Trove-day calendar (2 flips/day) stays intact. Drive `state.cycle` by the
 * production-tick index (wallProdCycle) so online checks line up with build.
 */
export function runProduction(state: WorldState): void {
  produceFactories(state);
  sellListings(state);
}

/**
 * Capture a market FLIP (6h) for a player: snapshot net worth and file the
 * report row from the flows accumulated across this period, then reset the
 * ledger. Run once per 6h market flip, after that period's production ticks.
 */
export function captureFlip(state: WorldState): void {
  state.nwHist.push(netWorth(state, "YOU"));
  if (state.nwHist.length > 30) state.nwHist.shift();
  captureReport(state);
}

/** Full per-cycle settlement (sandbox: one cycle = produce + sell + flip). Live
 *  splits these onto two clocks — see runProduction / captureFlip. */
export function settlePlayerCycle(state: WorldState): void {
  runProduction(state);
  captureFlip(state);
}

/** Capture the period that just settled as a report row, then reset the ledger.
 *  Period → Trove day (2 flips/day) + AM/PM half. Kept to a rolling window. */
function captureReport(state: WorldState): void {
  if (!state.ledger) state.ledger = emptyLedger();
  const period = state.periodNo ?? 0;
  state.reports = state.reports ?? [];
  state.reports.push({
    period,
    day: Math.floor(period / 2) + 1,
    half: (period % 2) as 0 | 1,
    at: 0,
    netWorth: Math.round(netWorth(state, "YOU")),
    cash: Math.round(state.cash),
    assets: Math.round(assetsValue(state, "YOU")),
    debt: Math.round(state.debt),
    flows: { ...state.ledger },
  });
  if (state.reports.length > 240) state.reports.shift();
  state.periodNo = period + 1;
  state.ledger = emptyLedger();
}

// ── Factories (player as supplier) ──────────────────────────────────────────

/** Held by the player ("YOU"), or 0. */
function ownedYou(it: RuntimeItem): number {
  return it.owners["YOU"] ?? 0;
}

function giveYou(it: RuntimeItem, qty: number): void {
  it.owners["YOU"] = ownedYou(it) + qty;
}

function takeYou(it: RuntimeItem, qty: number): void {
  const left = ownedYou(it) - qty;
  if (left > 0) it.owners["YOU"] = left;
  else delete it.owners["YOU"];
}

/**
 * Build a production line for an item. Charges the one-time build cost; the line
 * comes online after its build delay. Returns the factory, or null if the item
 * can't be produced or the player can't afford it.
 */
export function buildFactory(state: WorldState, itemId: number): Factory | null {
  const out = state.items.find((i) => i.id === itemId);
  if (!out || !canProduce(out)) return null;
  if (state.factories.length >= state.floorSlots) return null; // floor full
  const spec = factorySpec(out);
  if (state.cash < spec.buildCost) return null;
  state.cash -= spec.buildCost;
  const f: Factory = {
    id: `f${state.cycle}-${Math.floor(rand() * 1e9).toString(36)}`,
    itemId,
    builtCycle: state.cycle,
    onlineCycle: state.cycle + spec.buildCycles,
    modules: [],
    status: "building",
  };
  state.factories.push(f);
  pushLog(state, "YOU", "broke ground on", `${out.name} line`);
  return f;
}

// ── Floor capacity (warehouse) ───────────────────────────────────────────────
/** Shipping bays a floor of `slots` line-slots has. */
export function floorBays(slots: number): number {
  return Math.max(1, Math.ceil(slots / SLOTS_PER_BAY));
}
/** Belt lanes per bay, including the Auto-Router upgrade. */
export function lanesPerBay(state: WorldState): number {
  return LANES_PER_BAY + (state.infra?.router ? 1 : 0);
}
/** Total belt lanes the bays can move per cycle (pass the per-bay lane count). */
export function floorLaneCapacity(
  slots: number,
  perBay: number = LANES_PER_BAY,
): number {
  return floorBays(slots) * perBay;
}

// ── Floor infrastructure (one-time floor-wide upgrades) ──────────────────────
export const QC_PREMIUM = 0.06;
export interface InfraUpgrade {
  id: "power" | "router" | "qc";
  name: string;
  blurb: string;
  cost: number;
}
export const INFRA_UPGRADES: InfraUpgrade[] = [
  { id: "power", name: "Power Plant", blurb: "−20% upkeep on every line", cost: 18000 },
  { id: "router", name: "Auto-Router", blurb: "+1 belt lane per bay", cost: 24000 },
  { id: "qc", name: "QC Hub", blurb: "+6% on everything you sell", cost: 20000 },
];
/** Buy a floor upgrade (once). Returns false if owned or unaffordable. */
export function buyInfra(state: WorldState, id: InfraUpgrade["id"]): boolean {
  if (state.infra[id]) return false;
  const u = INFRA_UPGRADES.find((x) => x.id === id);
  if (!u || state.cash < u.cost) return false;
  state.cash -= u.cost;
  state.infra[id] = true;
  pushLog(state, "YOU", "installed", u.name);
  return true;
}
/** Upkeep multiplier from infrastructure (Power Plant). */
export function upkeepFactor(state: WorldState): number {
  return state.infra?.power ? 0.8 : 1;
}
/** Sell-price multiplier from infrastructure (QC Hub). */
export function qcFactor(state: WorldState): number {
  return state.infra?.qc ? 1 + QC_PREMIUM : 1;
}
/** Belt lanes a line at this rate occupies. */
export function lineLanes(rate: number): number {
  return Math.max(1, Math.ceil(rate / LANE_UNITS));
}
/** Which bay a line ships to: its explicit assignment, else auto by slot order,
 *  clamped to the bays that currently exist. */
export function resolveBay(f: Factory, index: number, bays: number): number {
  const b = f.bay ?? Math.floor(index / SLOTS_PER_BAY);
  return Math.max(0, Math.min(bays - 1, b));
}
/** Route a line to a specific bay. */
export function routeFactory(
  state: WorldState,
  id: string,
  bay: number,
): boolean {
  const f = state.factories.find((x) => x.id === id);
  if (!f) return false;
  f.bay = Math.max(0, Math.min(floorBays(state.floorSlots) - 1, bay));
  return true;
}

/** Set an input's source: a feeder line that makes it in-house, or null = market.
 *  The feeder must exist, not be the line itself, and produce that input. */
export function setSource(
  state: WorldState,
  lineId: string,
  inputItemId: number,
  feederId: string | null,
): boolean {
  const f = state.factories.find((x) => x.id === lineId);
  if (!f) return false;
  if (!f.sources) f.sources = {};
  if (feederId) {
    const feeder = state.factories.find((x) => x.id === feederId);
    if (!feeder || feeder.id === lineId || feeder.itemId !== inputItemId)
      return false;
    f.sources[inputItemId] = feederId;
  } else {
    delete f.sources[inputItemId];
  }
  return true;
}
/** Cash to add the next SLOTS_PER_EXPAND slots (each expansion pricier). */
export function expandCost(slots: number): number {
  const step = Math.round((slots - STARTING_SLOTS) / SLOTS_PER_EXPAND);
  return 8000 * (step + 1);
}
/** Expand the floor: more slots + bays, for a one-time cost. */
export function expandFloor(state: WorldState): boolean {
  const cost = expandCost(state.floorSlots);
  if (state.cash < cost) return false;
  state.cash -= cost;
  state.floorSlots += SLOTS_PER_EXPAND;
  pushLog(state, "YOU", "expanded the floor to", `${state.floorSlots} slots`);
  return true;
}

/** Tear down a line. No refund in v1. */
export function demolishFactory(state: WorldState, id: string): boolean {
  const i = state.factories.findIndex((f) => f.id === id);
  if (i < 0) return false;
  state.factories.splice(i, 1);
  return true;
}

/** Install a module on a line, charging its cost. Returns false if the line
 *  doesn't exist, the module is already installed, or you can't afford it. */
export function installModule(
  state: WorldState,
  factoryId: string,
  moduleId: string,
): boolean {
  const f = state.factories.find((x) => x.id === factoryId);
  if (!f) return false;
  if (f.modules.includes(moduleId)) return false;
  const out = state.items.find((i) => i.id === f.itemId);
  if (!out) return false;
  const cost = moduleCost(out, moduleId);
  if (cost <= 0 || state.cash < cost) return false;
  state.cash -= cost;
  f.modules.push(moduleId);
  return true;
}

/** Remove a module, refunding half its install cost. */
export function uninstallModule(
  state: WorldState,
  factoryId: string,
  moduleId: string,
): boolean {
  const f = state.factories.find((x) => x.id === factoryId);
  if (!f || !f.modules.includes(moduleId)) return false;
  const out = state.items.find((i) => i.id === f.itemId);
  f.modules = f.modules.filter((m) => m !== moduleId);
  if (out) state.cash += Math.round(moduleCost(out, moduleId) * 0.5);
  return true;
}

/**
 * One cycle of production for every line. Upkeep burns whether or not the line
 * runs. A line runs only if the vault holds enough of every input for a full
 * batch (rate × per-unit input); it then consumes those inputs and credits the
 * output to the vault. Short on inputs → the line idles (still paying upkeep).
 * Output goes to the vault, not the floor — price impact happens when the
 * player sells, via the existing scarcity term.
 */
function produceFactories(state: WorldState): void {
  // Older persisted world docs (e.g. the live singleton) predate factories.
  const lines = state.factories ?? [];
  if (lines.length === 0) return;

  const upMul = upkeepFactor(state); // Power Plant cuts upkeep
  // Floor (bay) upkeep burns every cycle the floor is in use.
  const bayUpkeep = Math.round(floorBays(state.floorSlots) * BAY_UPKEEP * upMul);
  state.cash -= bayUpkeep;
  state.ledger.upkeep += bayUpkeep;

  // Congestion is per-bay: lines routed to a bay share its lane count (raised by
  // the Auto-Router). Push a bay past capacity and every line on it ships slower.
  const perBay = lanesPerBay(state);
  const bays = floorBays(state.floorSlots);
  const bayLoad = new Array<number>(bays).fill(0);
  lines.forEach((f, i) => {
    if (state.cycle < f.onlineCycle) return;
    const out = state.items.find((x) => x.id === f.itemId);
    if (out) bayLoad[resolveBay(f, i, bays)]! += lineLanes(effectiveSpec(out, f.modules).rate);
  });

  lines.forEach((f, i) => {
    if (state.cycle < f.onlineCycle) {
      f.status = "building";
      return;
    }
    const out = state.items.find((x) => x.id === f.itemId);
    if (!out) return;
    const spec = effectiveSpec(out, f.modules); // modules fold into the economics
    const lineUpkeep = Math.round(spec.upkeep * upMul);
    state.cash -= lineUpkeep; // upkeep always burns
    state.ledger.upkeep += lineUpkeep;

    // This line's bay congestion slows its effective throughput this cycle.
    const load = bayLoad[resolveBay(f, i, bays)]!;
    const throttle = load > perBay ? perBay / load : 1;
    const rate = Math.max(1, Math.floor(spec.rate * throttle));

    const recipe = recipeOf(out);
    const inputs = recipe?.inputs ?? [];
    // Each input is either IN-HOUSE (pull from the vault, which a feeder line
    // fills — idle if it can't keep up) or MARKET (auto-buy any shortfall at the
    // current price). Casuals leave every input on market = no manual stocking.
    const plan = inputs.map((inp) => {
      const it = state.items.find((x) => x.id === inp.itemId);
      const need = Math.ceil(inp.qty * rate * spec.inputMul);
      return {
        it,
        need,
        inHouse: !!f.sources?.[inp.itemId],
        have: it ? ownedYou(it) : 0,
      };
    });
    let cashCost = 0;
    let ok = true;
    for (const p of plan) {
      if (!p.it) {
        ok = false;
        break;
      }
      if (p.inHouse) {
        if (p.have < p.need) {
          ok = false; // feeder hasn't stocked enough
          break;
        }
      } else {
        cashCost += Math.max(0, p.need - p.have) * p.it.value; // buy shortfall
      }
    }
    if (!ok || state.cash < cashCost) {
      f.status = "idle";
      return;
    }
    for (const p of plan) {
      if (p.inHouse) takeYou(p.it!, p.need);
      else if (p.have > 0) takeYou(p.it!, Math.min(p.have, p.need));
    }
    state.cash -= cashCost;
    state.ledger.upkeep += cashCost; // input spend
    state.ledger.produced += rate;
    itemFlow(state.ledger, out.id).produced += rate;
    giveYou(out, rate);
    // Track these as PRODUCED units (can't be dumped; sold via listings/orders).
    state.producedQty[out.id] = (state.producedQty[out.id] ?? 0) + rate;
    f.status = "running";
    pushLog(state, "YOU", "produced", `${rate}× ${out.name}`);
  });
}

/** Is an item's produced stock listed for passive sale? (Default: yes.) */
export function isListed(state: WorldState, id: number): boolean {
  return state.listed?.[id] !== false;
}
/** List or unlist an item's produced stock (unlisted = held, no passive sale). */
export function setListed(state: WorldState, id: number, on: boolean): void {
  if (!state.listed) state.listed = {};
  if (on) delete state.listed[id]; // listed is the default; keep the map small
  else state.listed[id] = false;
}

/** Fraction of a product's listed (produced) stock that can clear per cycle at
 *  market price; cheaper-than-market clears faster, pricier slower. */
const LISTING_BASE_FRAC = 0.25;

/**
 * Passive market sales: each cycle the market buys some of your PRODUCED stock
 * through your listings, at YOUR price. Cheaper listings clear faster. Drains
 * producedQty + the vault, credits cash. (The standard sell channel; produced
 * goods can't be dumped, only sold this way or via orders.)
 */
function sellListings(state: WorldState): void {
  const prod = state.producedQty;
  if (!prod) return;
  for (const idStr of Object.keys(prod)) {
    const id = Number(idStr);
    const have = prod[id] ?? 0;
    if (have <= 0) {
      delete prod[id];
      continue;
    }
    if (!isListed(state, id)) continue; // unlisted → held, no passive sale
    const it = state.items.find((i) => i.id === id);
    if (!it) continue;
    const mult = state.listPrices?.[id] ?? 1;
    const price = it.value * mult * qcFactor(state); // QC Hub lifts your price
    const demand = Math.max(0.04, Math.min(1.4, 1.8 - mult)); // price-sensitive
    const qty = Math.min(have, Math.ceil(have * LISTING_BASE_FRAC * demand));
    if (qty <= 0) continue;
    prod[id] = have - qty;
    if ((prod[id] ?? 0) <= 0) delete prod[id];
    takeYou(it, qty);
    const rev = Math.round(qty * price);
    state.cash += rev;
    state.ledger.listingUnits += qty;
    state.ledger.listingRev += rev;
    const lf = itemFlow(state.ledger, id);
    lf.sold += qty;
    lf.soldRev += rev;
    pushLog(state, "Market", "bought", `${qty}× ${it.name}`);
  }
}

/**
 * Advance time by `dt` cycles. Intraday is gentle noise + trader activity +
 * interest; settlement (news, repricing) only fires at cycle boundaries.
 */
export function advance(state: WorldState, dt: number): void {
  if (dt <= 0) return;
  state.cycleFrac += dt;

  // Gentle intraday drift — the market breathes, it does not lurch.
  for (const it of state.items) {
    it.value *= 1 + (rand() - 0.5) * 0.0006 * dt * 40;
  }

  // Traders fire on a Poisson schedule.
  for (const t of state.traders) {
    t.next -= dt;
    let guard = 0;
    while (t.next <= 0 && guard++ < 1000) {
      traderAct(state, t);
      t.next += rexp(t.bias ? 1.0 : 1.3);
    }
  }

  if (state.debt > 0) state.debt *= 1 + state.rate * dt;

  let guard = 0;
  while (state.cycleFrac >= 1 && guard++ < 10000) {
    state.cycleFrac -= 1;
    settleCycle(state);
  }
}
