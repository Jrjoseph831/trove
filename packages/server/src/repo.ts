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
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { items as catalog } from "@trove/data";
import {
  createWorld,
  DEBT_RATE,
  emptyLedger,
  listedUnitPrice,
  makerVariantName,
  START_CASH,
  STARTING_SLOTS,
  wallCycle,
  type DeskAuto,
  type Factory,
  type Infra,
  type Ledger,
  type OwnedProperty,
  type PvpOrder,
  type Report,
  type ReorderRule,
  type SupplyOrder,
  type RuntimeItem,
  type SiteConfig,
  type WorldState,
} from "@trove/engine";

const TABLE = process.env.MARKET_TABLE ?? "trove-market";
const PLAYERS = process.env.PLAYERS_TABLE ?? "trove-players";
const ORDERS = process.env.ORDERS_TABLE ?? "trove-orders";
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
  /** Rolling EMA of real players' item-holdings footprint (see aiEconomy.ts).
   *  Optional — absent on docs written before this field existed. */
  playerActivityEma?: number;
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
    playerActivityEma: state.playerActivityEma,
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
  // Build from the FULL catalog, overlaying the doc's stored dynamics by id. This
  // way items ADDED to @trove/data after the world was seeded appear immediately
  // (with fresh defaults), instead of being missing from the live world — which
  // made e.g. "build a Silicon Wafer line" fail with "can't build that line"
  // because the item wasn't in doc.items. Items already in the doc keep their
  // evolved stock/value/owners; the next settlement persists the newcomers via
  // worldToDoc.
  const stored = new Map(doc.items.map((si) => [si.id, si]));
  const items: RuntimeItem[] = catalog.map((c) => {
    const si = stored.get(c.id);
    if (si) {
      return {
        ...c,
        stock: si.stock,
        remaining: si.remaining ?? Infinity,
        owners: si.owners ?? {},
        value: si.value,
        prevValue: si.prevValue,
        myCopies: [],
      };
    }
    // New catalog item not yet in the world doc — initialize like freshState().
    return {
      ...c,
      stock: c.edition === null ? c.stockNormal : c.edition,
      remaining: c.edition === null ? Infinity : c.edition,
      owners: {},
      value: c.base,
      prevValue: c.base,
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
    // The global world has no player-owned production lines or real estate;
    // both are per-player concerns handled outside the singleton doc.
    factories: [],
    supplyOrders: [],
    reorders: [],
    properties: [],
    stakes: {},
    floorSlots: 0,
    infra: { power: false, router: false, qc: false },
    listPrices: {},
    producedQty: {},
    listed: {},
    orders: [],
    reputation: 0,
    deskAuto: { specialist: false, autoFulfill: false, minMargin: 0.1 },
    lastOrderAt: 0,
    ledger: emptyLedger(),
    reports: [],
    periodNo: 0,
    // Copied, not referenced — every call site that derives a WorldState
    // from the same doc (a per-player playerView alongside the full shared
    // view in production.ts's batch loop, for instance) must get its OWN
    // log array. Sharing the reference meant one player's engine-internal
    // "YOU produced X" entry (meant only for their own view) mutated the
    // SAME array every other view held, leaking "YOU" into the public
    // world doc's log the moment that batch was persisted.
    log: [...(doc.log ?? [])],
    recentNewsIdx: doc.recentNewsIdx ?? [],
    nwHist: [],
    playerActivityEma: doc.playerActivityEma ?? 0,
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

/** Commit a settled world doc together with the player records whose factories
 *  produced this run, in ONE transaction guarded by the world's version. If
 *  anything raced (a trade bumped the world while we settled), the whole commit
 *  fails and the caller retries from a fresh read — so produced holdings (in the
 *  doc) and the factory/cash/report state (on the players) stay consistent.
 *  DynamoDB caps a transaction at 100 items; we reserve 1 for the world. */
export async function commitSettlement(
  doc: WorldDoc,
  prevVersion: number,
  players: Player[],
): Promise<void> {
  const batch = players.slice(0, 99);
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: { pk: PK, version: doc.version, world: doc },
            ConditionExpression: "attribute_not_exists(pk) OR version = :prev",
            ExpressionAttributeValues: { ":prev": prevVersion },
          },
        },
        // Each player is guarded on its OWN rev, not just the world version.
        // Guarding the world alone let a tick built from a snapshot taken at
        // its start overwrite anything a player did while it ran — a purchase
        // or a supply order placed mid-tick would silently revert. A stale
        // player now cancels the whole transaction, which the caller retries
        // against fresh reads.
        ...batch.map((p, i) => {
          const { Item, ConditionExpression, ExpressionAttributeValues } = guardedPut(p, `p${i}`);
          return {
            Put: {
              TableName: PLAYERS,
              Item,
              ConditionExpression,
              ...(ExpressionAttributeValues ? { ExpressionAttributeValues } : {}),
            },
          };
        }),
      ],
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
  /**
   * This player's goods: item id → quantity.
   *
   * Holdings used to live only in the world doc, inside each item's `owners`
   * map — which meant the single 400KB record that IS the shared world grew
   * with every player who bought anything. A thousand players holding twenty
   * items each is ~508KB of ownership alone: past the hard limit, at which
   * point nothing can be saved at all and the world stops.
   *
   * A player's own goods belong on their own record, which has its own 400KB.
   * The doc keeps AI-house holdings only — those are bounded by the roster and
   * are needed globally every settlement, so they have to stay resident.
   *
   * Absent on records written before the split; holdingsOf() falls back to the
   * doc for those, and the next write migrates them.
   */
  holdings?: Record<number, number>;
  /** Optimistic-concurrency counter, bumped on every whole-record write.
   *  Absent on records written before it existed — treated as "unversioned",
   *  which the first guarded write migrates. Never edit this by hand. */
  rev?: number;
  cash: number;
  debt: number;
  /** The Holding's display name (set at onboarding). */
  name?: string;
  /** What this firm calls its manufacturing arm. Defaults to a name derived
   *  from the holding ("Shore Holdings" -> "Shore Manufacturing"), which is
   *  what communicates the parent-owns-subsidiary structure for free. Set only
   *  when the owner has renamed it. */
  mfgName?: string;
  /** Order-Desk standing — rises on fulfilment, dips on missed contracts. */
  reputation?: number;
  orders?: Order[];
  /** Last time a new order was rolled onto the desk (ms). */
  lastOrderAt?: number;
  // ── Factory / sales state (live-wired; absent for pre-factory players) ───────
  factories?: Factory[];
  /** Bulk material orders paid for and in transit to the vault. */
  supplyOrders?: SupplyOrder[];
  /** Auto-reorder policies per material. */
  reorders?: ReorderRule[];
  /** Owned real estate (Property Market). */
  properties?: OwnedProperty[];
  /** Equity stakes in AI houses (Deal Room): name → fraction owned. */
  stakes?: Record<string, number>;
  floorSlots?: number;
  infra?: Infra;
  listPrices?: Record<number, number>;
  producedQty?: Record<number, number>;
  listed?: Record<number, boolean>;
  deskAuto?: DeskAuto;
  ledger?: Ledger;
  reports?: Report[];
  periodNo?: number;
  /** Last world cycle this player was settled to (legacy; unused). */
  lastCycle?: number;
  /** Last FAST production tick (wallProdCycle) this player's factories ran
   *  through — the live factory clock, decoupled from the 6h market cycle. */
  lastProdTick?: number;
  /** Last 6h market flip (wallCycle) captured as a report for this player. */
  lastFlip?: number;
  /** The player's company website (manufacturing storefront). */
  site?: SiteConfig;
  /** Last time (ms) this player's portfolio was fetched — the "last seen"
   *  watermark the "While You Were Away" recap diffs against. */
  lastSeenAt?: number;
}

