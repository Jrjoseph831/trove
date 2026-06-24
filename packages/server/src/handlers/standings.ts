/**
 * Standings Lambda (Stage C) — the public leaderboard. Net worth for every
 * human player and AI house, computed from the world doc (holdings) + cash.
 * Players appear under a short non-identifying handle; the client highlights its
 * own row by matching the first 8 chars of its token's sub.
 *
 * GET /standings
 */
import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { allPlayers, loadWorld } from "../repo";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "public, max-age=15" },
  body: JSON.stringify(body),
});

const TOP = 25;

export async function handler(): Promise<APIGatewayProxyResultV2> {
  const doc = await loadWorld();
  if (!doc) return json(200, { standings: [] });

  // sum each owner's asset value from the world doc in one pass
  const assets: Record<string, number> = {};
  for (const it of doc.items) {
    for (const [owner, qty] of Object.entries(it.owners ?? {})) {
      assets[owner] = (assets[owner] ?? 0) + qty * it.value;
    }
  }

  const rows: { handle: string; id: string; net: number; isAI: boolean }[] = [];

  // AI houses (cash on the trader record)
  for (const t of doc.traders) {
    rows.push({
      handle: t.name,
      id: t.name,
      net: t.cash + (assets[t.name] ?? 0),
      isAI: true,
    });
  }

  // human players (cash on the player record)
  const players = await allPlayers();
  for (const p of players) {
    rows.push({
      handle: `Player-${p.playerId.slice(0, 4)}`,
      id: p.playerId.slice(0, 8),
      net: p.cash - p.debt + (assets[p.playerId] ?? 0),
      isAI: false,
    });
  }

  rows.sort((a, b) => b.net - a.net);
  return json(200, { standings: rows.slice(0, TOP) });
}
