/**
 * Client for the shared-world API. Reads (/world, /standings) are anonymous;
 * writes (/trade) and the player's own view (/portfolio) carry the Cognito id
 * token.
 */
import type {
  DeskAuto,
  Factory,
  Infra,
  OwnedProperty,
  PvpOrder,
  Report,
  SiteConfig,
} from "@trove/engine";

export type { PvpOrder };
import { API_BASE } from "./config";
import { getIdToken } from "./auth";

export interface ApiItem {
  id: number;
  value: number;
  prevValue: number;
  stock: number;
  remaining: number | null;
}
export interface ApiFront {
  kick: string;
  head: string;
  body: string;
  cycle: number;
}
export interface ApiWorld {
  cycle: number;
  items: ApiItem[];
  front: ApiFront | null;
  archive: { head: string; kick: string; cycle: number }[];
}
export interface ApiStanding {
  handle: string;
  id: string;
  net: number;
  isAI: boolean;
}
export interface ApiPortfolio {
  cash: number;
  debt: number;
  netWorth: number;
  holdings: { id: number; qty: number; value: number }[];
  // Factory / sales / report state (live-wired). Optional so an older API or a
  // brand-new player without a record still overlays cleanly.
  reputation?: number;
  floorSlots?: number;
  infra?: Infra;
  factories?: Factory[];
  properties?: OwnedProperty[];
  stakes?: Record<string, number>;
  listPrices?: Record<number, number>;
  producedQty?: Record<number, number>;
  listed?: Record<number, boolean>;
  deskAuto?: DeskAuto;
  reports?: Report[];
  periodNo?: number;
  /** The player's own company-site config (so the owner can edit a draft). */
  site?: SiteConfig | null;
}

// ── Company websites (manufacturing storefront) ──────────────────────────────
export interface CompanyProduct {
  id: number;
  name: string;
  price: number;
  available: number;
}
export interface CompanyCard {
  handle: string;
  name: string;
  tagline: string;
  accent: string;
  sector: string;
  products: number;
}
export interface Holding {
  id: number;
  name: string;
  qty: number;
  value: number;
}
export interface CompanySite extends CompanyCard {
  kind: "player" | "house";
  about: string;
  sections: { id: string; on: boolean }[];
  storefront: CompanyProduct[];
  netWorth: number;
  cash: number;
  holdings: Holding[];
  standing: { rank: number | null; lines: number; sectors: string[] };
}

/** One row in the unified company directory (player or AI house — same shape). */
export interface DirEntry {
  handle: string;
  name: string;
  kind: "player" | "house";
  sector: string;
  accent: string;
  netWorth: number;
}

// ── Player-to-player orders (multiplayer routing) ────────────────────────────
export const fetchOrders = () =>
  get<{ incoming: PvpOrder[]; outgoing: PvpOrder[] }>("/orders", true);

type OrdersResult<T> = T | { error: string; status: number };

async function ordersPost<T>(path: string, payload: unknown): Promise<OrdersResult<T>> {
  const token = getIdToken();
  if (!token) return { error: "unauthorized", status: 401 };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify(payload),
    });
  } catch {
    return { error: "network error", status: 0 };
  }
  if (!res.ok) {
    let msg = `failed (${res.status})`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* keep */
    }
    return { error: msg, status: res.status };
  }
  return res.json() as Promise<T>;
}

/** Buyer creates a bulk request against a company's storefront. */
export const createOrder = (body: {
  sellerHandle: string;
  itemId: number;
  qty: number;
  price: number;
}) => ordersPost<{ ok: true; order: PvpOrder }>("/orders", body);

/** M&A: offer to acquire another player's entire firm (full buyout). */
export const createBuyout = (sellerHandle: string, price: number) =>
  ordersPost<{ ok: true; order: PvpOrder }>("/orders", {
    kind: "buyout",
    sellerHandle,
    price,
  });

/** Act on an order: accept | decline | counter | withdraw (counter needs price). */
export const orderAction = (
  id: string,
  action: "accept" | "decline" | "counter" | "withdraw",
  price?: number,
) => ordersPost<{ ok: true }>(`/orders/${encodeURIComponent(id)}/action`, { action, price });

export const fetchCompanies = () =>
  get<{ entries: DirEntry[] }>("/companies").then((r) => r.entries);
export const fetchCompany = (handle: string) =>
  get<CompanySite>(`/companies/${encodeURIComponent(handle)}`);
export const fetchHouse = (handle: string) =>
  get<CompanySite>(`/houses/${encodeURIComponent(handle)}`);

