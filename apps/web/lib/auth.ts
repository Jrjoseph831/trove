/**
 * Minimal Cognito Hosted-UI auth for a static SPA. Uses the implicit grant: we
 * send the player to the Hosted UI, they return with #id_token=… in the URL
 * fragment, we stash it in localStorage. No secrets, no backend exchange.
 *
 * Browsing never calls any of this — only the Acquire/sell path does, so a
 * signed-out visitor can roam the whole floor and is prompted to sign in exactly
 * when they try to trade.
 */
import {
  AUTH_ENABLED,
  COGNITO_CLIENT_ID,
  COGNITO_DOMAIN,
  redirectUri,
} from "./config";

const TOKEN_KEY = "trove.idToken";

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

/** Pull an id_token out of the URL fragment after a Hosted-UI redirect, persist
 *  it, and clean the address bar. Call once on mount. Returns true if captured. */
export function captureTokenFromHash(): boolean {
  if (typeof window === "undefined" || !window.location.hash) return false;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("id_token");
  if (!token) return false;
  localStorage.setItem(TOKEN_KEY, token);
  // strip the fragment so the token isn't left in the URL
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return true;
}

/** The current id token if present and unexpired, else null. */
export function getIdToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  const payload = decode(token);
  if (!payload?.exp || payload.exp * 1000 < Date.now()) {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
  return token;
}

export function isSignedIn(): boolean {
  return getIdToken() !== null;
}

/** First 8 chars of the player's sub — matches the standings handle id. */
export function myShortId(): string | null {
  const token = getIdToken();
  const sub = token ? decode(token)?.sub : null;
  return typeof sub === "string" ? sub.slice(0, 8) : null;
}

/** Redirect to the Hosted UI to sign in / sign up. */
export function signIn(): void {
  if (!AUTH_ENABLED) return;
  const u = new URL(`${COGNITO_DOMAIN}/login`);
  u.searchParams.set("client_id", COGNITO_CLIENT_ID);
  u.searchParams.set("response_type", "token"); // implicit grant
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("redirect_uri", redirectUri());
  window.location.assign(u.toString());
}

/** Clear the local token and bounce through Cognito logout. */
export function signOut(): void {
  localStorage.removeItem(TOKEN_KEY);
  if (!AUTH_ENABLED) return;
  const u = new URL(`${COGNITO_DOMAIN}/logout`);
  u.searchParams.set("client_id", COGNITO_CLIENT_ID);
  u.searchParams.set("logout_uri", redirectUri());
  window.location.assign(u.toString());
}
