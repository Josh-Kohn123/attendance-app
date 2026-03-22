import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";
import { MonthlyReportQuerySchema } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = MonthlyReportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const { status, page, limit } = parsed.data;

    // Look up the current user's own employee record (needed for self-approval inclusion)
    const selfEmployee = await prisma.employee.findFirst({
      where: { userId: ctx.userId, orgId: ctx.orgId },
      select: { id: true },
    });

    // Build the list of employee IDs whose reports this user can review.
    // Rule: an employee's reports go to whoever is set as their managerId.
    let reviewableEmpIds: string[];
    if (ctx.authzContext.roles.includes("admin")) {
      // Admins review everyone
      reviewableEmpIds = (
        await prisma.employee.findMany({
          where: { orgId: ctx.orgId },
          select: { id: true },
        })
      ).map((e: any) => e.id);
    } else {
      // Non-admins: see employees whose managerId points to the current user
      reviewableEmpIds = (
        await prisma.employee.findMany({
          where: { orgId: ctx.orgId, managerId: ctx.userId },
          select: { id: true },
        })
      ).map((e: any) => e.id);
    }

    // Always include the current user's own employee record so self-managing users
    // can approve their own report
    const empIds = selfEmployee
      ? [...new Set([...reviewableEmpIds, selfEmployee.id])]
      : reviewableEmpIds;

    if (empIds.length === 0) {
      return { ok: true, data: { items: [], total: 0, page, limit, totalPages: 0 } };
    }

    const where: any = {
      orgId: ctx.orgId,
      employeeId: { in: empIds },
      status: status ?? "SUBMITTED",
    };

    const [reports, total] = await Promise.all([
      prisma.monthlyReport.findMany({
        where,
        include: {
          employee: {
            select: { firstName: true, lastName: true, email: true, departmentId: true },
            include: { department: { select: { name: true } } } as any,
          },
        },
        orderBy: { submittedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.monthlyReport.count({ where }),
    ]);

    const items = reports.map((r: any) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      employeeEmail: r.employee.email,
      departmentName: r.employee.department?.name ?? null,
      month: r.month,
      year: r.year,
      status: r.status,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      reviewComment: r.reviewComment,
    }));

    return { ok: true, data: { items, total, page, limit, totalPages: Math.ceil(total / limit) } };
  },
  { permission: "reports.review", methods: ["GET"] },
);
