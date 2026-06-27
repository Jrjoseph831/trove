/**
 * Dev tools Lambda (authorized) — STAGING ONLY. Disabled on prod (STAGE=prod and
 * the /dev route isn't even mounted on the prod stack). Lets a signed-in tester
 * fund their account and summon a buyout offer so M&A can be exercised solo.
 *
 *   POST /dev { action: "fund", amount? }   credit your cash (default $50M)
 *   POST /dev { action: "offer-me", price? } a synthetic buyer offers to acquire
 *                                            your firm (accept it to test the exit)
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import type { PvpOrder } from "@trove/engine";
import {
  buildPortfolio,
  getPlayer,
  loadWorld,
  putOrder,
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

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  if (process.env.STAGE === "prod") return json(403, { error: "dev tools disabled" });
  const me = subOf(event);
  if (!me) return json(401, { error: "unauthorized" });

  let body: { action?: string; amount?: number; price?: number };
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : event.body ?? "{}";
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad json" });
  }

  const player = await getPlayer(me);
  if (!player?.name) return json(400, { error: "name your Holding first" });

  switch (body.action) {
    case "fund": {
      const amount = Math.min(
        1_000_000_000_000,
        Math.max(1, Math.round(Number(body.amount) || 50_000_000)),
      );
      player.cash = (player.cash ?? 0) + amount;
      await savePlayer(player);
      const doc = await loadWorld();
      return doc
        ? json(200, buildPortfolio(doc as WorldDoc, player))
        : json(200, { ok: true });
    }
    case "offer-me": {
      const price = Math.max(1, Math.round(Number(body.price) || 1_000_000));
      // A funded synthetic buyer makes the offer (must hold >= price for settle).
      const BUYER = "DEV_BUYER";
      const buyer: Player =
        (await getPlayer(BUYER)) ?? { playerId: BUYER, cash: 0, debt: 0 };
      buyer.name = "Vantage Capital";
      buyer.cash = Math.max(buyer.cash ?? 0, price * 2);
      await savePlayer(buyer);
      const now = Date.now();
      const offer: PvpOrder = {
        id: `o_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        kind: "buyout",
        sellerId: me,
        sellerName: player.name,
        buyerId: BUYER,
        buyerName: "Vantage Capital",
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
    default:
      return json(400, { error: "unknown action" });
  }
}
