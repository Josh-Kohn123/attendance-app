import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware";
import { prisma } from "@orbs/db";
import { auditLog } from "../../../lib/audit";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const id = req.query.id as string;

    const report = await prisma.monthlyReport.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!report || report.orgId !== ctx.orgId) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Report not found" } });
    }

    if (report.status !== "SUBMITTED") {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_STATUS", message: `Cannot approve — report is ${report.status.toLowerCase()}, not submitted` },
      });
    }

    const updated = await prisma.monthlyReport.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewedById: ctx.userId,
        lockedAt: new Date(),
      },
    });

    await auditLog(req, ctx, "MONTHLY_REPORT_APPROVED", "monthly_report", id, { status: "SUBMITTED" }, { status: "APPROVED" });

    return { ok: true, data: updated };
  },
  { permission: "reports.review", methods: ["POST"] },
);
