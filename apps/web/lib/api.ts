/**
 * Client for the shared-world API. Reads (/world, /standings) are anonymous;
 * writes (/trade) and the player's own view (/portfolio) carry the Cognito id
 * token.
 */
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
