/**
 * Cognito Hosted-UI auth for a static SPA, using the Authorization Code grant
 * with PKCE (public client, no secret). Unlike the old implicit grant, this
 * returns a REFRESH TOKEN, so we can silently renew the 1-hour id token for as
 * long as the refresh token is valid (~30 days) — the player stays signed in
 * across refreshes and days instead of being kicked out every hour.
 *
 * Browsing never calls any of this — only the Acquire/sell path does.
 */
import {
  AUTH_ENABLED,
  COGNITO_CLIENT_ID,
  COGNITO_DOMAIN,
  redirectUri,
} from "./config";

const ID_KEY = "trove.idToken";
const RT_KEY = "trove.refreshToken";
const PKCE_KEY = "trove.pkceVerifier";

interface JwtPayload {
  exp?: number;
  sub?: string;
  [k: string]: unknown;
}

function decode(token: string): JwtPayload | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomVerifier(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return b64url(a);
}
async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return b64url(new Uint8Array(digest));
}

// ── Token reads (sync — API calls use these) ─────────────────────────────────
/** The current id token if present and unexpired, else null. Renewal is handled
 *  separately by refreshIfNeeded(), so we never quietly drop the refresh token. */
export function getIdToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(ID_KEY);
  if (!token) return null;
  const p = decode(token);
  if (!p?.exp || p.exp * 1000 < Date.now()) return null;
  return token;
}

function hasRefresh(): boolean {
  return typeof window !== "undefined" && !!localStorage.getItem(RT_KEY);
}

/** Signed in if we hold a valid id token OR a refresh token that can mint one. */
export function isSignedIn(): boolean {
  return getIdToken() !== null || hasRefresh();
}

/** First 8 chars of the player's sub — matches the standings handle id. */
export function myShortId(): string | null {
  const token = typeof window !== "undefined" ? localStorage.getItem(ID_KEY) : null;
  const sub = token ? decode(token)?.sub : null;
  return typeof sub === "string" ? sub.slice(0, 8) : null;
}

// ── Token exchange + refresh (async) ─────────────────────────────────────────
async function tokenRequest(body: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    if (!res.ok) return false;
    const t = (await res.json()) as {
      id_token?: string;
      refresh_token?: string;
    };
    if (t.id_token) localStorage.setItem(ID_KEY, t.id_token);
    if (t.refresh_token) localStorage.setItem(RT_KEY, t.refresh_token);
    return !!t.id_token;
  } catch {
    return false;
  }
}

/** On return from the Hosted UI (?code=…), exchange the code for tokens, persist
 *  them, and clean the address bar. Returns true if a code was handled. */
export async function captureTokenFromQuery(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return false;
  const verifier = sessionStorage.getItem(PKCE_KEY) ?? "";
  sessionStorage.removeItem(PKCE_KEY);
  await tokenRequest({
    grant_type: "authorization_code",
    client_id: COGNITO_CLIENT_ID,
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return true;
}

/** Renew the id token from the refresh token. Clears tokens if the refresh token
 *  itself is dead (then the user is genuinely signed out).
 *
 *  Single-flight: with refresh-token ROTATION enabled server-side, each refresh
 *  consumes the current refresh token and returns a new one. If two callers (the
 *  timer + a tab-focus, say) refreshed at once they'd race to spend the same
 *  token and orphan one of the rotated results — so concurrent calls share one
 *  in-flight request. */
let inFlight: Promise<boolean> | null = null;
async function refreshTokens(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const rt = localStorage.getItem(RT_KEY);
    if (!rt) return false;
    const ok = await tokenRequest({
      grant_type: "refresh_token",
      client_id: COGNITO_CLIENT_ID,
      refresh_token: rt,
    });
    if (!ok) {
      localStorage.removeItem(ID_KEY);
      localStorage.removeItem(RT_KEY);
    }
    return ok;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Refresh if the id token is missing/expired/within 5 min of expiry and we have
 *  a refresh token. Safe to call often (load, on a timer, on tab focus). */
export async function refreshIfNeeded(): Promise<void> {
  if (typeof window === "undefined") return;
  const id = localStorage.getItem(ID_KEY);
  const exp = id ? (decode(id)?.exp ?? 0) * 1000 : 0;
  if (exp - Date.now() < 5 * 60 * 1000 && localStorage.getItem(RT_KEY)) {
    await refreshTokens();
  }
}

// ── Redirects ────────────────────────────────────────────────────────────────
/** Send the player to the Hosted UI (code grant + PKCE) to sign in / sign up. */
export async function signIn(): Promise<void> {
  if (!AUTH_ENABLED || typeof window === "undefined") return;
  const verifier = randomVerifier();
  sessionStorage.setItem(PKCE_KEY, verifier);
  const challenge = await challengeOf(verifier);
  const u = new URL(`${COGNITO_DOMAIN}/login`);
  u.searchParams.set("client_id", COGNITO_CLIENT_ID);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  window.location.assign(u.toString());
}

/** Clear local tokens and bounce through Cognito logout. Best-effort revokes the
 *  refresh token server-side first (keepalive so it survives the redirect), so a
 *  signed-out token can't be reused even if it leaked. */
export function signOut(): void {
  if (typeof window !== "undefined") {
    const rt = localStorage.getItem(RT_KEY);
    if (rt && AUTH_ENABLED) {
      void fetch(`${COGNITO_DOMAIN}/oauth2/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: rt, client_id: COGNITO_CLIENT_ID }),
        keepalive: true,
      }).catch(() => {});
    }
    localStorage.removeItem(ID_KEY);
    localStorage.removeItem(RT_KEY);
  }
  if (!AUTH_ENABLED) return;
  const u = new URL(`${COGNITO_DOMAIN}/logout`);
  u.searchParams.set("client_id", COGNITO_CLIENT_ID);
  u.searchParams.set("logout_uri", redirectUri());
  window.location.assign(u.toString());
}
