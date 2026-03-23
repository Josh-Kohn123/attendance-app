import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit.js";
import { MonthlyReportSubmitSchema, getReportingPeriod } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = MonthlyReportSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const { month, year } = parsed.data;

    const employee = await prisma.employee.findFirst({
      where: { userId: ctx.userId, orgId: ctx.orgId },
      include: {
        // managerId is the sole authority — no department fallback
        manager: { select: { id: true, email: true, displayName: true } },
      },
    });

    if (!employee) {
      return res.status(404).json({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
    }

    // Prevent submission before the reporting period has ended
    const org = await prisma.org.findUnique({ where: { id: ctx.orgId }, select: { monthStartDay: true } });
    const monthStartDay = org?.monthStartDay ?? 26;
    const { to: periodEnd } = getReportingPeriod(month, year, monthStartDay);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(periodEnd);
    endDate.setHours(0, 0, 0, 0);
    if (today <= endDate) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "PERIOD_NOT_ENDED",
          message: `Cannot submit before the reporting period ends (${periodEnd}). Please wait until the period has passed.`,
        },
      });
    }

    // The managerId field on the employee record is the single source of truth for all users,
    // regardless of role. If an employee/manager/admin has no manager assigned, they cannot submit.
    // If they are set as their own manager, their report lands in their own review queue (self-approval).
    const resolvedManager: { id: string; email: string; displayName: string } | null =
      (employee as any).manager ?? null;

    if (!resolvedManager) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "NO_MANAGER",
          message: "You do not have a manager assigned. Please contact admin.",
        },
      });
    }

    // Check if report exists and status allows submission
    const existing = await prisma.monthlyReport.findUnique({
      where: {
        orgId_employeeId_month_year: {
          orgId: ctx.orgId,
          employeeId: employee.id,
          month,
          year,
        },
      },
    });

    if (existing && !["DRAFT", "REJECTED"].includes(existing.status)) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_STATUS", message: `Cannot submit — report is already ${existing.status.toLowerCase()}` },
      });
    }

    // Upsert the report
    const report = await prisma.monthlyReport.upsert({
      where: {
        orgId_employeeId_month_year: {
          orgId: ctx.orgId,
          employeeId: employee.id,
          month,
          year,
        },
      },
      update: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedById: null,
        reviewComment: null,
      },
      create: {
        orgId: ctx.orgId,
        employeeId: employee.id,
        month,
        year,
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });

    await auditLog(req, ctx, "MONTHLY_REPORT_SUBMITTED", "monthly_report", report.id, null, { month, year, status: "SUBMITTED" });

    return { ok: true, data: report };
  },
  { permission: "reports.submit", methods: ["POST"] },
);
