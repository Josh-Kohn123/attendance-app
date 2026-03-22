import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware";
import { prisma } from "@orbs/db";
import { auditLog } from "../../../lib/audit";
import { MonthlyReportRejectSchema } from "@orbs/shared";
import { email } from "../../../apps/api/src/services/email.js";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const id = req.query.id as string;
    const parsed = MonthlyReportRejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

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
        error: { code: "INVALID_STATUS", message: `Cannot reject — report is ${report.status.toLowerCase()}, not submitted` },
      });
    }

    const updated = await prisma.monthlyReport.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewedById: ctx.userId,
        reviewComment: parsed.data.comment,
      },
    });

    // Notify employee via email
    const reviewer = await prisma.user.findUnique({ where: { id: ctx.userId } });
    if (report.employee && reviewer) {
      email.notifyMonthlyReportRejected({
        orgId: ctx.orgId,
        employeeEmail: report.employee.email,
        employeeName: `${report.employee.firstName} ${report.employee.lastName}`,
        month: report.month,
        year: report.year,
        reviewerName: reviewer.displayName,
        comment: parsed.data.comment,
      }).catch(() => {});
    }

    await auditLog(req, ctx, "MONTHLY_REPORT_REJECTED", "monthly_report", id, { status: "SUBMITTED" }, { status: "REJECTED", comment: parsed.data.comment });

    return { ok: true, data: updated };
  },
  { permission: "reports.review", methods: ["POST"] },
);