const FRESH_INFRA: Infra = { power: false, router: false, qc: false };
const FRESH_DESKAUTO: DeskAuto = {
  specialist: false,
  autoFulfill: true,
  minMargin: 0.1,
};

/** Build a per-player WorldState from the shared doc + the player's record:
 *  the player's holdings become owners["YOU"], and cash/orders/factory state
 *  come off the player. Run the engine on this, then write back with
 *  extractPlayer (+ mutatePlayerWorld for ownership changes). */
/**
 * What this player owns. Reads their own record first; falls back to the world
 * doc for records written before holdings moved off it, so an existing player
 * keeps their goods and the next write migrates them across.
 */
/**
 * Copy a player's goods off the FULL world state (where they're keyed by player
 * id, not "YOU") onto their record. For paths that run the engine on the whole
 * world rather than a per-player view — the trade endpoint, chiefly.
 */
export function syncHoldings(full: WorldState, player: Player): void {
  const holdings: Record<number, number> = {};
  for (const it of full.items) {
    const q = it.owners[player.playerId] ?? 0;
    if (q > 0) holdings[it.id] = q;
  }
  player.holdings = holdings;
}

export function holdingsOf(doc: WorldDoc, player: Player): Record<number, number> {
  if (player.holdings) return player.holdings;
  const out: Record<number, number> = {};
  for (const it of doc.items) {
    const qty = it.owners?.[player.playerId] ?? 0;
    if (qty > 0) out[it.id] = qty;
  }
  return out;
}

export function playerView(doc: WorldDoc, player: Player): WorldState {
  const w = docToWorld(doc);
  const mineById = holdingsOf(doc, player);
  for (const it of w.items) {
    const mine = mineById[it.id] ?? 0;
    it.owners = mine > 0 ? { YOU: mine } : {};
  }
  w.cash = player.cash;
  w.debt = player.debt;
  w.reputation = player.reputation ?? 0;
  w.orders = player.orders ?? [];
  w.lastOrderAt = player.lastOrderAt ?? 0;
  w.factories = player.factories ?? [];
  w.supplyOrders = player.supplyOrders ?? [];
  w.reorders = player.reorders ?? [];
  w.properties = player.properties ?? [];
  w.stakes = player.stakes ?? {};
  w.floorSlots = player.floorSlots ?? STARTING_SLOTS;
  w.infra = player.infra ?? { ...FRESH_INFRA };
  w.listPrices = player.listPrices ?? {};
  w.producedQty = player.producedQty ?? {};
  w.listed = player.listed ?? {};
  w.deskAuto = player.deskAuto ?? { ...FRESH_DESKAUTO };
  w.ledger = player.ledger ?? emptyLedger();
  w.reports = player.reports ?? [];
  w.periodNo = player.periodNo ?? 0;
  w.cycle = doc.cycle;
  return w;
}

/** Pull the per-player fields off a WorldState back into the player record.
 *  (Holdings live in the world doc — see mutatePlayerWorld for those.) */
export function extractPlayer(state: WorldState, player: Player): Player {
  // Capture the player's goods onto their OWN record. state here is always a
  // playerView, where the owners map has been narrowed to just "YOU".
  const holdings: Record<number, number> = {};
  for (const it of state.items) {
    const q = it.owners["YOU"] ?? 0;
    if (q > 0) holdings[it.id] = q;
  }
  return {
    ...player,
    holdings,
    cash: state.cash,
    debt: state.debt,
    reputation: state.reputation,
    orders: state.orders,
    lastOrderAt: state.lastOrderAt,
    factories: state.factories,
    supplyOrders: state.supplyOrders,
    reorders: state.reorders,
    properties: state.properties,
    stakes: state.stakes,
    floorSlots: state.floorSlots,
    infra: state.infra,
    listPrices: state.listPrices,
    producedQty: state.producedQty,
    listed: state.listed,
    deskAuto: state.deskAuto,
    ledger: state.ledger,
    // Cap the on-record report log so the player item stays well under 400KB.
    reports: (state.reports ?? []).slice(-60),
    periodNo: state.periodNo,
  };
}

