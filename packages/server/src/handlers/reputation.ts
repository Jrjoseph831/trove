/**
 * Reputation Lambda — GET/POST /reputation (Cognito-authorized).
 *
 * GET  → returns the player's dual-axis rep, heat tier, and skill-tree node
 *        status (locked / eligible / unlocked + effective cost per node).
 *
 * POST { action: "unlock", nodeId: string } → validates conditions (rep gate,
 *        cash, tier order, node not already owned) and commits the unlock:
 *        deducts cash, appends nodeId to unlockedNodes.
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  SKILL_NODES,
  START_CASH,
  heatTierOf,
  nodeById,
  nodeCost,
} from "@trove/engine";
import {
  awardLegitRep,
  awardShadowRep,
  effectiveHeat,
  getPlayer,
  withPlayer,
} from "../repo";
import type { Player } from "../repo";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function repView(player: Player) {
  const heat = effectiveHeat(player);
  const unlocked = player.unlockedNodes ?? [];
  const shadowRep = player.shadowRep ?? 0;
  const legitRep = player.legitRep ?? 0;

  const nodes = SKILL_NODES.map((n) => {
    const isUnlocked = unlocked.includes(n.id);
    const rep = n.branch === "shadow" ? shadowRep : legitRep;
    const repMet = rep >= n.repRequired;
    const prevTier = SKILL_NODES.find(
      (x) => x.branch === n.branch && x.tier === n.tier - 1,
    );
    const prevTierMet = !prevTier || unlocked.includes(prevTier.id);
    const cost = nodeCost(n, unlocked);
    const cashMet = player.cash >= cost;
    const eligible = !isUnlocked && repMet && prevTierMet && cashMet;

    return {
      id: n.id,
      branch: n.branch,
      tier: n.tier,
      name: n.name,
      description: n.description,
      repRequired: n.repRequired,
      cost,
      state: (isUnlocked ? "unlocked" : eligible ? "eligible" : "locked") as
        "locked" | "eligible" | "unlocked",
      blockedBy: (isUnlocked || eligible)
        ? null
        : !repMet
          ? `${n.repRequired - rep} more ${n.branch} rep needed`
          : !prevTierMet
            ? `Unlock Tier ${(n.tier - 1)} first`
            : !cashMet
              ? `Insufficient cash — need $${cost.toLocaleString()}`
              : null,
    };
  });

  return {
    shadowRep,
    legitRep,
    heat,
    heatTier: heatTierOf(heat),
    unlockedNodes: unlocked,
    nodes,
  };
}

class RepError extends Error {
  status: number;
  constructor(msg: string, status = 409) {
    super(msg);
    this.status = status;
  }
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const playerId = event.requestContext.authorizer?.jwt?.claims?.sub as
    | string
    | undefined;
  if (!playerId) return json(401, { error: "unauthorized" });

  const method = event.requestContext.http.method;

  if (method === "GET") {
    const player = (await getPlayer(playerId)) ?? {
      playerId,
      cash: START_CASH,
      debt: 0,
    };
    return json(200, repView(player));
  }

  if (method === "POST") {
    let body: { action?: string; nodeId?: string };
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body ?? "", "base64").toString("utf8")
        : event.body ?? "{}";
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: "bad json" });
    }

    if (body.action !== "unlock" || typeof body.nodeId !== "string") {
      return json(400, { error: "expected { action: 'unlock', nodeId }" });
    }

    const node = nodeById(body.nodeId);
    if (!node) return json(404, { error: "unknown node" });

    try {
      const updated = await withPlayer(playerId, (player) => {
        const unlocked = player.unlockedNodes ?? [];
        if (unlocked.includes(node.id)) {
          throw new RepError("already unlocked");
        }
        const rep = node.branch === "shadow"
          ? (player.shadowRep ?? 0)
          : (player.legitRep ?? 0);
        if (rep < node.repRequired) {
          throw new RepError(`requires ${node.repRequired} ${node.branch} rep`);
        }
        const prevTier = SKILL_NODES.find(
          (x) => x.branch === node.branch && x.tier === node.tier - 1,
        );
        if (prevTier && !unlocked.includes(prevTier.id)) {
          throw new RepError(`unlock ${prevTier.name} (Tier ${prevTier.tier}) first`);
        }
        const cost = nodeCost(node, unlocked);
        if (player.cash < cost) {
          throw new RepError(`insufficient cash — need $${cost.toLocaleString()}`);
        }
        player.cash -= cost;
        player.unlockedNodes = [...unlocked, node.id];
        return player;
      });
      return json(200, repView(updated!));
    } catch (err) {
      if (err instanceof RepError) return json(err.status, { error: err.message });
      console.error("unlock failed", err);
      return json(500, { error: "unlock failed" });
    }
  }

  return json(405, { error: "method not allowed" });
}

export { awardShadowRep, awardLegitRep };
