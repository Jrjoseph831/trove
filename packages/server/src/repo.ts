/**
 * The shared-world repository: the one server-owned Live world, persisted as a
 * single versioned document in the `market` table.
 *
 * The economy (prices, news, sectors, traders) is GLOBAL — it lives here. A
 * player's cash and holdings are per-player and live in the `players` /
 * `ownership` tables (Stage C). The dynamic world is small (~60KB for ~1,456
 * items), well under DynamoDB's 400KB item limit, so one document + an optimistic
 * `version` is the simplest correct store. Editioned scarcity gets its own atomic
 * counters in Stage C; until trading exists, the document is the whole truth.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { items as catalog } from "@trove/data";
import {
  createWorld,
  DEBT_RATE,
  START_CASH,
  wallCycle,
  type RuntimeItem,
  type WorldState,
} from "@trove/engine";

const TABLE = process.env.MARKET_TABLE ?? "trove-market";
const PLAYERS = process.env.PLAYERS_TABLE ?? "trove-players";
/** Singleton key — there is exactly one Live world. */
const PK = "LIVE";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const catById = new Map(catalog.map((it) => [it.id, it]));

/** Per-item dynamic fields we persist (static fields come from @trove/data).
 *  `remaining: null` means an open item (engine Infinity); editions store a count. */
export interface StoredItem {
  id: number;
  value: number;
  prevValue: number;
  stock: number;
  remaining: number | null;
  owners: Record<string, number>;
}

/** The global, server-owned world document. */
export interface WorldDoc {
  version: number;
  cycle: number;
  sectorIdx: Record<string, number>;
  active: WorldState["active"];
  archive: WorldState["archive"];
  front: WorldState["front"];
  recentNewsIdx: number[];
  traders: WorldState["traders"];
  items: StoredItem[];
  log: WorldState["log"];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Compact a full engine WorldState into the stored document. */
export function worldToDoc(state: WorldState, version: number): WorldDoc {
  return {
    version,
    cycle: state.cycle,
    sectorIdx: state.sectorIdx,
    active: state.active,
    archive: state.archive,
    front: state.front,
    recentNewsIdx: state.recentNewsIdx,
    traders: state.traders,
    log: state.log.slice(0, 30),
    items: state.items.map((it) => ({
      id: it.id,
      value: round(it.value),
      prevValue: round(it.prevValue),
      stock: it.stock,
      remaining: it.edition === null ? null : it.remaining,
      owners: it.owners,
    })),
  };
}

/** Rehydrate a full engine WorldState by merging the document over the static
 *  catalog. Player-specific fields (cash/debt/nwHist) are zeroed — the global
 *  world has no single owner; settlement never reads them meaningfully. */
export function docToWorld(doc: WorldDoc): WorldState {
  const items: RuntimeItem[] = doc.items.map((si) => {
    const c = catById.get(si.id)!;
    return {
      ...c,
      stock: si.stock,
      remaining: si.remaining ?? Infinity,
      owners: si.owners ?? {},
      value: si.value,
      prevValue: si.prevValue,
      myCopies: [],
    };
  });
  return {
    cycle: doc.cycle,
    cycleFrac: 0,
    cash: 0,
    debt: 0,
    rate: DEBT_RATE,
    items,
    sectorIdx: doc.sectorIdx,
    active: doc.active,
    archive: doc.archive,
    front: doc.front,
    traders: doc.traders,
    // The global world has no player-owned production lines; factories are a
    // per-player concern handled outside the singleton doc.
    factories: [],
    floorSlots: 0,
    listPrices: {},
    producedQty: {},
    orders: [],
    reputation: 0,
    lastOrderAt: 0,
    log: doc.log ?? [],
    recentNewsIdx: doc.recentNewsIdx ?? [],
    nwHist: [],
  };
}

/** Read the current world document, or null if the world has never been seeded. */
export async function loadWorld(): Promise<WorldDoc | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: PK } }),
  );
  return (res.Item?.world as WorldDoc) ?? null;
}

/** Persist the world with an optimistic version guard (rejects on a concurrent
 *  write so settlement never clobbers a newer state). */
export async function saveWorld(doc: WorldDoc, prevVersion: number): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: PK, version: doc.version, world: doc },
      ConditionExpression:
        "attribute_not_exists(pk) OR version = :prev",
      ExpressionAttributeValues: { ":prev": prevVersion },
    }),
  );
}

/** One Order-Desk contract on a player's record.
 *  An order is negotiated: the client opens with `companyOffer`, the player
 *  counters, and they haggle within the client's HIDDEN budget. Once a price is
 *  agreed the order flips to "accepted" with `quote` set, and the
 *  source-and-deliver-by-deadline flow takes over. */
