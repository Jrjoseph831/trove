/**
 * Stripe webhook Lambda — the authoritative grant point for Studio purchases.
 *
 *   POST /stripe/webhook  (public, Stripe-signed)
 *
 * Stripe calls this after every payment event. We verify the signature, then
 * on checkout.session.completed we grant the Studio unlock or add slots to the
 * player's record. This is the ONLY place the unlock is written — the client
 * redirect from Checkout is just UX; it re-fetches the portfolio to confirm.
 *
 * Idempotent: granting an already-unlocked studio or adding slots twice is safe
 * (unlock is a no-op if already set; slots always increment, which is correct
 * because Stripe only fires the event once per paid session).
 */
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import Stripe from "stripe";
import {
  getPlayer,
  retryOnConflict,
  savePlayer,
} from "../repo";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2026-07-29.dahlia",
});

const ok = (): APIGatewayProxyResultV2 => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ received: true }),
});

const fail = (msg: string): APIGatewayProxyResultV2 => ({
  statusCode: 400,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ error: msg }),
});

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!secret) return fail("webhook secret not configured");

  const sig = event.headers["stripe-signature"] ?? "";
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64")
    : event.body ?? "";

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err);
    return fail("invalid signature");
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object as Stripe.Checkout.Session;
    const { playerId, action } = session.metadata ?? {};

    if (!playerId) {
      console.error("[stripe-webhook] no playerId in session metadata", session.id);
      return ok(); // ack so Stripe doesn't retry; nothing we can do without an id
    }

    if (action === "unlock") {
      await retryOnConflict(async () => {
        const player = await getPlayer(playerId);
        if (!player) return; // player deleted between checkout and payment — rare
        if (player.studio?.unlocked) return; // already unlocked (duplicate event)
        player.studio = {
          unlocked: true,
          unlockedAt: Date.now(),
          productSlots: 20,
          logoUrl: player.studio?.logoUrl,
          bannerUrl: player.studio?.bannerUrl,
        };
        await savePlayer(player);
        console.log(`[stripe-webhook] Studio unlocked for ${playerId}`);
      });
    }

    if (action === "add-slots") {
      await retryOnConflict(async () => {
        const player = await getPlayer(playerId);
        if (!player?.studio?.unlocked) return;
        player.studio = {
          ...player.studio,
          productSlots: (player.studio.productSlots ?? 5) + 10,
        };
        await savePlayer(player);
        console.log(`[stripe-webhook] +10 slots for ${playerId}`);
      });
    }
  }

  return ok();
}
