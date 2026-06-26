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
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { items as catalog } from "@trove/data";
import {
  createWorld,
  DEBT_RATE,
  emptyLedger,
  listedUnitPrice,
  START_CASH,
  STARTING_SLOTS,
  wallCycle,
  type DeskAuto,
  type Factory,
  type Infra,
  type Ledger,
  type PvpOrder,
  type Report,
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
        ...batch.map((p) => ({
          Put: { TableName: PLAYERS, Item: p },
        })),
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
  cash: number;
  debt: number;
  /** The Holding's display name (set at onboarding). */
  name?: string;
  /** Order-Desk standing — rises on fulfilment, dips on missed contracts. */
  reputation?: number;
  orders?: Order[];
  /** Last time a new order was rolled onto the desk (ms). */
  lastOrderAt?: number;
  // ── Factory / sales state (live-wired; absent for pre-factory players) ───────
  factories?: Factory[];
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
}

const FRESH_INFRA: Infra = { power: false, router: false, qc: false };
const FRESH_DESKAUTO: DeskAuto = {
  specialist: false,
  autoFulfill: false,
  minMargin: 0.1,
};

/** Build a per-player WorldState from the shared doc + the player's record:
 *  the player's holdings become owners["YOU"], and cash/orders/factory state
 *  come off the player. Run the engine on this, then write back with
 *  extractPlayer (+ mutatePlayerWorld for ownership changes). */
export function playerView(doc: WorldDoc, player: Player): WorldState {
  const w = docToWorld(doc);
  for (const it of w.items) {
    const mine = it.owners[player.playerId] ?? 0;
    it.owners = mine > 0 ? { YOU: mine } : {};
  }
  w.cash = player.cash;
  w.debt = player.debt;
  w.reputation = player.reputation ?? 0;
  w.orders = player.orders ?? [];
  w.lastOrderAt = player.lastOrderAt ?? 0;
  w.factories = player.factories ?? [];
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
  return {
    ...player,
    cash: state.cash,
    debt: state.debt,
    reputation: state.reputation,
    orders: state.orders,
    lastOrderAt: state.lastOrderAt,
    factories: state.factories,
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
  listPrices: Record<number, number>;
  producedQty: Record<number, number>;
  listed: Record<number, boolean>;
  deskAuto: DeskAuto;
  reports: Report[];
  periodNo: number;
  site: SiteConfig | null;
}

/** Build the player's portfolio snapshot from the shared doc + their record.
 *  Holdings + their values come from the doc; everything else from the player. */
export function buildPortfolio(doc: WorldDoc, player: Player): PortfolioView {
  const holdings: { id: number; qty: number; value: number }[] = [];
  let assets = 0;
  for (const it of doc.items) {
    const qty = it.owners?.[player.playerId] ?? 0;
    if (qty > 0) {
      holdings.push({ id: it.id, qty, value: it.value });
      assets += qty * it.value;
    }
  }
  const cash = player.cash;
  const debt = player.debt;
  return {
    cash,
    debt,
    netWorth: cash - debt + assets,
    reputation: player.reputation ?? 0,
    holdings,
    floorSlots: player.floorSlots ?? STARTING_SLOTS,
    infra: player.infra ?? { ...FRESH_INFRA },
    factories: player.factories ?? [],
    listPrices: player.listPrices ?? {},
    producedQty: player.producedQty ?? {},
    listed: player.listed ?? {},
    deskAuto: player.deskAuto ?? { ...FRESH_DESKAUTO },
    reports: player.reports ?? [],
    periodNo: player.periodNo ?? 0,
    site: player.site ?? null,
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
      name: catById.get(id)?.name ?? `#${id}`,
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
}

/** The whole directory: every published player company + every AI house, as the
 *  same kind of entry, richest first — one list, indistinguishable. */
export function companyEntries(doc: WorldDoc, players: Player[]): DirEntry[] {
  const entries: DirEntry[] = [];
  for (const p of players) {
    if (!p.site?.handle || !p.site.published || !p.name) continue;
    const sectors = companySectors(p, storefrontOf(doc, p));
    const { assets } = ownerHoldings(doc, p.playerId);
    entries.push({
      handle: p.site.handle,
      name: p.name,
      kind: "player",
      sector: sectors[0] ?? "",
      accent: p.site.accent ?? "gold",
      netWorth: Math.round((p.cash ?? 0) - (p.debt ?? 0) + assets),
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

    const stored = cur.items.find((i) => i.id === order.itemId);
    const sellerHeld = stored?.owners?.[order.sellerId] ?? 0;
    if (sellerHeld < order.qty)
      return { ok: false, reason: "seller no longer holds enough" };

    // Move the goods in a full world projection, then write with a version CAS.
    const full = docToWorld(cur);
    const it = full.items.find((i) => i.id === order.itemId);
    if (!it) return { ok: false, reason: "unknown item" };
    const sH = it.owners[order.sellerId] ?? 0;
    if (sH - order.qty > 0) it.owners[order.sellerId] = sH - order.qty;
    else delete it.owners[order.sellerId];
    it.owners[order.buyerId] = (it.owners[order.buyerId] ?? 0) + order.qty;
    const nextDoc = worldToDoc(full, cur.version + 1);

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
            {
              Update: {
                TableName: PLAYERS,
                Key: { playerId: order.buyerId },
                UpdateExpression: "ADD cash :neg",
                ConditionExpression: "attribute_exists(playerId) AND cash >= :price",
                ExpressionAttributeValues: { ":neg": -order.price, ":price": order.price },
              },
            },
            {
              Update: {
                TableName: PLAYERS,
                Key: { playerId: order.sellerId },
                UpdateExpression: "ADD cash :price, reputation :rep",
                ConditionExpression: "attribute_exists(playerId)",
                ExpressionAttributeValues: { ":price": order.price, ":rep": 2 },
              },
            },
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
    const prevCash = base.cash;
    const prevDebt = base.debt;

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
