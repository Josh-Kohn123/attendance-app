import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";
import { CorrectionSchema } from "@orbs/shared";
import { auditLog } from "../../lib/audit";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = CorrectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const { originalEventId, correctedDate, reason, requestId } = parsed.data;

    // Verify original event exists and belongs to org
    const original = await prisma.attendanceEvent.findUnique({ where: { id: originalEventId } });
    if (!original || original.orgId !== ctx.orgId) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Original event not found" } });
    }

    // Idempotency
    const existing = await prisma.attendanceEvent.findUnique({ where: { requestId } });
    if (existing) return { ok: true, data: existing };

    const correction = await prisma.attendanceEvent.create({
      data: {
        orgId: ctx.orgId,
        employeeId: original.employeeId,
        siteId: original.siteId,
        eventType: "CORRECTION_SUBMITTED",
        source: "MANUAL",
        previousEventId: originalEventId,
        createdByUserId: ctx.userId,
        requestId,
        notes: reason,
      },
    });

    await auditLog(req, ctx, "ATTENDANCE_CORRECTED", "attendance_event", correction.id, { originalEventId }, { correctionId: correction.id });

    return { ok: true, data: correction };
  },
  { permission: "attendance.correct", methods: ["POST"] }
);
