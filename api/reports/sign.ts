import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit.js";
import { ReportSignSchema } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = ReportSignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const lock = await prisma.reportLock.findUnique({ where: { id: parsed.data.reportLockId } });
    if (!lock || lock.orgId !== ctx.orgId) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Report lock not found" } });
    }

    const signature = await prisma.reportSignature.create({
      data: {
        reportLockId: lock.id,
        signedById: ctx.userId,
        signatureData: parsed.data.signatureData,
      },
    });

    await auditLog(req, ctx, "REPORT_SIGNED", "report_signature", signature.id);

    return { ok: true, data: signature };
  },
  { permission: "reports.sign", methods: ["POST"] },
);
