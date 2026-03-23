import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth, type AuthContext } from "./auth.js";
import { hasPermission } from "@orbs/authz";
import type { Permission } from "@orbs/shared";

type Handler = (req: VercelRequest, res: VercelResponse, ctx: AuthContext) => Promise<any>;
type PublicHandler = (req: VercelRequest, res: VercelResponse, ctx: AuthContext | null) => Promise<any>;

interface AuthOptions {
  permission?: Permission;
  methods?: string[];
}

function handleCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function withAuth(handler: Handler, options: AuthOptions = {}) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (handleCors(req, res)) return;

    if (options.methods && !options.methods.includes(req.method!)) {
      return res.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: `${req.method} not allowed` } });
    }

    try {
      const ctx = await verifyAuth(req.headers.authorization);
      if (!ctx) {
        return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
      }

      if (options.permission) {
        const allowed = hasPermission(ctx.authzContext, options.permission);
        console.log("[AUTH DEBUG]", JSON.stringify({
          permission: options.permission,
          roles: ctx.authzContext.roles,
          allowed,
          url: req.url,
        }));
        if (!allowed) {
          return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: `Missing permission: ${options.permission}` } });
        }
      }

      const result = await handler(req, res, ctx);
      if (result !== undefined && !res.writableEnded) {
        res.status(200).json(result);
      }
    } catch (error) {
      console.error("[API Error]", error);
      if (!res.writableEnded) {
        res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
      }
    }
  };
}

export function withPublic(handler: PublicHandler, options: { methods?: string[] } = {}) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (handleCors(req, res)) return;

    if (options.methods && !options.methods.includes(req.method!)) {
      return res.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: `${req.method} not allowed` } });
    }

    try {
      const ctx = await verifyAuth(req.headers.authorization);
      const result = await handler(req, res, ctx);
      if (result !== undefined && !res.writableEnded) {
        res.status(200).json(result);
      }
    } catch (error) {
      console.error("[API Error]", error);
      if (!res.writableEnded) {
        res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
      }
    }
  };
}
