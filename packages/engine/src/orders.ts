/**
 * Sandbox Order Desk — the demand side of the Factory.
 *
 * Clients send bulk contracts for goods, weighted toward what you PRODUCE (so
 * your factory output has a buyer) and toward sectors the news has heated (so
 * demand tracks the economy). You haggle the price within the client's hidden
 * budget, then fulfil from your vault by a deadline for cash + reputation.
 *
 * Pure logic over WorldState; the client drives timing by passing `now`. The
 * live desk (server) mirrors this — kept separate for now, to be unified.
 */
import {
  effectiveSpec,
  getItem,
  lotSize,
  pickClient,
  recipeOf,
  sectorKeys,
} from "@trove/data";
import type { Item, SectorKey } from "@trove/data";
import { rand } from "./rng";
import type { DeskAuto, Order, RuntimeItem, WorldState } from "./types";

// ── Order Desk automation (rep-gated) ────────────────────────────────────────
export const SPECIALIST_REP = 15; // Procurement Specialist unlocks here
export const AUTOFULFILL_REP = 25; // Auto-Fulfill unlocks here

/** Update desk-automation settings (margin clamped to a sane band). */
export function setDeskAuto(state: WorldState, patch: Partial<DeskAuto>): void {
  const cur = state.deskAuto ?? {
    specialist: false,
    autoFulfill: false,
    minMargin: 0.1,
  };
  state.deskAuto = { ...cur, ...patch };
  state.deskAuto.minMargin = Math.max(0, Math.min(0.5, state.deskAuto.minMargin));
}

/**
 * Procurement Specialist: auto-haggle every live offer. Hold a floor of
 * source value × (1 + minMargin); accept the moment the client's offer clears
 * it, push for more first, and walk if the client's budget can't reach the floor.
 */
export function autoNegotiate(state: WorldState, now: number): boolean {
  const a = state.deskAuto;
  if (!a?.specialist || repOf(state) < SPECIALIST_REP) return false;
  let changed = false;
  for (const o of [...(state.orders ?? [])]) {
    if (o.status !== "offer") continue;
    const it = state.items.find((x) => x.id === o.itemId);
    if (!it) continue;
    const floorUnit = it.value * (1 + a.minMargin);
    const floorTotal = Math.round(floorUnit * o.qty);
    let guard = 0;
    while (o.status === "offer" && guard++ < 8) {
      if (o.companyOffer >= floorTotal) {
        acceptSandboxOffer(state, o.id, now);
        changed = true;
        break;
      }
      const ask = Math.max(floorTotal, Math.round(floorUnit * 1.15 * o.qty));
      const r = negotiateSandbox(state, o.id, ask, now);
      changed = true;
      if (r.kind === "deal" || r.kind === "pullout" || r.kind === "invalid") break;
      if (o.round >= o.maxRounds && o.companyOffer < floorTotal) {
        declineSandboxOrder(state, o.id); // can't reach the floor — walk
        break;
      }
    }
  }
  return changed;
}

/** Auto-Fulfill: deliver any accepted order the moment you hold enough. */
export function autoFulfillOrders(state: WorldState, now: number): boolean {
  const a = state.deskAuto;
  if (!a?.autoFulfill || repOf(state) < AUTOFULFILL_REP) return false;
  let changed = false;
  for (const o of [...(state.orders ?? [])]) {
    if (o.status !== "accepted") continue;
    const it = state.items.find((x) => x.id === o.itemId);
    if (it && heldOfProduct(state, it) >= o.qty) {
      if (fulfillSandboxOrder(state, o.id, now).ok) changed = true;
    }
  }
  return changed;
}

// ── Your sell price ─────────────────────────────────────────────────────────
/** Your listing markup for an item (× market). 1 = at market. */
export function listMult(state: WorldState, itemId: number): number {
  return state.listPrices?.[itemId] ?? 1;
}
/** What your version of an item sells/lists for (market × your markup). */
export function listPriceOf(state: WorldState, item: RuntimeItem): number {
  return item.value * listMult(state, item.id);
}
/** Nudge your sell-price markup for an item (clamped to a sane band). */
export function setListPrice(
  state: WorldState,
  itemId: number,
  mult: number,
): void {
  if (!state.listPrices) state.listPrices = {};
  state.listPrices[itemId] = Math.max(0.7, Math.min(1.6, mult));
}

