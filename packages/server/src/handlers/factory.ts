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
  setStandingSource,
  orderSupply,
  setReorder,
  START_CASH,
  uninstallModule,
  wallProdCycle,
  type WorldState,
} from "@trove/engine";
import {
  allPlayers,
  buildPortfolio,
  commitSettlement,
  docToWorld,
  extractPlayer,
  worldToDoc,
  getPlayer,
  loadWorld,
  playerView,
  PlayerConflictError,
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
  qty?: number;
  floor?: number;
  propId?: number;
  company?: string;
  pct?: number;
  factoryId?: string;
  moduleId?: string;
  lineId?: string;
  inputItemId?: number;
  feederId?: string | null;
  /** Company handle to standing-source an input from, or null/absent to clear. */
  sellerHandle?: string | null;
  bay?: number;
  mult?: number;
  on?: boolean;
  id?: "power" | "router" | "qc";
  patch?: { specialist?: boolean; autoFulfill?: boolean; minMargin?: number };
}

/** Apply one factory action to the player's world view. Returns an error string
 *  on a rejected action, or null on success. `playerId` is only needed for
 *  actions that must resolve ANOTHER player by handle (standing-source). */
async function apply(state: WorldState, b: Body, playerId: string): Promise<string | null> {
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
    case "standing-source": {
      if (!b.sellerHandle) {
        return setStandingSource(state, String(b.lineId), Number(b.inputItemId), null)
          ? null
          : "can't clear source";
      }
      // Same handle-resolution + self-reference guard the manual P2P order
      // flow already uses (see handlers/orders.ts) — a standing source is
      // just a recurring version of the same underlying relationship.
      const players = await allPlayers();
      const seller = players.find((p) => p.site?.handle === b.sellerHandle && p.site?.published);
      if (!seller) return "no such company";
      if (seller.playerId === playerId) return "that's your own company";
      return setStandingSource(state, String(b.lineId), Number(b.inputItemId), {
        sellerId: seller.playerId,
        sellerHandle: b.sellerHandle,
      })
        ? null
        : "can't set source";
    }
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
    case "order-supply":
      return orderSupply(state, Number(b.itemId), Number(b.qty))
        ? null
        : "can't order that much";
    case "reorder":
      setReorder(state, Number(b.itemId), Number(b.floor ?? 0), Number(b.qty ?? 0));
      return null;
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

  // Read → apply → write, retried AS A UNIT. The write is guarded on the
  // player's rev, so a production tick landing mid-request makes this attempt
  // stale rather than letting it overwrite whatever the tick just wrote.
  // Re-reading and re-applying is what keeps BOTH changes instead of losing one.
  for (let attempt = 0; ; attempt++) {
    const player = (await getPlayer(playerId)) ?? freshPlayer(playerId);
    const state = playerView(doc as WorldDoc, player);
    // Factories run on the FAST production clock, not the 6h market cycle: index
    // by wallProdCycle so a built line's onlineCycle lines up with the Production
    // Lambda's produce check (both share this basis).
    state.cycle = wallProdCycle();
    const err = await apply(state, body, playerId);
    if (err) return json(409, { error: err });

    const updated = extractPlayer(state, player);

    // Placing a bulk supply order takes the material OFF the shared floor, so
    // unlike every other action here it mutates the world doc and not just the
    // player. Persisting only the player would let a stockpile be bought out of
    // thin air and, worse, be re-bought by everyone else from stock that was
    // supposed to be gone. Commit both atomically under the world's version, and
    // let a lost race surface rather than silently half-applying.
    if (body.action === "order-supply") {
      const full = docToWorld(doc as WorldDoc);
      const byId = new Map(full.items.map((it) => [it.id, it]));
      for (const it of state.items) {
        const f = byId.get(it.id);
        if (f) f.stock = it.stock; // engine already clamped this to >= 0
        // Delivered/held material lives on the player's own vault projection,
        // which extractPlayer + mutatePlayerWorld below handle as usual.
        const mine = it.owners["YOU"] ?? 0;
        if (f) {
          if (mine > 0) f.owners[playerId] = mine;
          else delete f.owners[playerId];
        }
      }
      try {
        await commitSettlement(worldToDoc(full, doc.version + 1), doc.version, [updated]);
      } catch {
        return json(409, { error: "the floor moved — try that again" });
      }
      return json(200, buildPortfolio(worldToDoc(full, doc.version + 1), updated));
    }

    try {
      await savePlayer(updated);
    } catch (e) {
      if (e instanceof PlayerConflictError && attempt < 4) continue;
      throw e;
    }
    return json(200, buildPortfolio(doc as WorldDoc, updated));
  }
}
