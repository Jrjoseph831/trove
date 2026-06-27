/**
 * Factory Lambda (authorized) — the player's production floor on the shared
 * world. Every action here is a pure player-record mutation (cash, lines,
 * infra, listings, desk automation); none touch shared holdings — produced
 * stock is created only by the Settlement Lambda's per-cycle production. So we
 * run the engine on a per-player WorldState projection and persist just the
 * player record (no world-doc write, no contention). The response is the same
 * portfolio snapshot GET /portfolio returns, for one client overlay path.
 *
 * POST /factory  { action, ... }
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  buildFactory,
  buyProperty,
  sellProperty,
  buyStake,
  sellStake,
  buyInfra,
  demolishFactory,
  expandFloor,
  installModule,
  routeFactory,
  setDeskAuto,
  setListed,
  setListPrice,
  setSource,
  START_CASH,
  uninstallModule,
  wallProdCycle,
  type WorldState,
} from "@trove/engine";
import {
  buildPortfolio,
  extractPlayer,
  getPlayer,
  loadWorld,
  playerView,
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

const freshPlayer = (playerId: string): Player => ({
  playerId,
  cash: START_CASH,
  debt: 0,
});

interface Body {
  action?: string;
  itemId?: number;
  propId?: number;
  company?: string;
  pct?: number;
  factoryId?: string;
  moduleId?: string;
  lineId?: string;
  inputItemId?: number;
  feederId?: string | null;
  bay?: number;
  mult?: number;
  on?: boolean;
  id?: "power" | "router" | "qc";
  patch?: { specialist?: boolean; autoFulfill?: boolean; minMargin?: number };
}

/** Apply one factory action to the player's world view. Returns an error string
 *  on a rejected action, or null on success. */
function apply(state: WorldState, b: Body): string | null {
  switch (b.action) {
    case "build":
      return buildFactory(state, Number(b.itemId)) ? null : "can't build that line";
    case "buy-property":
      return buyProperty(state, Number(b.propId)) ? null : "can't buy that property";
    case "sell-property":
      return sellProperty(state, Number(b.propId)) ? null : "no such property";
    case "buy-stake":
      return buyStake(state, String(b.company), Number(b.pct)) ? null : "can't buy that stake";
    case "sell-stake":
      return sellStake(state, String(b.company), Number(b.pct)) ? null : "no such stake";
    case "demolish":
      return demolishFactory(state, String(b.factoryId ?? b.id ?? "")) ? null : "no such line";
    case "module-add":
      return installModule(state, String(b.factoryId), String(b.moduleId))
        ? null
        : "can't install module";
    case "module-remove":
      uninstallModule(state, String(b.factoryId), String(b.moduleId));
      return null;
    case "expand":
      return expandFloor(state) ? null : "can't expand the floor";
    case "route":
      return routeFactory(state, String(b.lineId ?? b.factoryId), Number(b.bay))
        ? null
        : "can't route line";
    case "source":
      return setSource(
        state,
        String(b.lineId),
        Number(b.inputItemId),
        b.feederId ? String(b.feederId) : null,
      )
        ? null
        : "can't set source";
    case "listprice":
      setListPrice(state, Number(b.itemId), Number(b.mult));
      return null;
    case "listed":
      setListed(state, Number(b.itemId), Boolean(b.on));
      return null;
    case "infra":
      return buyInfra(state, b.id as "power" | "router" | "qc")
        ? null
        : "already installed or not enough cash";
    case "deskauto":
      setDeskAuto(state, b.patch ?? {});
      return null;
    default:
      return "unknown action";
  }
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const playerId = subOf(event);
  if (!playerId) return json(401, { error: "unauthorized" });

  const doc = await loadWorld();
  if (!doc) return json(503, { error: "world not seeded" });

  let body: Body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : event.body ?? "{}";
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad json" });
  }

  const player = (await getPlayer(playerId)) ?? freshPlayer(playerId);
  const state = playerView(doc as WorldDoc, player);
  // Factories run on the FAST production clock, not the 6h market cycle: index by
  // wallProdCycle so a built line's onlineCycle lines up with the Production
  // Lambda's produce check (both share this basis).
  state.cycle = wallProdCycle();
  const err = apply(state, body);
  if (err) return json(409, { error: err });

  const updated = extractPlayer(state, player);
  await savePlayer(updated);
  return json(200, buildPortfolio(doc as WorldDoc, updated));
}