/** The full per-player snapshot the live client overlays onto its world: cash,
 *  holdings (from the doc), and all the factory/sales/report state. One shape
 *  served by both GET /portfolio and the factory action endpoint, so the client
 *  has a single overlay path. */
export interface PortfolioView {
  cash: number;
  debt: number;
  netWorth: number;
  reputation: number;
  holdings: { id: number; qty: number; value: number }[];
  floorSlots: number;
  infra: Infra;
  factories: Factory[];
  supplyOrders: SupplyOrder[];
  reorders: ReorderRule[];
  properties: OwnedProperty[];
  stakes: Record<string, number>;
  listPrices: Record<number, number>;
  producedQty: Record<number, number>;
  listed: Record<number, boolean>;
  deskAuto: DeskAuto;
  reports: Report[];
  periodNo: number;
  /** The manufacturing arm's name, when the owner has set their own. */
  mfgName?: string;
  site: SiteConfig | null;
  /** The player's previous lastSeenAt (ms), or null if this is their first
   *  fetch ever. Read-only snapshot — buildPortfolio does not stamp it. */
  awaySince: number | null;
}

/** Build the player's portfolio snapshot from the shared doc + their record.
 *  Holdings + their values come from the doc; everything else from the player. */
/**
 * A firm is worth its cash, its goods, its REAL ESTATE and its EQUITY. All four,
 * everywhere — the portfolio and the leaderboard used to disagree, because the
 * board counted only cash and goods. Any player holding property or a stake in
 * another house was therefore ranked below what their own screen told them they
 * were worth, with no way to tell which number was lying.
 *
 * Split into pieces rather than one function because the standings endpoint
 * sums every owner's goods in a single pass over the doc and shouldn't redo
 * that per player.
 */
export function propertyValueOf(player: Player): number {
  let v = 0;
  for (const op of player.properties ?? []) v += op.value;
  return v;
}

/** The market value of a player's equity in AI houses (their % of each firm's
 *  cash + holdings). Valued off the DOC — the only place every firm's treasury
 *  is actually known. */
export function stakeValueOf(doc: WorldDoc, player: Player): number {
  const stakes = player.stakes ?? {};
  if (!Object.keys(stakes).length) return 0;
  const tByName = new Map((doc.traders ?? []).map((t) => [t.name, t]));
  let v = 0;
  for (const [name, pct] of Object.entries(stakes)) {
    const t = tByName.get(name);
    if (t) v += pct * (t.cash + ownerHoldings(doc, name).assets);
  }
  return v;
}

export function buildPortfolio(doc: WorldDoc, player: Player): PortfolioView {
  const holdings: { id: number; qty: number; value: number }[] = [];
  let assets = 0;
  const mine = holdingsOf(doc, player);
  // Priced off the doc (the live market value), quantities off the player.
  for (const it of doc.items) {
    const qty = mine[it.id] ?? 0;
    if (qty > 0) {
      holdings.push({ id: it.id, qty, value: it.value });
      assets += qty * it.value;
    }
  }
  // Coerced, not trusted. A player item can legitimately be missing these: any
  // targeted UpdateCommand (touchLastSeen, an atomic cash credit) UPSERTS, so a
  // record can exist holding only the attributes that write touched. Undefined
  // here poisons netWorth to NaN, which JSON.stringify emits as null and the
  // client renders as a blank or zero account — a money figure that is wrong
  // with no error anywhere.
  const cash = Number.isFinite(player.cash) ? player.cash : START_CASH;
  const debt = Number.isFinite(player.debt) ? player.debt : 0;
  const props = player.properties ?? [];
  const propValue = propertyValueOf(player);
  const stakeVal = stakeValueOf(doc, player);
  return {
    cash,
    debt,
    netWorth: cash - debt + assets + propValue + stakeVal,
    reputation: player.reputation ?? 0,
    holdings,
    floorSlots: player.floorSlots ?? STARTING_SLOTS,
    infra: player.infra ?? { ...FRESH_INFRA },
    factories: player.factories ?? [],
    supplyOrders: player.supplyOrders ?? [],
    reorders: player.reorders ?? [],
    properties: props,
    stakes: player.stakes ?? {},
    listPrices: player.listPrices ?? {},
    producedQty: player.producedQty ?? {},
    listed: player.listed ?? {},
    deskAuto: player.deskAuto ?? { ...FRESH_DESKAUTO },
    reports: player.reports ?? [],
    periodNo: player.periodNo ?? 0,
    mfgName: player.mfgName,
    site: player.site ?? null,
    awaySince: player.lastSeenAt ?? null,
  };
}

// ── Company websites (the manufacturing storefront) ──────────────────────────

/** A product on a company's public storefront (a LISTED produced good). */
export interface CompanyProduct {
  id: number;
  name: string;
  /** Listed unit price (market value × the seller's markup × QC premium). */
  price: number;
  /** Units the seller has produced and holds (available to order). */
  available: number;
}

/** A directory row — the public card for one company. */
export interface CompanyCard {
  handle: string;
  /** The holding name (the client renders the "… Manufacturing" form). */
  name: string;
  tagline: string;
  accent: string;
  /** Dominant sector key (the client maps it to a label). */
  sector: string;
  /** How many products are on the storefront. */
  products: number;
}

/** One holding (owned item) for the public, auditable holdings grid. */
export interface Holding {
  id: number;
  name: string;
  qty: number;
  value: number;
}

/** The full public page for ANY company — player or AI house. One shape, one
 *  layout: every company is transparent and reads the same. */
export interface CompanySite extends CompanyCard {
  /** "player" = a human's holding; "house" = an AI institution. (UI treats both
   *  identically; this only routes the detail fetch.) */
  kind: "player" | "house";
  about: string;
  sections: NonNullable<SiteConfig["sections"]>;
  storefront: CompanyProduct[];
  /** Public, auditable: net worth, cash, and top holdings — for everyone. */
  netWorth: number;
  cash: number;
  holdings: Holding[];
  standing: { rank: number | null; lines: number; sectors: string[] };
}

