/**
 * Order Desk — the PVE contract loop, now with negotiation.
 *
 * Fictional END-USER companies (a hospital, a shipping line) post requests for
 * goods in their sector. Each opens with a visible lowball `companyOffer` and
 * carries a HIDDEN `budget` (ceiling) and `target` (the price they'd happily
 * pay). The player counters with an ask; the client haggles within its budget,
 * conceding over a few rounds — or walking away if pushed too hard. Once a price
 * is agreed the order flips to "accepted" and the source-and-deliver flow runs.
 *
 * Tuning: "light & forgiving" — 3 rounds, generous budgets, no reputation
 * penalty for a failed negotiation (you simply lose the order).
 */
import { items, lotSize, pickClient } from "@trove/data";
import type { Order, Player } from "./repo";

const ROLL_INTERVAL = 10 * 60_000; // a new request ~every 10 min after login
const OFFER_TTL = 14 * 60_000; // a live negotiation stands for 14 min
const DELIVER_TTL = 2 * 60 * 60_000; // 2 h to deliver once a price is agreed
const MAX_PENDING = 3; // requests open on the desk
const MAX_ORDERS = 6; // total incl. accepted
const MAX_ROUNDS = 3; // haggling patience

/** Current reputation, defaulted. */
export const repOf = (p: Player): number => p.reputation ?? 0;

/** Reputation gate on order size: higher standing unlocks pricier goods. */
function maxItemValue(rep: number): number {
  return 800 + rep * 1500;
}

/** Reputation gained for fulfilling an order of a given quote. */
export function fulfilReward(quote: number): number {
  return Math.max(1, Math.floor(Math.log10(Math.max(10, quote))) - 1);
}

const MISS_PENALTY = 3;

let seq = 0;
function newId(now: number): string {
  seq = (seq + 1) % 100000;
  return `o${now.toString(36)}${seq.toString(36)}`;
}

/** The sector an item leans into hardest (for choosing a believable client). */
function topSector(weights: Record<string, number>): string {
  let best = "";
  let bestW = -1;
  for (const [s, w] of Object.entries(weights)) {
    if (w > bestW) {
      bestW = w;
      best = s;
    }
  }
  return best;
}

/** Build one fresh request to negotiate, using current market values. */
export function generateOrder(
  rep: number,
  valueOf: (id: number) => number,
  now: number,
): Order {
  const cap = maxItemValue(rep);
  const pool = items.filter((it) => valueOf(it.id) <= cap);
  const list = pool.length ? pool : items;
  const it = list[Math.floor(Math.random() * list.length)]!;
  const v = valueOf(it.id);
  const lot = lotSize(it);

  let qty: number;
  if (it.edition !== null) qty = 1;
  else if (lot > 1) qty = lot * (1 + Math.floor(Math.random() * 4)); // 1–4 cases
  else qty = 1;

  const baseCost = Math.max(1, v * qty); // the player's market sourcing floor
  const sector = topSector(it.weights);

  // Hidden budget: the most they'll pay. Generous, and richer with reputation.
  const maxMargin = 0.25 + Math.random() * 0.35 + Math.min(0.15, rep * 0.005);
  const budget = Math.round(baseCost * (1 + maxMargin));
  // Hidden target: at/below this they accept on the spot (a modest premium).
  const target = Math.round(baseCost * (1 + maxMargin * (0.35 + Math.random() * 0.2)));
  // Visible opening offer: a lowball near cost, below target.
  const openMargin = 0.02 + Math.random() * 0.08;
  const companyOffer = Math.min(
    target - 1,
    Math.round(baseCost * (1 + openMargin)),
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

export type NegotiateResult =
  | { kind: "deal"; price: number }
  | { kind: "counter"; offer: number; overBudget: boolean }
  | { kind: "pullout" }
  | { kind: "invalid" };

/**
 * Run one round of haggling on a live offer against the player's `bid` (ask).
 * Mutates the order in place when the negotiation continues (status stays
 * "offer") or succeeds (status → "accepted"). Returns the outcome to relay.
 */
export function negotiate(order: Order, bid: number, now: number): NegotiateResult {
  if (order.status !== "offer") return { kind: "invalid" };
  if (!Number.isFinite(bid) || bid <= 0) return { kind: "invalid" };

  // At/under their happy price → instant deal at your ask (you may under-ask).
  if (bid <= order.target) {
    return seal(order, bid, now);
  }

  const nextRound = order.round + 1;

  if (bid <= order.budget) {
    // Within budget. On the final round they concede to your ask.
    if (nextRound >= order.maxRounds) {
      return seal(order, bid, now);
    }
    // Otherwise they creep up toward your ask, never past budget.
    const step = 0.45 + Math.random() * 0.2;
    const offer = Math.min(
      order.budget,
      Math.round(order.companyOffer + (bid - order.companyOffer) * step),
    );
    order.companyOffer = Math.max(order.companyOffer + 1, offer);
    order.round = nextRound;
    return { kind: "counter", offer: order.companyOffer, overBudget: false };
  }

  // Over budget. Too many rounds of that and they walk.
  if (nextRound >= order.maxRounds) {
    return { kind: "pullout" };
  }
  // They signal their ceiling (a touch under budget so it isn't fully revealed).
  const ceiling = Math.round(order.budget * (0.9 + Math.random() * 0.07));
  order.companyOffer = Math.max(order.companyOffer + 1, ceiling);
  order.round = nextRound;
  return { kind: "counter", offer: order.companyOffer, overBudget: true };
}

/** Lock a price: the offer becomes an accepted contract due in DELIVER_TTL. */
function seal(order: Order, price: number, now: number): NegotiateResult {
  order.status = "accepted";
  order.quote = price;
  order.expiresAt = now + DELIVER_TTL;
  return { kind: "deal", price };
}

/** Accept the client's CURRENT standing offer outright (no counter). */
export function acceptCurrentOffer(order: Order, now: number): NegotiateResult {
  if (order.status !== "offer") return { kind: "invalid" };
  return seal(order, order.companyOffer, now);
}

/** Expire stale offers + overdue contracts, then roll a new request if due.
 *  Mutates the player in place; returns whether anything changed. */
export function rollAndExpire(
  player: Player,
  valueOf: (id: number) => number,
  now: number,
): boolean {
  const orders = player.orders ?? [];
  let changed = false;

  const kept: Order[] = [];
  for (const o of orders) {
    if (now < o.expiresAt) {
      kept.push(o);
      continue;
    }
    // expired: a live negotiation just lapses; a missed contract dings rep
    if (o.status === "accepted") {
      player.reputation = Math.max(0, repOf(player) - MISS_PENALTY);
    }
    changed = true;
  }

  const open = kept.filter((o) => o.status === "offer").length;
  const due = now - (player.lastOrderAt ?? 0) >= ROLL_INTERVAL;
  if (due && open < MAX_PENDING && kept.length < MAX_ORDERS) {
    kept.push(generateOrder(repOf(player), valueOf, now));
    player.lastOrderAt = now;
    changed = true;
  }

  if (changed) player.orders = kept;
  return changed;
}