/** Save the signed-in player's site config; returns the updated config + view. */
export async function saveSite(
  patch: Partial<SiteConfig>,
): Promise<{ site: SiteConfig; view: CompanySite } | { error: string; status: number }> {
  const token = getIdToken();
  if (!token) return { error: "unauthorized", status: 401 };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/site`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify(patch),
    });
  } catch {
    return { error: "network error", status: 0 };
  }
  if (!res.ok) {
    let msg = `failed (${res.status})`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* keep */
    }
    return { error: msg, status: res.status };
  }
  return res.json() as Promise<{ site: SiteConfig; view: CompanySite }>;
}

/** A factory-floor action against the shared world. Returns the player's fresh
 *  portfolio snapshot for overlay, or {error,status}. */
export type FactoryAction =
  | { action: "build"; itemId: number }
  | { action: "buy-property"; propId: number }
  | { action: "sell-property"; propId: number }
  | { action: "buy-stake"; company: string; pct: number }
  | { action: "sell-stake"; company: string; pct: number }
  | { action: "demolish"; factoryId: string }
  | { action: "module-add"; factoryId: string; moduleId: string }
  | { action: "module-remove"; factoryId: string; moduleId: string }
  | { action: "expand" }
  | { action: "route"; lineId: string; bay: number }
  | { action: "source"; lineId: string; inputItemId: number; feederId: string | null }
  | { action: "listprice"; itemId: number; mult: number }
  | { action: "listed"; itemId: number; on: boolean }
  | { action: "infra"; id: "power" | "router" | "qc" }
  | {
      action: "deskauto";
      patch: { specialist?: boolean; autoFulfill?: boolean; minMargin?: number };
    };

export async function factoryAction(
  body: FactoryAction,
): Promise<ApiPortfolio | { error: string; status: number }> {
  const token = getIdToken();
  if (!token) return { error: "unauthorized", status: 401 };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/factory`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify(body),
    });
  } catch {
    return { error: "network error", status: 0 };
  }
  if (!res.ok) {
    let msg = `failed (${res.status})`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* keep */
    }
    return { error: msg, status: res.status };
  }
  return res.json() as Promise<ApiPortfolio>;
}
export interface TradeResult {
  action: "buy" | "sell";
  itemId: number;
  qty: number;
  value: number;
  copyNo: number | null;
  cash: number;
  held: number;
}

async function get<T>(path: string, auth = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth) {
    const token = getIdToken();
    if (token) headers.authorization = token;
  }
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchWorld = () => get<ApiWorld>("/world");
export const fetchStandings = () =>
  get<{ standings: ApiStanding[] }>("/standings").then((r) => r.standings);
export const fetchPortfolio = () => get<ApiPortfolio>("/portfolio", true);

export interface DeskOrder {
  id: string;
  company: string;
  sector: string;
  itemId: number;
  itemName: string;
  brand: string;
  qty: number;
  /** The client's current visible offer (negotiate up from here). */
  companyOffer: number;
  /** Haggling rounds used / allowed. */
  round: number;
  maxRounds: number;
  /** Agreed payout once accepted (0 while negotiating). */
  quote: number;
  status: "offer" | "accepted";
  expiresAt: number;
  marketValue: number;
  held: number;
  /** Sandbox: you own a factory line that makes this exact item. */
  youProduce?: boolean;
}

/** The result of a negotiation action, relayed for a toast. */
export type NegotiationNote =
  | { kind: "deal"; price: number; company?: string }
  | { kind: "counter"; offer: number; overBudget: boolean; company?: string }
  | { kind: "pullout"; company?: string }
  | { kind: "invalid"; company?: string };

export interface Desk {
  name: string | null;
  reputation: number;
  cash: number;
  orders: DeskOrder[];
  /** Present only on a negotiation response. */
  note?: NegotiationNote;
}

export const fetchDesk = () => get<Desk>("/desk", true);

/** Returns the updated Desk, or {error,status} (401 → sign in). */
export async function deskAction(
  action: "name" | "accept" | "decline" | "fulfill" | "counter",
  payload: { orderId?: string; name?: string; bid?: number } = {},
): Promise<Desk | { error: string; status: number }> {
  const token = getIdToken();
  if (!token) return { error: "unauthorized", status: 401 };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/desk`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    return { error: "network error", status: 0 };
  }
  if (!res.ok) {
    let msg = `failed (${res.status})`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* keep */
    }
    return { error: msg, status: res.status };
  }
  return res.json() as Promise<Desk>;
}

/** Returns the trade outcome, or an {error} with the HTTP status for handling
 *  (401 → sign in, 409 → rejected e.g. sold out / insufficient funds). */
export async function postTrade(
  action: "buy" | "sell",
  id: number,
  qty = 1,
): Promise<TradeResult | { error: string; status: number }> {
  const token = getIdToken();
  if (!token) return { error: "unauthorized", status: 401 };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/trade`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify({ action, id, qty }),
    });
  } catch {
    return { error: "network error", status: 0 };
  }
  if (!res.ok) {
    let msg = `trade failed (${res.status})`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* keep default */
    }
    return { error: msg, status: res.status };
  }
  return res.json() as Promise<TradeResult>;
}
