/**
 * Trade Lambda (Stage C) — the authorized write path. Behind a Cognito JWT
 * authorizer, so only signed-in players reach it (the Acquire gate). The trade
 * commits atomically across the world doc and the player's cash; editions can
 * never be double-claimed.
 *
 * POST /trade  body: { "action": "buy" | "sell", "id": <itemId> }
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { mutateTrade, TradeError } from "../repo";
import { serverBuy, serverSell } from "../logic";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const playerId = event.requestContext.authorizer?.jwt?.claims?.sub as
    | string
    | undefined;
  if (!playerId) return json(401, { error: "unauthorized" });

  let body: { action?: string; id?: number; qty?: number };
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : event.body ?? "{}";
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad json" });
  }

  const { action, id } = body;
  const qty = Math.floor(body.qty ?? 1);
  if (
    (action !== "buy" && action !== "sell") ||
    typeof id !== "number" ||
    !Number.isFinite(qty) ||
    qty < 1 ||
    qty > 1_000_000
  ) {
    return json(400, { error: "expected { action: 'buy'|'sell', id, qty? }" });
  }

  try {
    const outcome = await mutateTrade(playerId, (state, player) =>
      action === "buy"
        ? serverBuy(state, player, id, qty)
        : serverSell(state, player, id, qty),
    );
    return json(200, outcome);
  } catch (err) {
    if (err instanceof TradeError) return json(409, { error: err.message });
    console.error("trade failed", err);
    return json(500, { error: "trade failed" });
  }
}