const DEFAULT_SECTIONS: NonNullable<SiteConfig["sections"]> = [
  { id: "masthead", on: true },
  { id: "about", on: true },
  { id: "storefront", on: true },
  { id: "standing", on: true },
  { id: "contact", on: false },
];

/** Top-weighted sector of a catalog item. */
function topSectorOf(id: number): string {
  const c = catById.get(id);
  if (!c) return "";
  let best = "";
  let bw = -1;
  for (const k in c.weights) {
    const w = c.weights[k] ?? 0;
    if (w > bw) {
      bw = w;
      best = k;
    }
  }
  return best;
}

/** The LISTED produced goods that make up a player's storefront. */
export function storefrontOf(doc: WorldDoc, player: Player): CompanyProduct[] {
  const prod = player.producedQty ?? {};
  const qcOn = !!player.infra?.qc;
  const out: CompanyProduct[] = [];
  for (const idStr of Object.keys(prod)) {
    const id = Number(idStr);
    const qty = prod[id] ?? 0;
    if (qty <= 0) continue;
    if (player.listed?.[id] === false) continue; // unlisted = held, not for sale
    const it = doc.items.find((i) => i.id === id);
    if (!it) continue;
    const mult = player.listPrices?.[id] ?? 1;
    out.push({
      id,
      // These units came off THIS firm's line, so they're sold under this
      // firm's own designation — not the catalog brand that originated the
      // design. Two firms making the same good compete as themselves.
      name: makerVariantName(catById.get(id)?.name ?? `#${id}`, player.name, id),
      // Same canonical formula the engine uses for listing sales + order pricing.
      price: Math.round(listedUnitPrice(it.value, mult, qcOn)),
      available: qty,
    });
  }
  return out.sort((a, b) => b.price - a.price);
}

/** Dominant sectors a company works in (from its storefront, else its lines). */
function companySectors(player: Player, store: CompanyProduct[]): string[] {
  const tally: Record<string, number> = {};
  const ids = store.length
    ? store.map((p) => p.id)
    : (player.factories ?? []).map((f) => f.itemId);
  for (const id of ids) {
    const s = topSectorOf(id);
    if (s) tally[s] = (tally[s] ?? 0) + 1;
  }
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s)
    .slice(0, 3);
}

/** A company's holdings (from the world doc) + their total value, top-first.
 *  Works for any owner key — a player id or an AI company name. */
function ownerHoldings(doc: WorldDoc, ownerKey: string) {
  let assets = 0;
  const holdings: Holding[] = [];
  for (const it of doc.items) {
    const qty = it.owners?.[ownerKey] ?? 0;
    if (qty > 0) {
      assets += qty * it.value;
      holdings.push({ id: it.id, name: catById.get(it.id)?.name ?? `#${it.id}`, qty, value: it.value });
    }
  }
  holdings.sort((a, b) => b.qty * b.value - a.qty * a.value);
  return { assets, holdings };
}

const houseHandle = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * A firm's stable address. Its published site handle if it has one, otherwise
 * derived from the holding name — because a firm's IDENTITY shouldn't depend on
 * whether its owner has built a website. Order routing and the Deal Room key on
 * this, so a holding can be traded with from the moment it's named.
 */
export function firmHandle(p: Player): string {
  return p.site?.handle ?? houseHandle(p.name ?? p.playerId);
}

/**
 * Find the player a deal is addressed to. Prefers an exact published-site
 * handle (the canonical address) and falls back to the derived one, so an
 * offer reaches a firm that has never published a page.
 */
export function findFirmByHandle(players: Player[], handle: string): Player | undefined {
  return (
    players.find((p) => p.site?.handle === handle && p.site?.published) ??
    players.find((p) => !!p.name && firmHandle(p) === handle)
  );
}
const houseName = (name: string) => name.replace(/_/g, " ");
const HOUSE_SECTIONS: NonNullable<SiteConfig["sections"]> = [
  { id: "masthead", on: true },
  { id: "standing", on: true },
];

/** One row in the UNIFIED company directory — a player OR an AI house, same shape. */
export interface DirEntry {
  handle: string;
  name: string;
  kind: "player" | "house";
  sector: string;
  accent: string;
  netWorth: number;
  /** Has a public company page. Unpublished firms are still tradeable. */
  published?: boolean;
}

/** The whole directory: every published player company + every AI house, as the
 *  same kind of entry, richest first — one list, indistinguishable. */
export function companyEntries(doc: WorldDoc, players: Player[]): DirEntry[] {
  const entries: DirEntry[] = [];
  for (const p of players) {
    // A named holding is a firm whether or not it has published a website.
    // Requiring a published site here made a real firm invisible in the Deal
    // Room and impossible to send an offer to — you can't acquire a company
    // that hasn't got round to building a homepage.
    if (!p.name) continue;
    const sectors = companySectors(p, storefrontOf(doc, p));
    const { assets } = ownerHoldings(doc, p.playerId);
    entries.push({
      handle: firmHandle(p),
      name: p.name,
      kind: "player",
      sector: sectors[0] ?? "",
      accent: p.site?.accent ?? "gold",
      netWorth: Math.round((p.cash ?? 0) - (p.debt ?? 0) + assets),
      // Only a published firm has a public page to visit; everyone can still
      // be traded with.
      published: !!p.site?.published,
    });
  }
  for (const t of doc.traders ?? []) {
    const { assets } = ownerHoldings(doc, t.name);
    entries.push({
      handle: houseHandle(t.name),
      name: houseName(t.name),
      kind: "house",
      sector: t.bias ?? "",
      accent: "ink",
      netWorth: Math.round(t.cash + assets),
    });
  }
  return entries.sort((a, b) => b.netWorth - a.netWorth);
}

