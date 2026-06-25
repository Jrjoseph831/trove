/**
 * Order Desk Lambda (authorized). GET reads the desk (rolling a new offer when
 * due, expiring stale ones), POST acts on it: name the Holding, accept/decline
 * an offer, or fulfil a contract from the Vault.
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { getItem, validateHoldingName } from "@trove/data";
import { START_CASH } from "@trove/engine";
import {
  getPlayer,
  loadWorld,
  mutateTrade,
  savePlayer,
  TradeError,
  type Player,
} from "../repo";
import { fulfilReward, repOf, rollAndExpire } from "../orders";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

const subOf = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  e.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;

const fresh = (playerId: string): Player => ({
  playerId,
  cash: START_CASH,
  debt: 0,
});

function deskView(player: Player, valueOf: (id: number) => number, ownedOf: (id: number) => number) {
  return {
    name: player.name ?? null,
    reputation: repOf(player),
    cash: player.cash,
    orders: (player.orders ?? []).map((o) => {
      const it = getItem(o.itemId);
      return {
        id: o.id,
        company: o.company,
        itemId: o.itemId,
        itemName: it?.name ?? `#${o.itemId}`,
        brand: it?.brand ?? "",
        qty: o.qty,
        quote: o.quote,
        status: o.status,
        expiresAt: o.expiresAt,
        marketValue: Math.round(valueOf(o.itemId) * o.qty),
        held: ownedOf(o.itemId),
      };
    }),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const playerId = subOf(event);
  if (!playerId) return json(401, { error: "unauthorized" });

  const doc = await loadWorld();
  const valueOf = (id: number) =>
    doc?.items.find((i) => i.id === id)?.value ?? getItem(id)?.base ?? 0;
  const ownedOf = (id: number) =>
    doc?.items.find((i) => i.id === id)?.owners?.[playerId] ?? 0;

  const method = event.requestContext.http.method;
  const now = Date.now();

  if (method === "GET") {
    const player = (await getPlayer(playerId)) ?? fresh(playerId);
    if (rollAndExpire(player, valueOf, now)) await savePlayer(player);
    return json(200, deskView(player, valueOf, ownedOf));
  }

  // POST actions
  let body: { action?: string; orderId?: string; name?: string };
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : event.body ?? "{}";
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad json" });
  }
  const { action, orderId } = body;

  if (action === "name") {
    const name = String(body.name ?? "").trim().slice(0, 40);
    const check = validateHoldingName(name);
    if (!check.ok) return json(400, { error: check.reason ?? "Invalid name." });
    const player = (await getPlayer(playerId)) ?? fresh(playerId);
    player.name = name;
    await savePlayer(player);
    return json(200, deskView(player, valueOf, ownedOf));
  }

  if (action === "accept" || action === "decline") {
    const player = (await getPlayer(playerId)) ?? fresh(playerId);
    const orders = player.orders ?? [];
    const o = orders.find((x) => x.id === orderId);
    if (!o) return json(404, { error: "no such order" });
    if (action === "decline") {
      player.orders = orders.filter((x) => x.id !== orderId);
    } else {
      if (o.status !== "pending") return json(409, { error: "already taken" });
      o.status = "accepted";
      o.expiresAt = now + 2 * 60 * 60_000; // 2h to deliver
    }
    await savePlayer(player);
    return json(200, deskView(player, valueOf, ownedOf));
  }

  if (action === "fulfill") {
    try {
      const result = await mutateTrade(playerId, (state, player) => {
        const o = (player.orders ?? []).find((x) => x.id === orderId);
        if (!o) throw new TradeError("no such order");
        if (o.status !== "accepted") throw new TradeError("not accepted");
        if (Date.now() > o.expiresAt) throw new TradeError("deadline passed");
        const it = state.items.find((i) => i.id === o.itemId);
        if (!it) throw new TradeError("no such item");
        const have = it.owners[playerId] ?? 0;
        if (have < o.qty) throw new TradeError("not enough in your vault");
        // deliver: goods leave the vault, payout lands, reputation rises
        const left = have - o.qty;
        if (left > 0) it.owners[playerId] = left;
        else delete it.owners[playerId];
        player.cash += o.quote;
        player.reputation = repOf(player) + fulfilReward(o.quote);
        player.orders = (player.orders ?? []).filter((x) => x.id !== o.id);
        return { quote: o.quote, qty: o.qty };
      });
      // re-read for an up-to-date view
      const player = (await getPlayer(playerId)) ?? fresh(playerId);
      return json(200, { ...deskView(player, valueOf, ownedOf), fulfilled: result });
    } catch (err) {
      if (err instanceof TradeError) return json(409, { error: err.message });
      console.error("fulfill failed", err);
      return json(500, { error: "fulfill failed" });
    }
  }

  return json(400, { error: "unknown action" });
}
