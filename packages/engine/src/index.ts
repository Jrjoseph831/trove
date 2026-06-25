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
  RuntimeItem,
  Trader,
  WorldState,
} from "./types";

export * from "./types";
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

  // 6. Snapshot net worth.
  state.nwHist.push(netWorth(state, "YOU"));
  if (state.nwHist.length > 30) state.nwHist.shift();
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
/** Total belt lanes the bays can move per cycle. */
export function floorLaneCapacity(slots: number): number {
  return floorBays(slots) * LANES_PER_BAY;
}
/** Belt lanes a line at this rate occupies. */
export function lineLanes(rate: number): number {
  return Math.max(1, Math.ceil(rate / LANE_UNITS));
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

  // Floor (bay) upkeep burns every cycle the floor is in use.
  state.cash -= floorBays(state.floorSlots) * BAY_UPKEEP;

  // Congestion: total belt lanes demanded by online lines vs bay capacity.
  // Over capacity, every line ships slower (a shared-belt bottleneck).
  let load = 0;
  for (const f of lines) {
    if (state.cycle < f.onlineCycle) continue;
    const out = state.items.find((i) => i.id === f.itemId);
    if (out) load += lineLanes(effectiveSpec(out, f.modules).rate);
  }
  const cap = floorLaneCapacity(state.floorSlots);
  const throttle = load > cap ? cap / load : 1;

  for (const f of lines) {
    if (state.cycle < f.onlineCycle) {
      f.status = "building";
      continue;
    }
    const out = state.items.find((i) => i.id === f.itemId);
    if (!out) continue;
    const spec = effectiveSpec(out, f.modules); // modules fold into the economics
    state.cash -= spec.upkeep; // upkeep always burns

    // Congestion slows the line's effective throughput this cycle.
    const rate = Math.max(1, Math.floor(spec.rate * throttle));

    const recipe = recipeOf(out);
    const inputs = recipe?.inputs ?? [];
    // Resolve input items and check the vault can cover a full batch
    // (module input multiplier shifts how much material a batch needs).
    const batch = inputs.map((inp) => ({
      it: state.items.find((i) => i.id === inp.itemId),
      need: Math.ceil(inp.qty * rate * spec.inputMul),
    }));
    const canRun = batch.every((b) => b.it && ownedYou(b.it) >= b.need);

    if (!canRun) {
      f.status = "idle";
      continue;
    }
    for (const b of batch) takeYou(b.it!, b.need);
    giveYou(out, rate);
    f.status = "running";
    pushLog(state, "YOU", "produced", `${rate}× ${out.name}`);
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