/** A player's full public company page — transparent (net worth + holdings too). */
export function companySite(
  doc: WorldDoc,
  player: Player,
  rank: number | null,
): CompanySite {
  const site = player.site ?? { handle: "" };
  const store = storefrontOf(doc, player);
  const sectors = companySectors(player, store);
  const { assets, holdings } = ownerHoldings(doc, player.playerId);
  return {
    handle: site.handle,
    name: player.name ?? "Unnamed Holding",
    kind: "player",
    tagline: site.tagline ?? "",
    accent: site.accent ?? "gold",
    sector: sectors[0] ?? "",
    products: store.length,
    about: site.about ?? "",
    sections: site.sections ?? DEFAULT_SECTIONS,
    storefront: store,
    netWorth: Math.round((player.cash ?? 0) - (player.debt ?? 0) + assets),
    cash: Math.round(player.cash ?? 0),
    holdings: holdings.slice(0, 12),
    standing: { rank, lines: (player.factories ?? []).length, sectors },
  };
}

/** An AI house's full public page — the SAME shape + layout as a player's. */
export function houseView(
  doc: WorldDoc,
  handle: string,
  rankByName: Map<string, number>,
): CompanySite | null {
  const t = (doc.traders ?? []).find((x) => houseHandle(x.name) === handle);
  if (!t) return null;
  const { assets, holdings } = ownerHoldings(doc, t.name);
  const sector = t.bias ?? "";
  return {
    handle,
    name: houseName(t.name),
    kind: "house",
    tagline: sector ? "Institutional house" : "Broad-market index",
    accent: "ink",
    sector,
    products: 0,
    about: "",
    sections: HOUSE_SECTIONS,
    storefront: [],
    netWorth: Math.round(t.cash + assets),
    cash: Math.round(t.cash),
    holdings: holdings.slice(0, 12),
    standing: { rank: rankByName.get(t.name) ?? null, lines: 0, sectors: sector ? [sector] : [] },
  };
}

export async function getPlayer(playerId: string): Promise<Player | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: PLAYERS, Key: { playerId } }),
  );
  return (res.Item as Player) ?? null;
}

/** Atomically set just lastSeenAt, touching no other attribute. Deliberately
 *  NOT a read-modify-write savePlayer() call: this runs from the hottest,
 *  most frequent endpoint (portfolio, polled every 15s), which can easily
 *  interleave with production.ts's transactional per-tick commits on the
 *  same player. A full-item overwrite from a stale read would silently
 *  clobber whatever production just wrote (cash, factories, reports) back
 *  to the snapshot this request started with. */
export async function touchLastSeen(playerId: string, at: number): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: PLAYERS,
      Key: { playerId },
      UpdateExpression: "SET lastSeenAt = :at",
      ExpressionAttributeValues: { ":at": at },
    }),
  );
}

/**
 * Thrown when a guarded player write loses a race — the record changed between
 * the read this write was built from and the write itself. Never means the data
 * is bad; it means this attempt is stale and must be rebuilt from a fresh read.
 */
export class PlayerConflictError extends Error {
  constructor(playerId: string) {
    super(`player ${playerId} changed under us`);
    this.name = "PlayerConflictError";
  }
}

/** The condition + item for a guarded whole-record write. A player record is
 *  only overwritten if it still carries the rev the caller read; records
 *  predating rev match on its absence, so the first guarded write migrates
 *  them without a backfill. */
export function guardedPut(p: Player, slot = ""): {
  Item: Player;
  ConditionExpression: string;
  ExpressionAttributeValues?: Record<string, unknown>;
} {
  const next = { ...p, rev: (p.rev ?? 0) + 1 };
  if (p.rev === undefined) {
    return {
      Item: next,
      ConditionExpression: "attribute_not_exists(playerId) OR attribute_not_exists(rev)",
    };
  }
  const key = `:rev${slot}`;
  return {
    Item: next,
    ConditionExpression: `rev = ${key}`,
    ExpressionAttributeValues: { [key]: p.rev },
  };
}

/**
 * Persist a whole player record, but ONLY if nobody else has written it since
 * the read this was built from. Whole-record Puts are how the settlement and
 * production Lambdas write, and an unguarded Put from a stale read silently
 * reverts whatever landed in between — cash, factories, purchases. Losing that
 * race must be loud, so callers can retry against fresh data instead of quietly
 * wiping a player's account.
 *
 * Prefer withPlayer() over calling this directly: it does the read/retry.
 */
export async function savePlayer(p: Player): Promise<void> {
  const { Item, ConditionExpression, ExpressionAttributeValues } = guardedPut(p);
  try {
    await ddb.send(
      new PutCommand({
        TableName: PLAYERS,
        Item,
        ConditionExpression,
        ...(ExpressionAttributeValues ? { ExpressionAttributeValues } : {}),
      }),
    );
    // Keep the caller's object in step, so a second save in the same request
    // doesn't fail against the rev it just superseded.
    p.rev = Item.rev;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      throw new PlayerConflictError(p.playerId);
    }
    throw err;
  }
}

/** How many times a contended player update is rebuilt before giving up. */
const PLAYER_WRITE_RETRIES = 4;

/**
 * Run a read→mutate→save block, retrying it whole if the save lost a rev race.
 * `run` MUST do its own getPlayer() so each attempt is rebuilt from fresh
 * state — retrying a block that closes over a stale record just re-sends the
 * same doomed write.
 *
 * For handlers whose branches return HTTP results directly; use withPlayer()
 * when you only need to mutate a record.
 */
export async function retryOnConflict<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (err instanceof PlayerConflictError && attempt < PLAYER_WRITE_RETRIES) continue;
      throw err;
    }
  }
}

/**
 * Read-modify-write a player safely: load the record, apply `mutate`, write it
 * back under its rev, and on a lost race re-read and re-apply against what
 * actually landed. This is the shape nearly every handler wants — doing the
 * read and the write by hand is how stale-snapshot overwrites creep back in.
 *
 * `mutate` must be pure with respect to the record it's handed (it may run
 * several times) and returns the record to write, or null to abort the write.
 */
