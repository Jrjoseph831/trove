/**
 * Public runtime config for the shared world. All values are non-secret (an API
 * URL, a Cognito pool/client id, the Hosted-UI domain) and are baked at build
 * time. Defaults point at the deployed stack; override with NEXT_PUBLIC_* env
 * vars if you stand up your own.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_TROVE_API ??
  "https://gxk49f7clg.execute-api.us-east-1.amazonaws.com";

/** Cognito Hosted-UI domain (no trailing slash). */
export const COGNITO_DOMAIN =
  process.env.NEXT_PUBLIC_COGNITO_DOMAIN ??
  "https://trove-243413538293.auth.us-east-1.amazoncognito.com";

/** Cognito app client id (public SPA client). */
export const COGNITO_CLIENT_ID =
  process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "70stuln68g90umttvrfk1k84kk";

/** Whether sign-in is wired up (Cognito values present). */
export const AUTH_ENABLED = Boolean(COGNITO_DOMAIN && COGNITO_CLIENT_ID);

/** The OAuth redirect target — this app's own origin + base path. */
export function redirectUri(): string {
  if (typeof window === "undefined") return "";
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${window.location.origin}${base}/`;
}
