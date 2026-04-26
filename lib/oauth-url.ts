import type { VercelRequest } from "@vercel/node";

/**
 * Derives the public base URL for the current request.
 *
 * Why this is needed: Vercel gives every preview deployment its own URL
 * (e.g. `orbs-attendance-git-<branch>-<scope>.vercel.app`). Hardcoding
 * `GOOGLE_CALLBACK_URL` to a single value means OAuth only works on the
 * one branch the env var was set for. Reading the host from the request
 * lets the same code serve every preview, prod, and custom-domain alias.
 *
 * Each derived URL must still be added to the Google OAuth client's
 * "Authorized redirect URIs" — Google enforces strict matching there.
 */
export function getRequestBaseUrl(req: VercelRequest): string {
  const forwardedHost = req.headers["x-forwarded-host"];
  const host =
    (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ??
    req.headers.host ??
    "localhost:3001";
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function getOAuthCallbackUrl(req: VercelRequest): string {
  return `${getRequestBaseUrl(req)}/api/auth/google/callback`;
}
