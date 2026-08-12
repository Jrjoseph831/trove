/**
 * Player-to-player orders Lambda (authorized) — multiplayer order routing.
 *
 *   POST /orders             a buyer requests goods from a company storefront
 *   GET  /orders             { incoming (you're the seller), outgoing (buyer) }
 *   POST /orders/{id}/action accept | decline | counter | withdraw
 *
 * One counter round: buyer offers → seller accept/decline/counter → buyer
 * accept/withdraw. Accepting settles atomically (goods seller→buyer, cash
 * buyer→seller); see repo.settleDeal.
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { getItem } from "@trove/data";
import type { PvpOrder } from "@trove/engine";
import {
  allPlayers,
  findFirmByHandle,
  deleteOrder,
  getOrder,
  getPlayer,
  loadWorld,
  ordersForBuyer,
  ordersForSeller,
  putOrder,
  settleDeal,
  settleBuyout,
  storefrontOf,
  type WorldDoc,
} from "../repo";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

const subOf = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  e.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;

function parseBody<T>(event: APIGatewayProxyEventV2WithJWTAuthorizer): T | null {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : event.body ?? "{}";
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Counters allowed in total, across both sides. Generous enough for a real
 *  back-and-forth, bounded so an order can't be haggled forever. */
const MAX_COUNTERS = 6;

