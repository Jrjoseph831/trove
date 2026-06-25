/**
 * Order Desk Lambda (authorized). Runs the SAME engine order logic the sandbox
 * uses (product matching, smarter negotiation), via a per-player WorldState view
 * of the shared world. GET rolls/expires offers; POST acts: name, accept,
 * counter, decline, fulfil.
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { getItem, validateHoldingName } from "@trove/data";
import {
  acceptSandboxOffer,
  autoNegotiate,
  declineSandboxOrder,
  fulfillSandboxOrder,
  heldOfProduct,
  LIVE_TIMING,
  negotiateSandbox,
  producesProduct,
  rollSandboxOrders,
  START_CASH,
  type WorldState,
} from "@trove/engine";
import {
  extractPlayer,
  getPlayer,
  loadWorld,
  mutatePlayerWorld,
  playerView,
  savePlayer,
  type Player,
  type WorldDoc,
} from "../repo";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

const subOf = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  e.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;

const freshPlayer = (playerId: string): Player => ({
  playerId,
  cash: START_CASH,
  debt: 0,
});

/** Build the client-facing desk view from a per-player WorldState. Budget/target
 *  stay hidden; held + youProduce are by PRODUCT (any brand of it). */
function deskView(state: WorldState, name: string | null) {
  return {
    name,
    reputation: state.reputation ?? 0,
    cash: state.cash,
    orders: (state.orders ?? []).map((o) => {
      const it = state.items.find((i) => i.id === o.itemId);
      return {
        id: o.id,
        company: o.company,
        sector: o.sector,
        itemId: o.itemId,
        itemName: it?.name ?? getItem(o.itemId)?.name ?? `#${o.itemId}`,
        brand: it?.brand ?? "",
        qty: o.qty,
        companyOffer: o.companyOffer,
        round: o.round,
        maxRounds: o.maxRounds,
        quote: o.quote,
        status: o.status,
        expiresAt: o.expiresAt,
        marketValue: Math.round((it?.value ?? 0) * o.qty),
        held: it ? heldOfProduct(state, it) : 0,
        youProduce: it ? producesProduct(state, it) : false,
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
  if (!doc) return json(503, { error: "world not seeded" });
  const now = Date.now();
  const method = event.requestContext.http.method;

  if (method === "GET") {
    const player = (await getPlayer(playerId)) ?? freshPlayer(playerId);
    const state = playerView(doc as WorldDoc, player);
    const rolled = rollSandboxOrders(state, now, LIVE_TIMING);
    const auto = autoNegotiate(state, now, LIVE_TIMING); // no-op unless specialist is on
    if (rolled || auto) await savePlayer(extractPlayer(state, player));
    return json(200, deskView(state, player.name ?? null));
  }

  let body: { action?: string; orderId?: string; name?: string; bid?: number };
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
    const player = (await getPlayer(playerId)) ?? freshPlayer(playerId);
    player.name = name;
    await savePlayer(player);
    const state = playerView(doc as WorldDoc, player);
    return json(200, deskView(state, name));
  }

  if (action === "decline") {
    const player = (await getPlayer(playerId)) ?? freshPlayer(playerId);
    const state = playerView(doc as WorldDoc, player);
    if (!declineSandboxOrder(state, orderId ?? ""))
      return json(404, { error: "no such order" });
    await savePlayer(extractPlayer(state, player));
    return json(200, deskView(state, player.name ?? null));
  }

  if (action === "accept") {
    const player = (await getPlayer(playerId)) ?? freshPlayer(playerId);
    const state = playerView(doc as WorldDoc, player);
    const res = acceptSandboxOffer(state, orderId ?? "", now, LIVE_TIMING);
    if (res.kind !== "deal") return json(409, { error: "offer is closed" });
    await savePlayer(extractPlayer(state, player));
    return json(200, { ...deskView(state, player.name ?? null), note: res });
  }

  if (action === "counter") {
    const bid = Math.round(Number(body.bid));
    const player = (await getPlayer(playerId)) ?? freshPlayer(playerId);
    const state = playerView(doc as WorldDoc, player);
    const o = (state.orders ?? []).find((x) => x.id === orderId);
    if (!o) return json(404, { error: "no such order" });
    const company = o.company;
    const res = negotiateSandbox(state, orderId ?? "", bid, now, LIVE_TIMING);
    if (res.kind === "invalid") return json(400, { error: "invalid bid" });
    await savePlayer(extractPlayer(state, player));
    return json(200, {
      ...deskView(state, player.name ?? null),
      note: { ...res, company },
    });
  }

  if (action === "fulfill") {
    try {
      const { result, state } = await mutatePlayerWorld(playerId, (st) =>
        fulfillSandboxOrder(st, orderId ?? "", Date.now()),
      );
      if (!result.ok) return json(409, { error: result.reason });
      const player = (await getPlayer(playerId)) ?? freshPlayer(playerId);
      return json(200, {
        ...deskView(state, player.name ?? null),
        fulfilled: { quote: result.quote, qty: result.qty },
      });
    } catch (err) {
      console.error("fulfill failed", err);
      return json(500, { error: "fulfill failed" });
    }
  }

  return json(400, { error: "unknown action" });
}
