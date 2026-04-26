import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";

export async function authRoutes(app: FastifyInstance) {
  /**
   * GET /auth/google — redirect to Google OAuth
   * No rate limit: this is a browser redirect, not an API endpoint.
   */
  app.get("/google", { config: { rateLimit: false } }, async (request, reply) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:3001/auth/google/callback";

    // Use URLSearchParams so encoding is always correct — manually placing %20
    // inside a template literal can cause double-encoding in some Fastify versions,
    // which makes Google silently ignore the prompt parameter and auto-select an account.
    const params = new URLSearchParams({
      client_id: clientId ?? "",
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account consent", // space-separated; URLSearchParams encodes correctly
      authuser: "-1",                   // Google-specific: -1 forces the account picker
                                        // regardless of existing browser sessions
      include_granted_scopes: "false",  // prevents silent scope accumulation
    });

    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  /**
   * GET /auth/google/callback — exchange code for tokens
   * No rate limit: Google redirects here once per login, never needs throttling.
   */
  app.get("/google/callback", { config: { rateLimit: false } }, async (request, reply) => {
    const { code } = request.query as { code?: string };
    if (!code) {
      return reply.status(400).send({ ok: false, error: { code: "MISSING_CODE", message: "No authorization code" } });
    }

    try {
      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID ?? "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          redirect_uri: process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:3001/auth/google/callback",
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

      // Find or create user
      const defaultOrgId = process.env.DEFAULT_ORG_ID ?? "00000000-0000-0000-0000-000000000001";

      let user = await prisma.user.findFirst({
        where: { email: { equals: userInfo.email, mode: "insensitive" }, orgId: defaultOrgId },
        include: { userRoles: true },
      });

      const frontendUrl = process.env.CORS_ORIGIN ?? "http://localhost:5173";

      if (!user) {
        // No pre-registered account — reject the sign-in.
        // Accounts must be created by an admin before someone can log in.
        return reply.redirect(
          `${frontendUrl}/not-registered?email=${encodeURIComponent(userInfo.email)}`
        );
      }

      if (!user.isActive) {
        // Account has been deactivated by an admin.
        return reply.redirect(
          `${frontendUrl}/not-registered?email=${encodeURIComponent(userInfo.email)}&reason=deactivated`
        );
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { idpSubject: userInfo.sub, lastLoginAt: new Date(), avatarUrl: userInfo.picture },
      });

      // Generate JWT
      const jwt = app.jwt.sign({
        sub: user.id,
        orgId: user.orgId,
        email: user.email,
        roles: user.userRoles.map((r) => r.role),
      });

      return reply.redirect(`${frontendUrl}/auth/callback?token=${jwt}`);
    } catch (error) {
      app.log.error(error, "OAuth callback failed");
      return reply.status(500).send({ ok: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } });
    }
  });

  /**
   * GET /auth/me — get current user profile
   */
  app.get("/me", async (request, reply) => {
    if (!request.currentUserId) {
      return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Not logged in" } });
    }

    const user = await prisma.user.findUnique({
      where: { id: request.currentUserId },
      include: {
        userRoles: true,
        employee: { include: { department: true, site: true } },
      },
    });

    if (!user) {
      return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "User not found" } });
    }

    return {
      ok: true,
      data: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        roles: user.userRoles.map((r) => r.role),
        employee: user.employee
          ? {
              id: user.employee.id,
              firstName: user.employee.firstName,
              lastName: user.employee.lastName,
              position: user.employee.position,
              department: user.employee.department?.name ?? null,
              site: user.employee.site.name,
              daysOff: user.employee.daysOff ?? [],
            }
          : null,
      },
    };
  });
}
