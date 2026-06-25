/**
 * Portfolio Lambda (Stage C) — the signed-in player's own holdings, cash, net
 * worth, AND their factory / sales / report state. Authorized (Cognito JWT).
 * Holdings are read out of the world doc (item.owners[playerId]); cash/debt and
 * the factory state from the player record. The live client overlays this whole
 * snapshot onto its world so the Factory/Vault/Report screens render the same
 * way they do in the sandbox.
 *
 * GET /portfolio
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { START_CASH, STARTING_SLOTS } from "@trove/engine";
import { buildPortfolio, getPlayer, loadWorld } from "../repo";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

const empty = {
  cash: START_CASH,
  debt: 0,
  netWorth: START_CASH,
  reputation: 0,
  holdings: [],
  floorSlots: STARTING_SLOTS,
  infra: { power: false, router: false, qc: false },
  factories: [],
  listPrices: {},
  producedQty: {},
  listed: {},
  deskAuto: { specialist: false, autoFulfill: false, minMargin: 0.1 },
  reports: [],
  periodNo: 0,
  site: null,
};

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const playerId = event.requestContext.authorizer?.jwt?.claims?.sub as
    | string
    | undefined;
  if (!playerId) return json(401, { error: "unauthorized" });

  const doc = await loadWorld();
  if (!doc) return json(200, empty);

  const player = await getPlayer(playerId);
  if (!player) return json(200, empty);

  return json(200, buildPortfolio(doc, player));
}