export async function withPlayer(
  playerId: string,
  mutate: (p: Player) => Player | null | Promise<Player | null>,
): Promise<Player | null> {
  for (let attempt = 0; ; attempt++) {
    const current = (await getPlayer(playerId)) ?? { playerId, cash: START_CASH, debt: 0 };
    const next = await mutate(current);
    if (!next) return null;
    try {
      await savePlayer(next);
      return next;
    } catch (err) {
      if (err instanceof PlayerConflictError && attempt < PLAYER_WRITE_RETRIES) continue;
      throw err;
    }
  }
}

/** Atomically set just cash, touching no other attribute — same reasoning as
 *  touchLastSeen. A read-modify-write savePlayer() here loses to production.ts,
 *  which rewrites whole player items every 5 minutes from a snapshot taken at
 *  tick start: the cash lands, then the next tick puts the stale record back
 *  and the change silently evaporates. Returns the value actually stored. */
/** Atomically set just `holdings`, touching nothing else — used to migrate a
 *  record whose goods still live in the world doc. Same reasoning as
 *  touchLastSeen: a full-item write from a stale read loses to production. */
export async function setPlayerHoldings(
  playerId: string,
  holdings: Record<number, number>,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: PLAYERS,
      Key: { playerId },
      // Only if it hasn't been migrated already, so this can never overwrite
      // holdings that a real trade wrote in the meantime.
      UpdateExpression: "SET holdings = :h",
      ConditionExpression: "attribute_not_exists(holdings)",
      ExpressionAttributeValues: { ":h": holdings },
    }),
  );
}

export async function addPlayerCash(playerId: string, delta: number): Promise<number> {
  const res = await ddb.send(
    new UpdateCommand({
      TableName: PLAYERS,
      Key: { playerId },
      // ADD is applied by Dynamo itself, so a credit can't lose a race the way
      // read-add-write can — no guard or retry needed.
      UpdateExpression: "ADD cash :d",
      ExpressionAttributeValues: { ":d": delta },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return Number(res.Attributes?.cash ?? 0);
}

export async function setPlayerCash(playerId: string, cash: number): Promise<number> {
  const res = await ddb.send(
    new UpdateCommand({
      TableName: PLAYERS,
      Key: { playerId },
      UpdateExpression: "SET cash = :c",
      ExpressionAttributeValues: { ":c": cash },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return Number(res.Attributes?.cash ?? cash);
}

/** Fetch specific players by id (BatchGetItem, chunked to Dynamo's 100-key
 *  cap). For targeted lookups — e.g. standing-order sellers referenced by a
 *  handful of buyers' factories — where a full `allPlayers()` scan would be
 *  wasteful. Silently skips ids with no matching record; dedupes input. */
export async function getPlayers(ids: string[]): Promise<Player[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const out: Player[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    let keys = unique.slice(i, i + 100).map((playerId) => ({ playerId }));
    // A handful of retries for any keys DynamoDB didn't process this round
    // (throttling) — bounded, since this is a small targeted batch, not a
    // full scan; a key still unprocessed after this just isn't returned
    // (self-heals: the caller treats a missing seller as "skip this tick").
    for (let attempt = 0; keys.length && attempt < 3; attempt++) {
      const res = await ddb.send(
        new BatchGetCommand({ RequestItems: { [PLAYERS]: { Keys: keys } } }),
      );
      out.push(...((res.Responses?.[PLAYERS] as Player[]) ?? []));
      keys = (res.UnprocessedKeys?.[PLAYERS]?.Keys as { playerId: string }[]) ?? [];
    }
  }
  return out;
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

// ── Player-to-player orders (multiplayer routing) ────────────────────────────

export async function putOrder(o: PvpOrder): Promise<void> {
  await ddb.send(new PutCommand({ TableName: ORDERS, Item: o }));
}

export async function getOrder(id: string): Promise<PvpOrder | null> {
  const res = await ddb.send(new GetCommand({ TableName: ORDERS, Key: { id } }));
  return (res.Item as PvpOrder) ?? null;
}

export async function deleteOrder(id: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: ORDERS, Key: { id } }));
}

async function ordersByIndex(index: string, key: string, value: string): Promise<PvpOrder[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: ORDERS,
      IndexName: index,
      KeyConditionExpression: "#k = :v",
      ExpressionAttributeNames: { "#k": key },
      ExpressionAttributeValues: { ":v": value },
    }),
  );
  return (res.Items as PvpOrder[]) ?? [];
}

/** Incoming requests on a player's desk (they're the seller). */
export const ordersForSeller = (sellerId: string) =>
  ordersByIndex("sellerId-index", "sellerId", sellerId);
/** A player's outgoing requests (they're the buyer). */
export const ordersForBuyer = (buyerId: string) =>
  ordersByIndex("buyerId-index", "buyerId", buyerId);

export type DealResult =
  | { ok: true; price: number; qty: number }
  | { ok: false; reason: string };

/**
 * Settle a player-to-player deal atomically: the seller's goods move to the
 * buyer's vault, the buyer's cash moves to the seller (who also gains a little
 * reputation), and the order is removed — all in ONE transaction. Guarded by:
 * the world version (so a racing trade/production write makes us re-validate the
 * seller's stock) and the buyer's `cash >= price` condition (so they can never
 * overspend). Bought goods land as ordinary holdings (resellable). Retries on
 * contention. (The seller's producedQty self-heals via sellListings/storefront
 * clamps — left out of the transaction to keep it robust.)
 */
export async function settleDeal(orderId: string, retries = 4): Promise<DealResult> {
  for (let attempt = 0; ; attempt++) {
    const order = await getOrder(orderId);
    if (!order) return { ok: false, reason: "order is gone" };
    const cur = await loadWorld();
    if (!cur) return { ok: false, reason: "world not seeded" };

    // Goods live on the players' own records now, so both sides load.
    const [buyer, seller] = await Promise.all([
      getPlayer(order.buyerId),
      getPlayer(order.sellerId),
    ]);
    if (!buyer) return { ok: false, reason: "buyer is gone" };
    if (!seller) return { ok: false, reason: "that firm is gone" };
    if (buyer.cash < order.price) return { ok: false, reason: "buyer can't cover it" };

    const sellerHoldings = { ...holdingsOf(cur as WorldDoc, seller) };
    const buyerHoldings = { ...holdingsOf(cur as WorldDoc, buyer) };
    const sellerHeld = sellerHoldings[order.itemId] ?? 0;
    if (sellerHeld < order.qty)
      return { ok: false, reason: "seller no longer holds enough" };

    const left = sellerHeld - order.qty;
    if (left > 0) sellerHoldings[order.itemId] = left;
    else delete sellerHoldings[order.itemId];
    buyerHoldings[order.itemId] = (buyerHoldings[order.itemId] ?? 0) + order.qty;

    const nextBuyer: Player = {
      ...buyer,
      cash: buyer.cash - order.price,
      holdings: buyerHoldings,
    };
    const nextSeller: Player = {
      ...seller,
      cash: seller.cash + order.price,
      reputation: (seller.reputation ?? 0) + 2,
      holdings: sellerHoldings,
    };
    // The doc still moves forward so the version CAS keeps this serialised
    // against production and settlement, even though the goods no longer
    // live in it.
    const nextDoc = worldToDoc(docToWorld(cur), cur.version + 1);

    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLE,
                Item: { pk: PK, version: nextDoc.version, world: nextDoc },
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": cur.version },
              },
            },
            // Whole-record writes rather than an atomic ADD on cash: the goods
            // moving are on these records now, and one DynamoDB transaction
            // can't both ADD to an item and Put it. The rev guard gives the
            // same protection the `cash >= price` condition did — a racing
            // write cancels the transaction and the retry re-validates
            // affordability against fresh records.
            { Put: { TableName: PLAYERS, ...guardedPut(nextBuyer, "b") } },
            { Put: { TableName: PLAYERS, ...guardedPut(nextSeller, "s") } },
            {
              Delete: {
                TableName: ORDERS,
                Key: { id: orderId },
                ConditionExpression: "attribute_exists(id)",
              },
            },
          ],
        }),
      );
      return { ok: true, price: order.price, qty: order.qty };
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (
        (name === "TransactionCanceledException" ||
          name === "ConditionalCheckFailedException") &&
        attempt < retries
      ) {
        continue; // version race or transient — reload + re-validate
      }
      if (name === "TransactionCanceledException" || name === "ConditionalCheckFailedException")
        return { ok: false, reason: "buyer can't cover it (or it just changed)" };
      throw err;
    }
  }
}

