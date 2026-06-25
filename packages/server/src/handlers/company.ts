/**
 * Company website Lambda — the manufacturing storefront.
 *
 *   GET  /companies            (public)  directory of published company sites
 *   GET  /companies/{handle}   (public)  one company's full public site
 *   POST /site                 (auth)    save the signed-in player's site config
 *
 * The storefront is built from a player's LISTED produced goods (list it in the
 * Vault → it shows here; unlist → hidden). Identity + storefront only; private
 * vault holdings and net worth never appear. Net-worth RANK is shown as a light
 * credential, computed from the same pass the standings use.
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import type { SiteConfig } from "@trove/engine";
import {
  allPlayers,
  companyCard,
  companySite,
  getPlayer,
  loadWorld,
  savePlayer,
  type Player,
  type WorldDoc,
} from "../repo";

const json = (status: number, body: unknown, maxAge = 0): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: {
    "content-type": "application/json",
    "cache-control": maxAge > 0 ? `public, max-age=${maxAge}` : "no-store",
  },
  body: JSON.stringify(body),
});

const ACCENTS = new Set(["gold", "steel", "ink"]);
const SECTION_IDS = new Set(["masthead", "about", "storefront", "standing", "contact"]);

/** Normalize a string to a URL handle: lowercase alphanumerics + single hyphens. */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

/** Net-worth rank (1-based) for every player id, from the world doc + records. */
function rankMap(doc: WorldDoc, players: Player[]): Map<string, number> {
  const assets: Record<string, number> = {};
  for (const it of doc.items) {
    for (const [owner, qty] of Object.entries(it.owners ?? {})) {
      assets[owner] = (assets[owner] ?? 0) + qty * it.value;
    }
  }
  const rows: { id: string; net: number }[] = [];
  for (const t of doc.traders) rows.push({ id: t.name, net: t.cash + (assets[t.name] ?? 0) });
  for (const p of players)
    rows.push({ id: p.playerId, net: p.cash - p.debt + (assets[p.playerId] ?? 0) });
  rows.sort((a, b) => b.net - a.net);
  const m = new Map<string, number>();
  rows.forEach((r, i) => m.set(r.id, i + 1));
  return m;
}

const subOf = (e: APIGatewayProxyEventV2WithJWTAuthorizer) =>
  e.requestContext.authorizer?.jwt?.claims?.sub as string | undefined;

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const doc = await loadWorld();
  if (!doc) return json(503, { error: "world not seeded" });

  // ── POST /site — save the owner's site config ───────────────────────────
  if (method === "POST") {
    const playerId = subOf(event);
    if (!playerId) return json(401, { error: "unauthorized" });

    let body: Partial<SiteConfig>;
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body ?? "", "base64").toString("utf8")
        : event.body ?? "{}";
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: "bad json" });
    }

    const player = (await getPlayer(playerId)) ?? { playerId, cash: 0, debt: 0 };
    if (!player.name) return json(400, { error: "name your Holding first" });

    const players = await allPlayers();
    const prev = player.site;
    const handle = body.handle ? slugify(body.handle) : prev?.handle || slugify(player.name);
    if (handle.length < 2) return json(400, { error: "handle too short" });
    // Handle must be unique across other players.
    if (players.some((p) => p.playerId !== playerId && p.site?.handle === handle))
      return json(409, { error: "that address is taken" });

    const sections = Array.isArray(body.sections)
      ? body.sections
          .filter((s) => SECTION_IDS.has(s?.id))
          .map((s) => ({ id: s.id, on: s.id === "masthead" ? true : !!s.on }))
      : prev?.sections;

    const site: SiteConfig = {
      handle,
      tagline: (body.tagline ?? prev?.tagline ?? "").slice(0, 120),
      about: (body.about ?? prev?.about ?? "").slice(0, 1200),
      accent: ACCENTS.has(body.accent ?? "") ? body.accent : prev?.accent ?? "gold",
      sections,
      published: body.published ?? prev?.published ?? false,
    };
    player.site = site;
    await savePlayer(player);

    const rank = rankMap(doc as WorldDoc, players).get(playerId) ?? null;
    return json(200, { site, view: companySite(doc as WorldDoc, player, rank) });
  }

  // ── GET /companies/{handle} — one company's public site ─────────────────
  const handle = event.pathParameters?.handle;
  if (handle) {
    const players = await allPlayers();
    const player = players.find((p) => p.site?.handle === handle && p.site?.published);
    if (!player) return json(404, { error: "no such company" });
    const rank = rankMap(doc as WorldDoc, players).get(player.playerId) ?? null;
    return json(200, companySite(doc as WorldDoc, player, rank), 15);
  }

  // ── GET /companies — the directory ──────────────────────────────────────
  const players = await allPlayers();
  const companies = players
    .map((p) => companyCard(doc as WorldDoc, p))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .sort((a, b) => b.products - a.products);
  return json(200, { companies }, 15);
}
