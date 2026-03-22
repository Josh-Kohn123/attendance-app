import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit.js";
import type { AuthContext } from "../../lib/auth.js";

async function canManageEmployee(ctx: AuthContext, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: ctx.orgId, isActive: true },
    include: {
      manager: { select: { id: true, email: true, displayName: true } },
      department: { select: { name: true } },
    },
  });
  if (!employee) return { allowed: false as const, employee: null };
  if (ctx.authzContext.roles.includes("admin")) return { allowed: true as const, employee };
  if (ctx.authzContext.roles.includes("manager") && employee.managerId === ctx.userId) return { allowed: true as const, employee };
  return { allowed: false as const, employee: null };
}

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const body = req.body as { employeeId?: string; month?: number; year?: number };
    const employeeId = body.employeeId;
    const month = body.month;
    const year = body.year;

    if (!employeeId || !month || !year || month < 1 || month > 12 || year < 2020) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "employeeId, month (1-12) and year required" } });
    }

    const { allowed, employee } = await canManageEmployee(ctx, employeeId);
    if (!allowed || !employee) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "You cannot submit reports for this employee" } });
    }

    // Block proxy submission for employees who must submit themselves
    if (employee.requireSelfSubmit) {
      return res.status(403).json({
        ok: false,
        error: { code: "SELF_SUBMIT_REQUIRED", message: "This employee must submit their own report" },
      });
    }

    // Check current report status
    const existing = await prisma.monthlyReport.findUnique({
      where: {
        orgId_employeeId_month_year: {
          orgId: ctx.orgId,
          employeeId,
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

    // Upsert the report as SUBMITTED
    const report = await prisma.monthlyReport.upsert({
      where: {
        orgId_employeeId_month_year: {
          orgId: ctx.orgId,
          employeeId,
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
        employeeId,
        month,
        year,
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });

    await auditLog(
      req,
      ctx,
      "MONTHLY_REPORT_SUBMITTED",
      "monthly_report",
      report.id,
      null,
      { month, year, status: "SUBMITTED", submittedByProxy: true, onBehalfOf: employeeId },
    );

    return { ok: true, data: report };
  },
  { permission: "reports.review", methods: ["POST"] },
);