/** Your marginal cost to MAKE one unit of an item, or null if no line makes it.
 *  Materials (market price × per-unit × input multiplier) + amortised upkeep. */
export function productionCostOf(
  state: WorldState,
  item: RuntimeItem,
): number | null {
  const f = state.factories.find((x) => x.itemId === item.id);
  if (!f) return null;
  const seed: Item = getItem(item.id) ?? item;
  const spec = effectiveSpec(seed, f.modules);
  const inputs = recipeOf(seed)?.inputs ?? [];
  const mat =
    inputs.reduce((s, inp) => {
      const it = state.items.find((x) => x.id === inp.itemId);
      return s + (it?.value ?? 0) * inp.qty;
    }, 0) * spec.inputMul;
  return mat + spec.upkeep / spec.rate;
}

const OFFER_TTL = 3 * 60_000; // a live negotiation stands for 3 min
const DELIVER_TTL = 6 * 60_000; // 6 min to deliver once a price is agreed
const ROLL_INTERVAL = 22_000; // base: a new request ~every 22s (faster when hot)
const MAX_PENDING = 3;
const MAX_ORDERS = 6;
const MAX_ROUNDS = 3;
const MISS_PENALTY = 3;

export const repOf = (s: WorldState): number => s.reputation ?? 0;

// ── Products (decouple from brand/SKU) ───────────────────────────────────────
// Orders and production are about a PRODUCT (e.g. "Pallet Flatware Set"), not a
// specific brand's SKU. Same-named items are the same product, so producing any
// brand's version satisfies an order for that product.
export function productKey(item: { name: string }): string {
  return item.name.trim().toLowerCase();
}
/** Total units of a product you hold, across every brand/SKU of it. */
export function heldOfProduct(state: WorldState, item: RuntimeItem): number {
  const key = productKey(item);
  let n = 0;
  for (const it of state.items)
    if (productKey(it) === key) n += it.owners["YOU"] ?? 0;
  return n;
}
/** Do you run a line making this product (any brand of it)? */
export function producesProduct(state: WorldState, item: RuntimeItem): boolean {
  const key = productKey(item);
  return state.factories.some((f) => {
    const o = state.items.find((i) => i.id === f.itemId);
    return !!o && productKey(o) === key;
  });
}

/** Reputation gate on order size: higher standing unlocks pricier goods. */
function maxItemValue(rep: number): number {
  return 1500 + rep * 1500;
}

/** Reputation gained for fulfilling an order of a given quote. */
export function fulfilReward(quote: number): number {
  return Math.max(1, Math.floor(Math.log10(Math.max(10, quote))) - 1);
}

let seq = 0;
function newId(now: number): string {
  seq = (seq + 1) % 100000;
  return `s${now.toString(36)}${seq.toString(36)}`;
}

function topSector(weights: Record<string, number>): SectorKey {
  let best = "";
  let bestW = -1;
  for (const [s, w] of Object.entries(weights))
    if (w > bestW) {
      bestW = w;
      best = s;
    }
  return best;
}

/** Current demand heat of the hottest sector (0 = calm). */
function marketHeat(state: WorldState): number {
  let max = 0;
  for (const s of sectorKeys) max = Math.max(max, (state.sectorIdx[s] ?? 1) - 1);
  return Math.max(0, max);
}

/** Pick the item a new order will request: mostly things you PRODUCE, otherwise
 *  something from a heated sector, otherwise anything within your standing. */
function pickOrderItem(state: WorldState, rep: number): RuntimeItem | null {
  const cap = maxItemValue(rep);
  const within = state.items.filter((it) => it.value <= cap);
  if (!within.length) return null;

  const producedIds = [...new Set(state.factories.map((f) => f.itemId))];
  // Most demand targets your own production (the EXACT items your lines make),
  // so what you produce is what gets ordered — and you fulfil by producing.
  if (producedIds.length && rand() < 0.85) {
    const pool = producedIds
      .map((id) => state.items.find((i) => i.id === id))
      .filter((it): it is RuntimeItem => !!it);
    if (pool.length) return pool[Math.floor(rand() * pool.length)]!;
  }

  // Otherwise lean toward heated sectors (news-driven demand).
  const hot = sectorKeys.filter((s) => (state.sectorIdx[s] ?? 1) > 1.04);
  if (hot.length && rand() < 0.6) {
    const inHot = within.filter((it) => hot.includes(topSector(it.weights)));
    if (inHot.length) return inHot[Math.floor(rand() * inHot.length)]!;
  }
  return within[Math.floor(rand() * within.length)]!;
}

