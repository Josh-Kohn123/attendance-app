import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../../lib/audit.js";
import { email } from "../../../apps/api/src/services/email.js";

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

    if (report.status !== "APPROVED") {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_STATUS", message: `Cannot revert — report is ${report.status.toLowerCase()}, not approved` },
      });
    }

    const autoComment = "Admin reopened your report for revisions";

    const updated = await prisma.monthlyReport.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewComment: autoComment,
        reviewedAt: null,
        reviewedById: null,
        lockedAt: null,
      },
    });

    const reviewer = await prisma.user.findUnique({ where: { id: ctx.userId } });
    if (report.employee && reviewer) {
      email.notifyMonthlyReportRejected({
        orgId: ctx.orgId,
        employeeEmail: report.employee.email,
        employeeName: `${report.employee.firstName} ${report.employee.lastName}`,
        month: report.month,
        year: report.year,
        reviewerName: reviewer.displayName,
        comment: autoComment,
      }).catch(() => {});
    }

    await auditLog(
      req,
      ctx,
      "MONTHLY_REPORT_APPROVAL_REVERTED",
      "monthly_report",
      id,
      { status: "APPROVED" },
      { status: "REJECTED", comment: autoComment },
    );

    return { ok: true, data: updated };
  },
  { permission: "reports.review", methods: ["POST"] },
);
