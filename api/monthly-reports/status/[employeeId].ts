import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware";
import { prisma } from "@orbs/db";
import type { AuthContext } from "../../../lib/auth";

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
    const employeeId = req.query.employeeId as string;
    const { month, year } = req.query as { month?: string; year?: string };
    const m = Number(month);
    const y = Number(year);
    if (!m || !y || m < 1 || m > 12 || y < 2020) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "month (1-12) and year required" } });
    }

    const { allowed, employee } = await canManageEmployee(ctx, employeeId);
    if (!allowed || !employee) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "You cannot access this employee's report" } });
    }

    const report = await prisma.monthlyReport.findUnique({
      where: {
        orgId_employeeId_month_year: {
          orgId: ctx.orgId,
          employeeId,
          month: m,
          year: y,
        },
      },
      include: {
        reviewer: { select: { displayName: true } },
      },
    });

    return {
      ok: true,
      data: report
        ? {
            id: report.id,
            status: report.status,
            submittedAt: report.submittedAt,
            reviewedAt: report.reviewedAt,
            reviewerName: report.reviewer?.displayName ?? null,
            reviewComment: report.reviewComment,
            lockedAt: report.lockedAt,
          }
        : {
            id: null,
            status: "DRAFT",
            submittedAt: null,
            reviewedAt: null,
            reviewerName: null,
            reviewComment: null,
            lockedAt: null,
          },
    };
  },
  { permission: "reports.review", methods: ["GET"] },
);