export interface Order {
  id: string;
  /** End-user client firm (from @trove/data clients), e.g. "Cardinal Carriers". */
  company: string;
  /** The client's sector (for display + flavor). */
  sector: string;
  itemId: number;
  qty: number;
  // ── Negotiation (status "offer") ──────────────────────────────────────────
  /** The client's current visible offer; the player can accept or counter it. */
  companyOffer: number;
  /** HIDDEN — the most the client will ever pay. Never sent to the client. */
  budget: number;
  /** HIDDEN — at/below this the client accepts instantly. Never sent. */
  target: number;
  /** Haggling rounds used so far. */
  round: number;
  /** Patience: rounds allowed before the client walks. */
  maxRounds: number;
  // ── Agreed contract (status "accepted") ─────────────────────────────────────
  /** Agreed payout once accepted (0 while still negotiating). */
  quote: number;
  status: "offer" | "accepted";
  createdAt: number;
  /** Offers vanish after this; accepted contracts are due by it. */
  expiresAt: number;
}

/** A player's account ("Holding"). Item holdings live in the world doc
 *  (item.owners[playerId]); cash/debt/name/reputation/orders are per-player. */
export interface Player {
  playerId: string;
  cash: number;
  debt: number;
  /** The Holding's display name (set at onboarding). */
  name?: string;
  /** Order-Desk standing — rises on fulfilment, dips on missed contracts. */
  reputation?: number;
  orders?: Order[];
  /** Last time a new order was rolled onto the desk (ms). */
  lastOrderAt?: number;
}

export async function getPlayer(playerId: string): Promise<Player | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: PLAYERS, Key: { playerId } }),
  );
  return (res.Item as Player) ?? null;
}

/** Persist a player record (per-player, low contention — last write wins). */
export async function savePlayer(p: Player): Promise<void> {
  await ddb.send(new PutCommand({ TableName: PLAYERS, Item: p }));
}

/** All players (for standings). Small early on; paginates if it ever grows. */
export async function allPlayers(): Promise<Player[]> {
  const out: Player[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({ TableName: PLAYERS, ExclusiveStartKey }),
    );
    out.push(...((res.Items as Player[]) ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

/** Load the world, apply a mutation, and save with an optimistic version guard.
 *  Retries on a concurrent write. Used by settlement + the AI-trader run. */
export async function mutateWorld(
  fn: (state: WorldState) => void,
  retries = 4,
): Promise<WorldDoc> {
  for (let attempt = 0; ; attempt++) {
    const cur = await loadWorld();
    if (!cur) throw new Error("world not seeded");
    const state = docToWorld(cur);
    fn(state);
    const next = worldToDoc(state, cur.version + 1);
    try {
      await saveWorld(next, cur.version);
      return next;
    } catch (err) {
      if (
        (err as { name?: string }).name === "ConditionalCheckFailedException" &&
        attempt < retries
      ) {
        continue; // someone else wrote; reload and retry
      }
      throw err;
    }
  }
}

export class TradeError extends Error {}

/** Apply a trade atomically across the world doc AND the player's cash, with
 *  optimistic concurrency on both. `fn` mutates the (rehydrated) world and the
 *  player in place, or throws TradeError to reject (no retry). New players are
 *  created with START_CASH. */
export async function mutateTrade<T>(
  playerId: string,
  fn: (state: WorldState, player: Player) => T,
  retries = 5,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const cur = await loadWorld();
    if (!cur) throw new Error("world not seeded");
    const existing = await getPlayer(playerId);
    const isNew = !existing;
    const player: Player = existing ?? { playerId, cash: START_CASH, debt: 0 };
    const prevCash = player.cash;
    const prevDebt = player.debt;

    const state = docToWorld(cur);
    const result = fn(state, player); // throws TradeError to reject
    const next = worldToDoc(state, cur.version + 1);

    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLE,
                Item: { pk: PK, version: next.version, world: next },
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": cur.version },
              },
            },
            {
              Put: {
                TableName: PLAYERS,
                Item: player,
                ConditionExpression: isNew
                  ? "attribute_not_exists(playerId)"
                  : "cash = :pc AND debt = :pd",
                ExpressionAttributeValues: isNew
                  ? undefined
                  : { ":pc": prevCash, ":pd": prevDebt },
              },
            },
          ],
        }),
      );
      return result;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (
        (name === "TransactionCanceledException" ||
          name === "ConditionalCheckFailedException") &&
        attempt < retries
      ) {
        continue; // concurrent write; reload and retry
      }
      throw err;
    }
  }
}

/** Create the Live world once (idempotent — fails silently if it already exists).
 *  The world opens warmed and pinned to the current 6h cycle, in lockstep with
 *  the client clock and the newsroom. */
export async function seedWorld(): Promise<WorldDoc> {
  const state = createWorld();
  state.cycle = wallCycle();
  const doc = worldToDoc(state, 1);
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: { pk: PK, version: 1, world: doc },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  } catch (err) {
    // ConditionalCheckFailed = already seeded; anything else re-throws.
    if ((err as { name?: string }).name !== "ConditionalCheckFailedException") {
      throw err;
    }
  }
  return doc;
}
