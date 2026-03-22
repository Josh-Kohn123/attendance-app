import { prisma } from "@orbs/db";
import type { VercelRequest } from "@vercel/node";
import type { AuditAction } from "@orbs/shared";
import type { AuthContext } from "./auth.js";

export async function auditLog(
  req: VercelRequest,
  ctx: AuthContext,
  action: AuditAction,
  targetType?: string | null,
  targetId?: string | null,
  before?: unknown,
  after?: unknown,
) {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        userId: ctx.userId,
        action,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        before: before ? JSON.parse(JSON.stringify(before)) : null,
        after: after ? JSON.parse(JSON.stringify(after)) : null,
        ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0] ?? req.socket?.remoteAddress ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to write audit log", error);
  }
}
