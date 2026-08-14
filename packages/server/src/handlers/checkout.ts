/**
 * Stripe Checkout Lambda — creates a hosted Checkout Session for Company Studio.
 *
 *   POST /studio/checkout  (auth)   { action: "unlock" | "add-slots" }
 *                                   → { url: string }  (redirect to Stripe)
 *
 * The client redirects window.location to the returned URL. After payment Stripe
 * redirects back to SITE_URL/?studio=unlocked. The webhook (webhook.ts) is what
 * actually grants the unlock — the redirect is just UX; the client re-fetches
 * the portfolio and sees the updated studio state.
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2026-07-29.dahlia",
});

const PRICES: Record<string, string> = {
  unlock: process.env.STUDIO_UNLOCK_PRICE ?? "",
  "add-slots": process.env.STUDIO_SLOTS_PRICE ?? "",
};

const SITE_URL = (process.env.SITE_URL ?? "https://trove.ceo").replace(/\/$/, "");

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
  const playerId = subOf(event);
  if (!playerId) return json(401, { error: "unauthorized" });

  let body: { action?: string };
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : event.body ?? "{}";
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad json" });
  }

  const action = body.action ?? "unlock";
  const priceId = PRICES[action];
  if (!priceId) return json(400, { error: `unknown action: ${action}` });
  if (!process.env.STRIPE_SECRET_KEY)
    return json(503, { error: "payments not configured" });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${SITE_URL}/?studio=${action === "unlock" ? "unlocked" : "slots-added"}`,
    cancel_url: `${SITE_URL}/`,
    metadata: { playerId, action },
    // Show the player's email pre-filled if we ever add email to player records.
    // customer_email: playerEmail,
  });

  return json(200, { url: session.url });
}
