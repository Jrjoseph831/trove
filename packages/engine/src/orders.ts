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
import { getItem, lotSize, pickClient, sectorKeys } from "@trove/data";
import type { SectorKey } from "@trove/data";
import { rand } from "./rng";
import type { Order, RuntimeItem, WorldState } from "./types";

const OFFER_TTL = 3 * 60_000; // a live negotiation stands for 3 min
const DELIVER_TTL = 6 * 60_000; // 6 min to deliver once a price is agreed
const ROLL_INTERVAL = 22_000; // base: a new request ~every 22s (faster when hot)
const MAX_PENDING = 3;
const MAX_ORDERS = 6;
const MAX_ROUNDS = 3;
const MISS_PENALTY = 3;

export const repOf = (s: WorldState): number => s.reputation ?? 0;

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

/** Build one fresh negotiable order from the current world. */
export function generateSandboxOrder(state: WorldState, now: number): Order | null {
  const rep = repOf(state);
  const it = pickOrderItem(state, rep);
  if (!it) return null;
  const v = Math.max(1, it.value);
  const lot = lotSize(getItem(it.id) ?? it);

  let qty: number;
  if (it.edition !== null) qty = 1;
  else if (lot > 1) qty = lot * (1 + Math.floor(rand() * 4));
  else qty = 1;

  const baseCost = Math.max(1, v * qty);
  const sector = topSector(it.weights);
  const maxMargin = 0.25 + rand() * 0.35 + Math.min(0.15, rep * 0.005);
  const budget = Math.round(baseCost * (1 + maxMargin));
  const target = Math.round(baseCost * (1 + maxMargin * (0.35 + rand() * 0.2)));
  const companyOffer = Math.min(
    target - 1,
    Math.round(baseCost * (1 + 0.02 + rand() * 0.08)),
  );

  return {
    id: newId(now),
    company: pickClient(sector),
    sector,
    itemId: it.id,
    qty,
    companyOffer: Math.max(1, companyOffer),
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
  const it = state.items.find((x) => x.id === o.itemId);
  if (!it) return { ok: false, reason: "no such item" };
  const have = it.owners["YOU"] ?? 0;
  if (have < o.qty) return { ok: false, reason: "not enough in your vault" };

  const left = have - o.qty;
  if (left > 0) it.owners["YOU"] = left;
  else delete it.owners["YOU"];
  state.cash += o.quote;
  state.reputation = repOf(state) + fulfilReward(o.quote);
  state.orders = (state.orders ?? []).filter((x) => x.id !== o.id);
  return { ok: true, quote: o.quote, qty: o.qty };
}
