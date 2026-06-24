/**
 * Portfolio Lambda (Stage C) — the signed-in player's own holdings, cash, and
 * net worth. Authorized (Cognito JWT). Holdings are read out of the world doc
 * (item.owners[playerId]); cash/debt from the player record.
 *
 * GET /portfolio
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { START_CASH } from "@trove/engine";
import { getPlayer, loadWorld } from "../repo";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const playerId = event.requestContext.authorizer?.jwt?.claims?.sub as
    | string
    | undefined;
  if (!playerId) return json(401, { error: "unauthorized" });

  const doc = await loadWorld();
  if (!doc) return json(200, { cash: START_CASH, debt: 0, netWorth: START_CASH, holdings: [] });

  const player = await getPlayer(playerId);
  const cash = player?.cash ?? START_CASH;
  const debt = player?.debt ?? 0;

  const holdings: { id: number; qty: number; value: number }[] = [];
  let assets = 0;
  for (const it of doc.items) {
    const qty = it.owners?.[playerId] ?? 0;
    if (qty > 0) {
      holdings.push({ id: it.id, qty, value: it.value });
      assets += qty * it.value;
    }
  }

  return json(200, {
    cash,
    debt,
    netWorth: cash - debt + assets,
    holdings,
  });
}
