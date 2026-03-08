import type { Permission, ScopeType } from "@orbs/shared";
import { hasPermission, canAccessResource, type AuthzContext } from "./engine.js";

/**
 * Fastify preHandler-compatible middleware factory for permission checks.
 * Expects `request.authzContext` to be set by the auth plugin.
 */
export function requirePermission(permission: Permission) {
  return async (request: any, reply: any) => {
    const ctx: AuthzContext | undefined = request.authzContext;
    if (!ctx) {
      return reply.status(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }

    if (!hasPermission(ctx, permission)) {
      return reply.status(403).send({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: `Missing permission: ${permission}`,
        },
      });
    }
  };
}

/**
 * Fastify preHandler-compatible middleware factory for scope checks.
 * Extracts the scope from request params or body.
 */
export function requireScope(scopeType: ScopeType, paramName: string = "siteId") {
  return async (request: any, reply: any) => {
    const ctx: AuthzContext | undefined = request.authzContext;
    if (!ctx) {
      return reply.status(401).send({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    }

    const scopeId =
      (request.params as any)?.[paramName] ||
      (request.body as any)?.[paramName] ||
      (request.query as any)?.[paramName];

    if (scopeId && !canAccessResource(ctx, { scopeType, scopeId })) {
      return reply.status(403).send({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: `Access denied to ${scopeType}: ${scopeId}`,
        },
      });
    }
  };
}
