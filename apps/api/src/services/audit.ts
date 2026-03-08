import { prisma } from "@orbs/db";
import type { FastifyRequest } from "fastify";
import type { AuditAction } from "@orbs/shared";

/**
 * Append an entry to the audit log.
 * This is append-only — audit entries are never updated or deleted.
 */
export async function auditLog(
  request: FastifyRequest,
  action: AuditAction,
  targetType?: string | null,
  targetId?: string | null,
  before?: unknown,
  after?: unknown
) {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: request.currentOrgId!,
        userId: request.currentUserId!,
        action,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        before: before ? JSON.parse(JSON.stringify(before)) : null,
        after: after ? JSON.parse(JSON.stringify(after)) : null,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      },
    });
  } catch (error) {
    // Audit logging should never break the main flow
    request.log.error(error, "Failed to write audit log");
  }
}
