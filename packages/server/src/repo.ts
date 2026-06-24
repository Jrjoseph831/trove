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
} from "@aws-sdk/lib-dynamodb";
import { items as catalog } from "@trove/data";
import {
  createWorld,
  DEBT_RATE,
  wallCycle,
  type RuntimeItem,
  type WorldState,
} from "@trove/engine";

const TABLE = process.env.MARKET_TABLE ?? "trove-market";
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