const mergeNums = (
  a: Record<string | number, number> = {},
  b: Record<string | number, number> = {},
  cap?: number,
): Record<string, number> => {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const sum = (out[k] ?? 0) + v;
    out[k] = cap ? Math.min(cap, sum) : sum;
  }
  return out;
};

/** Settle a full BUYOUT (M&A): atomically move the target's ENTIRE firm to the
 *  buyer (cash, factories, properties, stakes, produced stock, market holdings),
 *  and leave the target liquid — they keep the agreed price, firm liquidated.
 *  Optimistic locks: world `version` + each player's `cash` unchanged since read. */
export async function settleBuyout(orderId: string, retries = 4): Promise<DealResult> {
  for (let attempt = 0; ; attempt++) {
    const order = await getOrder(orderId);
    if (!order) return { ok: false, reason: "offer is gone" };
    const [buyer, target, cur] = await Promise.all([
      getPlayer(order.buyerId),
      getPlayer(order.sellerId),
      loadWorld(),
    ]);
    if (!buyer) return { ok: false, reason: "buyer is gone" };
    if (!target) return { ok: false, reason: "that firm is gone" };
    if (!cur) return { ok: false, reason: "world not seeded" };
    if (buyer.cash < order.price) return { ok: false, reason: "buyer can't cover it" };

    // The acquired firm's goods move to the buyer. They live on the two player
    // records now, not in the doc, so this is a merge of two maps — but the doc
    // still moves forward so the version CAS keeps the whole thing serialised
    // against production and settlement.
    const mergedHoldings = mergeNums(
      holdingsOf(cur as WorldDoc, buyer),
      holdingsOf(cur as WorldDoc, target),
    );
    const nextDoc = worldToDoc(docToWorld(cur as WorldDoc), cur.version + 1);

    const buyerFactories = [...(buyer.factories ?? []), ...(target.factories ?? [])];
    const mergedBuyer: Player = {
      ...buyer,
      // Buyer pays the price and absorbs the target's treasury + assets.
      cash: buyer.cash - order.price + target.cash,
      holdings: mergedHoldings,
      factories: buyerFactories,
      properties: [...(buyer.properties ?? []), ...(target.properties ?? [])],
      stakes: mergeNums(buyer.stakes, target.stakes, 1),
      producedQty: mergeNums(buyer.producedQty, target.producedQty),
      listPrices: { ...(target.listPrices ?? {}), ...(buyer.listPrices ?? {}) },
      listed: { ...(target.listed ?? {}), ...(buyer.listed ?? {}) },
      floorSlots: Math.max(buyer.floorSlots ?? STARTING_SLOTS, buyerFactories.length),
      infra: {
        power: !!(buyer.infra?.power || target.infra?.power),
        router: !!(buyer.infra?.router || target.infra?.router),
        qc: !!(buyer.infra?.qc || target.infra?.qc),
      },
    };
    // The acquired firm cashes out: keeps the agreed price, everything else wiped.
    // Clearing `site` too means their public company page 404s immediately —
    // the handler already treats a missing site as "no such company" (see
    // handlers/company.ts), so there's nothing else to update there.
    const cashedOut: Player = {
      ...target,
      cash: order.price,
      // Firm liquidated: the goods went with it.
      holdings: {},
      factories: [],
      properties: [],
      stakes: {},
      producedQty: {},
      listed: {},
      listPrices: {},
      floorSlots: STARTING_SLOTS,
      infra: { ...FRESH_INFRA },
      site: undefined,
      // The firm was SOLD — the name went with it, along with everything else.
      // Keeping it meant a player walked away from a full liquidation still
      // trading under the banner they'd just handed over, and never saw the
      // onboarding that a fresh start is supposed to begin with. Clearing it
      // is what makes the naming gate fire again (Terminal treats a nameless
      // holding as a new one).
      name: undefined,
      reputation: 0,
      orders: [],
      reports: [],
      ledger: emptyLedger(),
      periodNo: 0,
    };

    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLE,
                Item: { pk: PK, version: nextDoc.version, world: nextDoc },
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": cur.version },
              },
            },
            // rev, not cash: a cash-only guard misses every change that
            // doesn't move cash (factories, produced stock, site), so a
            // concurrent write to those was invisible to this check.
            { Put: { TableName: PLAYERS, ...guardedPut(mergedBuyer, "b") } },
            { Put: { TableName: PLAYERS, ...guardedPut(cashedOut, "t") } },
            {
              Delete: {
                TableName: ORDERS,
                Key: { id: orderId },
                ConditionExpression: "attribute_exists(id)",
              },
            },
          ],
        }),
      );
      return { ok: true, price: order.price, qty: 1 };
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (
        (name === "TransactionCanceledException" ||
          name === "ConditionalCheckFailedException") &&
        attempt < retries
      ) {
        continue; // version/cash race or transient — reload + re-validate
      }
      if (name === "TransactionCanceledException" || name === "ConditionalCheckFailedException")
        return { ok: false, reason: "it just changed — try again" };
      throw err;
    }
  }
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

