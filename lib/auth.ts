import jwt from "jsonwebtoken";
import { prisma } from "@orbs/db";
import type { AuthzContext } from "@orbs/authz";
import type { Role, ScopeType } from "@orbs/shared";

export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  roles: Role[];
  authzContext: AuthzContext;
}

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

export function signJwt(payload: { sub: string; orgId: string; email: string; roles: string[] }): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  });
}

export async function verifyAuth(authHeader: string | undefined): Promise<AuthContext | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as {
      sub: string;
      orgId: string;
      email: string;
      roles: string[];
    };

    const userScopes = await prisma.userScope.findMany({
      where: { userId: decoded.sub },
      select: { scopeType: true, scopeId: true },
    });

    const authzContext: AuthzContext = {
      userId: decoded.sub,
      orgId: decoded.orgId,
      roles: decoded.roles as Role[],
      scopes: userScopes.map((s) => ({
        scopeType: s.scopeType as ScopeType,
        scopeId: s.scopeId,
      })),
    };

    return {
      userId: decoded.sub,
      orgId: decoded.orgId,
      email: decoded.email,
      roles: decoded.roles as Role[],
      authzContext,
    };
  } catch {
    return null;
  }
}