/** Build one fresh negotiable BULK order from the current world.
 *  For items you produce, the offer anchors to YOUR sell price with a bulk
 *  discount; for market goods it anchors to the market price. Either way it's
 *  floored so a deal always clears a profit, and quantities/prices vary. */
export function generateSandboxOrder(state: WorldState, now: number): Order | null {
  const rep = repOf(state);
  const it = pickOrderItem(state, rep);
  if (!it) return null;
  const produced = state.factories.some((f) => f.itemId === it.id);

  // Retail = what your version sells for (your price if you make it, else
  // market), lifted by the QC Hub upgrade.
  const qc = state.infra?.qc ? 1.06 : 1;
  const retail = Math.max(0.01, (produced ? listPriceOf(state, it) : it.value) * qc);
  // Cost floor: your production cost if you make it, else a market-buy proxy.
  const cost = produced
    ? (productionCostOf(state, it) ?? it.value * 0.6)
    : it.value * 0.7;

  // Bulk quantity — varied per order, bigger for cheaper goods. Snapped to lots.
  const lot = lotSize(getItem(it.id) ?? it);
  const targetGross = (3000 + rep * 2500) * (0.5 + rand() * 1.6);
  let qty = Math.max(1, Math.round(targetGross / retail));
  if (it.edition !== null) qty = 1;
  else if (lot > 1) qty = Math.max(lot, Math.round(qty / lot) * lot);
  qty = Math.min(qty, 1_000_000);

  // Bulk discount grows with order size; varied. Per-unit prices, profit-floored.
  const disc = Math.min(0.2, 0.04 + Math.log10(qty + 1) * 0.04) * (0.7 + rand() * 0.6);
  const floor = cost * 1.05; // always clear a margin
  const targetUnit = Math.max(floor, retail * (1 - disc));
  const budgetUnit = Math.max(targetUnit, retail * (1 - disc * 0.35));
  const openUnit = Math.max(cost * 1.02, targetUnit * (0.86 + rand() * 0.08));

  const budget = Math.round(budgetUnit * qty);
  const target = Math.round(targetUnit * qty);
  const companyOffer = Math.max(1, Math.min(target - 1, Math.round(openUnit * qty)));
  const sector = topSector(it.weights);

  return {
    id: newId(now),
    company: pickClient(sector),
    sector,
    itemId: it.id,
    qty,
    companyOffer,
    budget,
    target,
    round: 0,
    maxRounds: MAX_ROUNDS,
    quote: 0,
    status: "offer",
    createdAt: now,
    expiresAt: now + OFFER_TTL,
  };
}

/** Expire stale offers + overdue contracts, then roll a new request if due.
 *  Demand arrives faster when the market is hot. Returns whether anything changed. */
export function rollSandboxOrders(state: WorldState, now: number): boolean {
  if (!state.orders) state.orders = [];
  let changed = false;

  const kept: Order[] = [];
  for (const o of state.orders) {
    if (now < o.expiresAt) {
      kept.push(o);
      continue;
    }
    if (o.status === "accepted")
      state.reputation = Math.max(0, repOf(state) - MISS_PENALTY);
    changed = true;
  }

  const pending = kept.filter((o) => o.status === "offer").length;
  const interval = ROLL_INTERVAL / (1 + marketHeat(state) * 2.5);
  const due = now - (state.lastOrderAt ?? 0) >= interval;
  if (due && pending < MAX_PENDING && kept.length < MAX_ORDERS) {
    const o = generateSandboxOrder(state, now);
    if (o) {
      kept.push(o);
      state.lastOrderAt = now;
      changed = true;
    }
  }
  if (changed) state.orders = kept;
  return changed;
}

export type NegotiateResult =
  | { kind: "deal"; price: number }
  | { kind: "counter"; offer: number; overBudget: boolean }
  | { kind: "pullout" }
  | { kind: "invalid" };

