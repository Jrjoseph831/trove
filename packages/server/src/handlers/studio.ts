/**
 * Company Studio Lambda
 *
 *   POST /studio              (auth)   unlock / branding / customize / remove / add-slots
 *   POST /studio/report       (auth)   report content on another player's storefront
 *   DELETE /admin/studio      (secret) admin remove a customization
 *
 * The economy (pricing, recipes, contracts, sector effects) ALWAYS runs on the
 * canonical catalog item. This handler only manages the presentation layer —
 * name/image/description shown to other players — stored per-player, never
 * touching the canonical catalog record.
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import type { CompanyStudio, ProductCustomization } from "@trove/engine";
import {
  buildPortfolio,
  getPlayer,
  loadWorld,
  retryOnConflict,
  savePlayer,
} from "../repo";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

/** Validate an HTTPS image URL. Returns the URL or throws. */
function validateImageUrl(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new Error(`${field}: must be a string`);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${field}: not a valid URL`);
  }
  if (u.protocol !== "https:") throw new Error(`${field}: must be HTTPS`);
  if (raw.length > 512) throw new Error(`${field}: URL too long`);
  return raw;
}

const subOf = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  e.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;

const parseBody = (event: APIGatewayProxyEventV2WithJWTAuthorizer): unknown => {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : event.body ?? "{}";
  return JSON.parse(raw);
};

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath ?? "";

  // ── DELETE /admin/studio — admin remove a customization ─────────────────
  if (method === "DELETE" && path.includes("/admin/studio")) {
    const secret = event.headers["x-admin-secret"] ?? "";
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET)
      return json(403, { error: "forbidden" });

    let body: { playerId?: string; itemId?: number };
    try {
      body = parseBody(event) as typeof body;
    } catch {
      return json(400, { error: "bad json" });
    }
    const { playerId, itemId } = body;
    if (!playerId || itemId === undefined) return json(400, { error: "playerId + itemId required" });

    return retryOnConflict(async () => {
      const player = await getPlayer(playerId);
      if (!player) return json(404, { error: "player not found" });
      const next = { ...(player.customizations ?? {}) };
      delete next[itemId];
      player.customizations = next;
      await savePlayer(player);
      return json(200, { ok: true });
    });
  }

  // ── POST /studio/report — report abusive content ─────────────────────────
  if (method === "POST" && path.includes("/studio/report")) {
    // For now: log the report. Wire SES email when volume warrants it.
    let body: { reportedPlayerId?: string; itemId?: number; reason?: string };
    try {
      body = parseBody(event) as typeof body;
    } catch {
      return json(400, { error: "bad json" });
    }
    console.log("[studio-report]", JSON.stringify(body));
    return json(200, { ok: true });
  }

  // ── POST /studio — all player actions ───────────────────────────────────
  const playerId = subOf(event);
  if (!playerId) return json(401, { error: "unauthorized" });

  let body: {
    action?: string;
    logoUrl?: string;
    bannerUrl?: string;
    itemId?: number;
    displayName?: string;
    customImageUrl?: string;
    customDescription?: string;
  };
  try {
    body = parseBody(event) as typeof body;
  } catch {
    return json(400, { error: "bad json" });
  }

  const doc = await loadWorld();
  if (!doc) return json(503, { error: "world not seeded" });

  return retryOnConflict(async () => {
    const player = await getPlayer(playerId) ?? { playerId, cash: 0, debt: 0 };

    // ── unlock — $4.99 one-time. Stripe payment verified here in future; for
    //    now the endpoint grants it directly so the UI can be built & tested. ──
    if (body.action === "unlock") {
      if (player.studio?.unlocked) return json(409, { error: "already unlocked" });
      player.studio = {
        unlocked: true,
        unlockedAt: Date.now(),
        productSlots: 20,
        logoUrl: player.studio?.logoUrl,
        bannerUrl: player.studio?.bannerUrl,
      };
      await savePlayer(player);
      return json(200, buildPortfolio(doc, player));
    }

    // ── add-slots — $2.99 per 10 extra product slots ──────────────────────
    if (body.action === "add-slots") {
      if (!player.studio?.unlocked) return json(403, { error: "studio not unlocked" });
      player.studio = { ...player.studio, productSlots: (player.studio.productSlots ?? 5) + 10 };
      await savePlayer(player);
      return json(200, buildPortfolio(doc, player));
    }

    // ── branding — company logo + banner ─────────────────────────────────
    if (body.action === "branding") {
      if (!player.studio?.unlocked) return json(403, { error: "studio not unlocked" });
      let logoUrl: string | undefined;
      let bannerUrl: string | undefined;
      try {
        logoUrl = validateImageUrl(body.logoUrl, "logoUrl");
        bannerUrl = validateImageUrl(body.bannerUrl, "bannerUrl");
      } catch (e) {
        return json(400, { error: (e as Error).message });
      }
      const prev: CompanyStudio = player.studio;
      player.studio = {
        ...prev,
        logoUrl: logoUrl ?? prev.logoUrl,
        bannerUrl: bannerUrl ?? prev.bannerUrl,
      };
      await savePlayer(player);
      return json(200, buildPortfolio(doc, player));
    }

    // ── customize — save presentation override for one product ────────────
    if (body.action === "customize") {
      if (!player.studio?.unlocked) return json(403, { error: "studio not unlocked" });
      const itemId = body.itemId;
      if (itemId === undefined) return json(400, { error: "itemId required" });

      const current = player.customizations ?? {};
      const slotsUsed = Object.keys(current).length;
      const isNew = !current[itemId];
      const slots = player.studio.productSlots ?? 5;
      if (isNew && slotsUsed >= slots)
        return json(403, { error: `slot limit reached (${slots}); buy more slots to continue` });

      const displayName = typeof body.displayName === "string"
        ? body.displayName.trim().slice(0, 60)
        : current[itemId]?.displayName;
      const customDescription = typeof body.customDescription === "string"
        ? body.customDescription.trim().slice(0, 200)
        : current[itemId]?.customDescription;

      let customImageUrl: string | undefined;
      try {
        customImageUrl = validateImageUrl(body.customImageUrl, "customImageUrl")
          ?? current[itemId]?.customImageUrl;
      } catch (e) {
        return json(400, { error: (e as Error).message });
      }

      const entry: ProductCustomization = {
        canonicalItemId: itemId,
        ...(displayName && { displayName }),
        ...(customImageUrl && { customImageUrl }),
        ...(customDescription && { customDescription }),
      };
      player.customizations = { ...current, [itemId]: entry };
      await savePlayer(player);
      return json(200, buildPortfolio(doc, player));
    }

    // ── remove — delete a product customization ───────────────────────────
    if (body.action === "remove") {
      const itemId = body.itemId;
      if (itemId === undefined) return json(400, { error: "itemId required" });
      const next = { ...(player.customizations ?? {}) };
      delete next[itemId];
      player.customizations = next;
      await savePlayer(player);
      return json(200, buildPortfolio(doc, player));
    }

    return json(400, { error: `unknown action: ${body.action}` });
  });
}
