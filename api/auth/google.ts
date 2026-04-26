import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getOAuthCallbackUrl } from "../../lib/oauth-url.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const callbackUrl = getOAuthCallbackUrl(req);

  const params = new URLSearchParams({
    client_id: clientId ?? "",
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account consent",
    authuser: "-1",
    include_granted_scopes: "false",
  });

  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
