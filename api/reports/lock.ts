import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit";
import { ReportLockSchema } from "@orbs/shared";
import { email } from "../../apps/api/src/services/email.js";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = ReportLockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const lock = await prisma.reportLock.create({
      data: {
        orgId: ctx.orgId,
        month: parsed.data.month,
        year: parsed.data.year,
        siteId: parsed.data.siteId,
        departmentId: parsed.data.departmentId,
        lockedById: ctx.userId,
      },
    });

    await auditLog(req, ctx, "REPORT_LOCKED", "report_lock", lock.id);

    const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
    email.notifyReportAction({
      orgId: ctx.orgId,
      recipientEmail: user?.email ?? "",
      action: "locked",
      period: `${parsed.data.month}/${parsed.data.year}`,
      actorName: user?.displayName ?? "Unknown",
    }).catch(() => {});

    return { ok: true, data: lock };
  },
  { permission: "reports.lock", methods: ["POST"] },
);
