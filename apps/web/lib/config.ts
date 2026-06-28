/**
 * Public runtime config for the shared world. All values are non-secret (an API
 * URL, a Cognito pool/client id, the Hosted-UI domain) and are baked at build
 * time. Defaults point at the deployed stack; override with NEXT_PUBLIC_* env
 * vars if you stand up your own.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_TROVE_API ??
  "https://gxk49f7clg.execute-api.us-east-1.amazonaws.com";

/** True when pointed at the isolated staging world (beta.trove.ceo) — gates the
 *  staging-only dev tools. Prod uses the default API, so this is false there. */
export const IS_STAGING = API_BASE.includes("x5p7r5nsh4");

/** Cognito Hosted-UI domain (no trailing slash). */
export const COGNITO_DOMAIN =
  process.env.NEXT_PUBLIC_COGNITO_DOMAIN ??
  "https://trove-243413538293.auth.us-east-1.amazoncognito.com";

/** Cognito app client id (public SPA client). */
export const COGNITO_CLIENT_ID =
  process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "70stuln68g90umttvrfk1k84kk";

/** Whether sign-in is wired up (Cognito values present). */
export const AUTH_ENABLED = Boolean(COGNITO_DOMAIN && COGNITO_CLIENT_ID);

/** Sandbox is a dev/tuning lab, not a player feature — only available locally,
 *  hidden on the public site. (Evaluated client-side; the Rail renders post-mount.) */
export function sandboxEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_SANDBOX === "1") return true;
  if (typeof window === "undefined") return false;
  return /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
}

/** The OAuth redirect target — this app's own origin + base path. */
export function redirectUri(): string {
  if (typeof window === "undefined") return "";
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${window.location.origin}${base}/`;
}