function seal(o: Order, price: number, now: number): NegotiateResult {
  o.status = "accepted";
  o.quote = price;
  o.expiresAt = now + DELIVER_TTL;
  return { kind: "deal", price };
}

/** One round of haggling against the player's `bid` (ask). Mutates the order. */
export function negotiateSandbox(
  state: WorldState,
  orderId: string,
  bid: number,
  now: number,
): NegotiateResult {
  const o = (state.orders ?? []).find((x) => x.id === orderId);
  if (!o || o.status !== "offer") return { kind: "invalid" };
  if (!Number.isFinite(bid) || bid <= 0) return { kind: "invalid" };

  if (bid <= o.target) return seal(o, bid, now);

  const nextRound = o.round + 1;
  if (bid <= o.budget) {
    if (nextRound >= o.maxRounds) return seal(o, bid, now);
    const step = 0.45 + rand() * 0.2;
    o.companyOffer = Math.max(
      o.companyOffer + 1,
      Math.min(o.budget, Math.round(o.companyOffer + (bid - o.companyOffer) * step)),
    );
    o.round = nextRound;
    return { kind: "counter", offer: o.companyOffer, overBudget: false };
  }

  if (nextRound >= o.maxRounds) {
    state.orders = (state.orders ?? []).filter((x) => x.id !== orderId);
    return { kind: "pullout" };
  }
  o.companyOffer = Math.max(
    o.companyOffer + 1,
    Math.round(o.budget * (0.9 + rand() * 0.07)),
  );
  o.round = nextRound;
  return { kind: "counter", offer: o.companyOffer, overBudget: true };
}

/** Accept the client's current standing offer outright. */
export function acceptSandboxOffer(
  state: WorldState,
  orderId: string,
  now: number,
): NegotiateResult {
  const o = (state.orders ?? []).find((x) => x.id === orderId);
  if (!o || o.status !== "offer") return { kind: "invalid" };
  return seal(o, o.companyOffer, now);
}

/** Walk away from an offer. */
export function declineSandboxOrder(state: WorldState, orderId: string): boolean {
  const before = (state.orders ?? []).length;
  state.orders = (state.orders ?? []).filter((x) => x.id !== orderId);
  return state.orders.length !== before;
}

export type FulfilResult =
  | { ok: true; quote: number; qty: number }
  | { ok: false; reason: string };

/** Deliver an accepted contract from the vault: goods leave, cash + rep arrive. */
export function fulfillSandboxOrder(
  state: WorldState,
  orderId: string,
  now: number,
): FulfilResult {
  const o = (state.orders ?? []).find((x) => x.id === orderId);
  if (!o) return { ok: false, reason: "no such order" };
  if (o.status !== "accepted") return { ok: false, reason: "not accepted" };
  if (now > o.expiresAt) return { ok: false, reason: "deadline passed" };
  const orderItem = state.items.find((x) => x.id === o.itemId);
  if (!orderItem) return { ok: false, reason: "no such item" };
  // Fulfil from ANY brand of the product you hold (you make the product).
  const key = productKey(orderItem);
  const matches = state.items.filter((it) => productKey(it) === key);
  const total = matches.reduce((s, it) => s + (it.owners["YOU"] ?? 0), 0);
  if (total < o.qty) return { ok: false, reason: "not enough in your vault" };

  let need = o.qty;
  for (const it of matches) {
    if (need <= 0) break;
    const have = it.owners["YOU"] ?? 0;
    if (have <= 0) continue;
    const take = Math.min(have, need);
    const left = have - take;
    if (left > 0) it.owners["YOU"] = left;
    else delete it.owners["YOU"];
    // Drain the produced count too (orders sell your produced stock).
    if (state.producedQty?.[it.id]) {
      state.producedQty[it.id] = Math.max(0, state.producedQty[it.id]! - take);
      if (state.producedQty[it.id] === 0) delete state.producedQty[it.id];
    }
    need -= take;
  }
  state.cash += o.quote;
  state.reputation = repOf(state) + fulfilReward(o.quote);
  if (state.ledger) {
    state.ledger.orderUnits += o.qty;
    state.ledger.orderRev += o.quote;
  }
  state.orders = (state.orders ?? []).filter((x) => x.id !== o.id);
  return { ok: true, quote: o.quote, qty: o.qty };
}