/** Run an engine op on a per-player WorldState and persist atomically: the
 *  player's holdings (owners["YOU"]) map back into the shared doc under their id
 *  (others preserved), and the player record is written under optimistic CAS.
 *  Returns the op's result plus the mutated per-player state (for building a
 *  response view). `fn` may throw TradeError to reject without retry. */
export async function mutatePlayerWorld<T>(
  playerId: string,
  fn: (state: WorldState) => T,
  retries = 5,
): Promise<{ result: T; state: WorldState }> {
  for (let attempt = 0; ; attempt++) {
    const cur = await loadWorld();
    if (!cur) throw new Error("world not seeded");
    const existing = await getPlayer(playerId);
    const isNew = !existing;
    const base: Player = existing ?? { playerId, cash: START_CASH, debt: 0 };

    const full = docToWorld(cur); // all players' holdings
    const pv = playerView(cur, base); // this player's view (owners["YOU"])
    const result = fn(pv); // engine mutates pv; may throw TradeError

    // Map this player's holdings back into the full doc (others untouched).
    const byId = new Map(full.items.map((it) => [it.id, it]));
    for (const it of pv.items) {
      const f = byId.get(it.id);
      if (!f) continue;
      const v = it.owners["YOU"] ?? 0;
      if (v > 0) f.owners[playerId] = v;
      else delete f.owners[playerId];
      // playerView strips the owners map down to just YOU, so any OTHER owner
      // sitting here was created by the engine during this very operation —
      // an AI company taking delivery of a contract it just paid for. Those
      // are deltas from zero, so they add on. Reading only YOU (as this did)
      // meant the buyer's goods were dropped on the way to the doc and the
      // units vanished from the world.
      for (const [owner, qty] of Object.entries(it.owners)) {
        if (owner === "YOU" || !(qty > 0)) continue;
        f.owners[owner] = (f.owners[owner] ?? 0) + qty;
      }
    }
    // Persist any AI-company treasury changes (e.g. an order fulfilment debits
    // the buyer company's cash — the closed loop).
    const tradersByName = new Map(full.traders.map((t) => [t.name, t]));
    for (const t of pv.traders) {
      const ft = tradersByName.get(t.name);
      if (ft) ft.cash = t.cash;
    }
    const nextDoc = worldToDoc(full, cur.version + 1);
    const player = extractPlayer(pv, base);

    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLE,
                Item: { pk: PK, version: nextDoc.version, world: nextDoc },
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": cur.version },
              },
            },
            // rev rather than cash+debt: those caught money races but were
            // blind to the rest of the record (factories, produced stock,
            // reports, site), so a concurrent write to any of those was
            // invisible to this check and got silently overwritten.
            { Put: { TableName: PLAYERS, ...guardedPut(player) } },
          ],
        }),
      );
      return { result, state: pv };
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (
        (name === "TransactionCanceledException" ||
          name === "ConditionalCheckFailedException") &&
        attempt < retries
      ) {
        continue;
      }
      throw err;
    }
  }
}

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

    const state = docToWorld(cur);
    const result = fn(state, player); // throws TradeError to reject
    // The engine wrote the bought/sold units into the doc's owners map; mirror
    // them onto the player's own record, which is now where holdings live.
    syncHoldings(state, player);
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
            // rev rather than cash+debt: those caught money races but were
            // blind to the rest of the record (factories, produced stock,
            // reports, site), so a concurrent write to any of those was
            // invisible to this check and got silently overwritten.
            { Put: { TableName: PLAYERS, ...guardedPut(player) } },
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

/**
 * Overwrite the world document unconditionally — the ONLY write here that
 * doesn't guard on a version. seedWorld() is create-only by design (it fails
 * silently if a world exists) precisely so nothing can flatten a live economy
 * by accident; this is the deliberate opposite, and exists solely for the
 * reset handler. Do not call it from anything a player can reach.
 */
export async function forceSeedWorld(state: WorldState): Promise<WorldDoc> {
  const doc = worldToDoc(state, 1);
  await ddb.send(
    new PutCommand({ TableName: TABLE, Item: { pk: PK, version: 1, world: doc } }),
  );
  return doc;
}

/** Remove a player record outright. Used only by the world reset. */
export async function deletePlayer(playerId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: PLAYERS, Key: { playerId } }));
}
