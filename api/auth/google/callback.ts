import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "@orbs/db";
import { signJwt } from "../../../lib/auth.js";
import { getOAuthCallbackUrl, getRequestBaseUrl } from "../../../lib/oauth-url.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = req.query.code as string | undefined;
  if (!code) {
    return res.status(400).json({ ok: false, error: { code: "MISSING_CODE", message: "No authorization code" } });
  }

  try {
    // Exchange code for tokens. The redirect_uri here MUST match the one
    // sent in the initial /api/auth/google redirect, or Google rejects the
    // token exchange — so both endpoints derive it from the same helper.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: getOAuthCallbackUrl(req),
        grant_type: "authorization_code",
      }),
    });

    const tokens = (await tokenRes.json()) as { access_token: string; id_token: string };

    // Get user info
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = (await userInfoRes.json()) as {
      sub: string;
      email: string;
      name: string;
      picture: string;
    };

    const defaultOrgId = process.env.DEFAULT_ORG_ID ?? "00000000-0000-0000-0000-000000000001";
    // Frontend lives on the same host as the API in Vercel deployments,
    // so derive it from the request rather than a fixed env var. This
    // matches the same per-deployment URL used for the OAuth callback.
    const frontendUrl = getRequestBaseUrl(req);

    let user = await prisma.user.findFirst({
      where: { email: { equals: userInfo.email, mode: "insensitive" }, orgId: defaultOrgId },
      include: { userRoles: true },
    });

    if (!user) {
      return res.redirect(302, `${frontendUrl}/not-registered?email=${encodeURIComponent(userInfo.email)}`);
    }

    if (!user.isActive) {
      return res.redirect(302, `${frontendUrl}/not-registered?email=${encodeURIComponent(userInfo.email)}&reason=deactivated`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { idpSubject: userInfo.sub, lastLoginAt: new Date(), avatarUrl: userInfo.picture },
    });

    const jwt = signJwt({
      sub: user.id,
      orgId: user.orgId,
      email: user.email,
      roles: user.userRoles.map((r) => r.role),
    });

    res.redirect(302, `${frontendUrl}/auth/callback?token=${jwt}`);
  } catch (error) {
    console.error("OAuth callback failed", error);
    res.status(500).json({ ok: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } });
  }
}
