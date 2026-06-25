/**
 * Order Desk — the PVE contract loop. Fictional companies post orders for
 * specific goods at a fixed quote (above market). The player accepts, sources
 * the goods (floor now, factory later) into their Vault, and delivers before a
 * deadline for the payout. Fulfilment raises reputation; missed contracts lower
 * it, and reputation gates how big the orders get.
 */
import { brands, items, lotSize } from "@trove/data";
import type { Order, Player } from "./repo";

const ROLL_INTERVAL = 10 * 60_000; // a new offer ~every 10 min after login
const OFFER_TTL = 12 * 60_000; // a pending offer stands for 12 min
const DELIVER_TTL = 2 * 60 * 60_000; // 2 h to deliver once accepted
const MAX_PENDING = 3; // offers waiting on the desk
const MAX_ORDERS = 6; // total incl. accepted

const BRAND_NAMES = brands.map((b) => b.name);

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

/** Build one fresh pending order using current market values. */
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

  const margin = 0.12 + Math.random() * 0.2 + Math.min(0.1, rep * 0.004);
  const quote = Math.max(1, Math.round(v * qty * (1 + margin)));

  return {
    id: newId(now),
    company: BRAND_NAMES[Math.floor(Math.random() * BRAND_NAMES.length)]!,
    itemId: it.id,
    qty,
    quote,
    status: "pending",
    createdAt: now,
    expiresAt: now + OFFER_TTL,
  };
}

/** Expire stale offers + overdue contracts, then roll a new offer if due.
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
    // expired: a pending offer just vanishes; a missed contract dings rep
    if (o.status === "accepted") {
      player.reputation = Math.max(0, repOf(player) - MISS_PENALTY);
    }
    changed = true;
  }

  const pending = kept.filter((o) => o.status === "pending").length;
  const due = now - (player.lastOrderAt ?? 0) >= ROLL_INTERVAL;
  if (due && pending < MAX_PENDING && kept.length < MAX_ORDERS) {
    kept.push(generateOrder(repOf(player), valueOf, now));
    player.lastOrderAt = now;
    changed = true;
  }

  if (changed) player.orders = kept;
  return changed;
}
