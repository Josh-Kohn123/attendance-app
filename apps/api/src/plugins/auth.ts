import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@orbs/db";
import type { AuthzContext } from "@orbs/authz";
import type { Role, ScopeType } from "@orbs/shared";

// Extend Fastify request with authz context
declare module "fastify" {
  interface FastifyRequest {
    authzContext?: AuthzContext;
    currentUserId?: string;
    currentOrgId?: string;
  }
}

async function authPluginImpl(app: FastifyInstance) {
  app.decorateRequest("authzContext", undefined);
  app.decorateRequest("currentUserId", undefined);
  app.decorateRequest("currentOrgId", undefined);

  app.addHook("onRequest", async (request: FastifyRequest) => {
    // Skip auth for public routes
    const publicPaths = ["/health", "/auth/google", "/auth/google/callback"];
    if (publicPaths.some((p) => request.url.startsWith(p))) return;

    try {
      const decoded = await request.jwtVerify<{
        sub: string;
        orgId: string;
        email: string;
        roles: string[];
      }>();

      request.currentUserId = decoded.sub;
      request.currentOrgId = decoded.orgId;

      // Load user scopes from DB
      const userScopes = await prisma.userScope.findMany({
        where: { userId: decoded.sub },
        select: { scopeType: true, scopeId: true },
      });

      request.authzContext = {
        userId: decoded.sub,
        orgId: decoded.orgId,
        roles: decoded.roles as Role[],
        scopes: userScopes.map((s) => ({
          scopeType: s.scopeType as ScopeType,
          scopeId: s.scopeId,
        })),
      };
    } catch {
      // No valid token — request.authzContext stays undefined
      // Individual routes decide if auth is required
    }
  });
}

export const authPlugin = fp(authPluginImpl, { name: "auth-plugin" });