const newId = () =>
  `o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const me = subOf(event);
  if (!me) return json(401, { error: "unauthorized" });
  const method = event.requestContext.http.method;

  // ── GET /orders — both sides of my order book ───────────────────────────
  if (method === "GET") {
    const [incoming, outgoing] = await Promise.all([
      ordersForSeller(me),
      ordersForBuyer(me),
    ]);
    incoming.sort((a, b) => b.updatedAt - a.updatedAt);
    outgoing.sort((a, b) => b.updatedAt - a.updatedAt);
    return json(200, { incoming, outgoing });
  }

  const id = event.pathParameters?.id;

  // ── POST /orders/{id}/action — act on an order ──────────────────────────
  if (id) {
    const body = parseBody<{ action?: string; price?: number }>(event);
    if (!body?.action) return json(400, { error: "bad request" });
    const order = await getOrder(id);
    if (!order) return json(404, { error: "order is gone" });

    const isSeller = order.sellerId === me;
    const isBuyer = order.buyerId === me;
    if (!isSeller && !isBuyer) return json(403, { error: "not your order" });

    switch (body.action) {
      case "accept": {
        const myTurn =
          (isSeller && order.turn === "seller") ||
          (isBuyer && order.turn === "buyer");
        if (!myTurn) return json(409, { error: "not your move" });
        const r = order.kind === "buyout" ? await settleBuyout(id) : await settleDeal(id);
        return r.ok ? json(200, { ok: true, deal: r }) : json(409, { error: r.reason });
      }
      case "decline": {
        if (!isSeller || order.turn !== "seller")
          return json(409, { error: "can't decline now" });
        await deleteOrder(id);
        return json(200, { ok: true });
      }
      case "withdraw": {
        if (!isBuyer) return json(403, { error: "only the buyer can withdraw" });
        await deleteOrder(id);
        return json(200, { ok: true });
      }
      case "counter": {
        // EITHER side can counter, on their turn. This used to be seller-only
        // and once-only, so the moment a seller countered, the buyer's only
        // moves were accept or withdraw — a negotiation that couldn't be
        // negotiated. Now it goes back and forth like a real haggle, capped
        // only so it can't run forever.
        const myTurn =
          (isSeller && order.turn === "seller") || (isBuyer && order.turn === "buyer");
        if (!myTurn) return json(409, { error: "not your move" });
        const rounds = order.rounds ?? (order.countered ? 1 : 0);
        if (rounds >= MAX_COUNTERS)
          return json(409, { error: "this deal has gone as far as it can — accept or walk" });
        const price = Math.round(Number(body.price));
        if (!Number.isFinite(price) || price <= 0)
          return json(400, { error: "invalid counter price" });
        const next: PvpOrder = {
          ...order,
          price,
          turn: isSeller ? "buyer" : "seller",
          countered: true,
          rounds: rounds + 1,
          updatedAt: Date.now(),
        };
        await putOrder(next);
        return json(200, { ok: true, order: next });
      }
      default:
        return json(400, { error: "unknown action" });
    }
  }

  // ── POST /orders — create a request ─────────────────────────────────────
  const body = parseBody<{
    kind?: "goods" | "buyout";
    sellerHandle?: string;
    itemId?: number;
    qty?: number;
    price?: number;
  }>(event);
  if (!body) return json(400, { error: "bad json" });

  const buyer = await getPlayer(me);
  if (!buyer?.name) return json(400, { error: "name your Holding first" });

  const doc = await loadWorld();
  if (!doc) return json(503, { error: "world not seeded" });

  const players = await allPlayers();
  // Resolves by published handle OR the one derived from the holding's name.
  // Requiring a published website meant a real, named firm could not be sent an
  // offer at all — you can't acquire a company that hasn't built a homepage.
  const seller = findFirmByHandle(players, String(body.sellerHandle ?? ""));
  if (!seller) return json(404, { error: "no such company" });
  if (seller.playerId === me) return json(400, { error: "that's your own company" });

  // ── Buyout (M&A): an offer to acquire the seller's entire firm ───────────
  if (body.kind === "buyout") {
    const price = Math.round(Number(body.price));
    if (!Number.isFinite(price) || price <= 0)
      return json(400, { error: "invalid offer" });
    // Your open offers can never total more than the cash you hold.
    const outstanding = (await ordersForBuyer(me)).reduce((s, o) => s + o.price, 0);
    if (outstanding + price > buyer.cash)
      return json(409, {
        error:
          outstanding > 0
            ? "your open offers would exceed your cash"
            : "you can't cover that offer",
      });
    const now = Date.now();
    const offer: PvpOrder = {
      id: newId(),
      kind: "buyout",
      sellerId: seller.playerId,
      sellerName: seller.name ?? "",
      buyerId: me,
      buyerName: buyer.name,
      itemId: 0,
      itemName: "Full buyout",
      qty: 1,
      price,
      turn: "seller",
      countered: false,
      createdAt: now,
      updatedAt: now,
    };
    await putOrder(offer);
    return json(200, { ok: true, order: offer });
  }

  const itemId = Number(body.itemId);
  const qty = Math.floor(Number(body.qty));
  const price = Math.round(Number(body.price));
  if (!Number.isFinite(itemId) || qty <= 0 || price <= 0)
    return json(400, { error: "invalid order" });

  // The item must actually be on the seller's storefront, with enough stock.
  const store = storefrontOf(doc as WorldDoc, seller);
  const product = store.find((p) => p.id === itemId);
  if (!product) return json(409, { error: "they don't list that" });
  if (qty > product.available)
    return json(409, { error: `they only have ${product.available} available` });

  // Affordability: you can only commit cash you actually hold. Every open
  // request you've sent counts against your cash, so your outstanding offers can
  // never total more than you can pay (a deal pays from cash, not holdings).
  const outstanding = (await ordersForBuyer(me)).reduce((s, o) => s + o.price, 0);
  if (outstanding + price > buyer.cash)
    return json(409, {
      error:
        outstanding > 0
          ? "your open requests would exceed your cash"
          : "you can't cover that offer",
    });

  const now = Date.now();
  const order: PvpOrder = {
    id: newId(),
    sellerId: seller.playerId,
    sellerName: seller.name ?? "",
    buyerId: me,
    buyerName: buyer.name,
    itemId,
    itemName: getItem(itemId)?.name ?? `#${itemId}`,
    qty,
    price,
    turn: "seller",
    countered: false,
    createdAt: now,
    updatedAt: now,
  };
  await putOrder(order);
  return json(200, { ok: true, order });
}
