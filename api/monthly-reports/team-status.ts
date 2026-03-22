import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { month, year } = req.query as { month?: string; year?: string };
    const m = Number(month);
    const y = Number(year);
    if (!m || !y || m < 1 || m > 12 || y < 2020) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "month (1-12) and year required" } });
    }

    // Employees whose managerId points to the current user (their direct reports).
    // Admins see all employees; everyone else sees only their direct reports.
    let employees: any[];
    if (ctx.authzContext.roles.includes("admin")) {
      employees = await prisma.employee.findMany({
        where: { orgId: ctx.orgId, isActive: true },
        include: { department: { select: { name: true } } },
        orderBy: { lastName: "asc" },
      });
    } else {
      employees = await prisma.employee.findMany({
        where: { orgId: ctx.orgId, isActive: true, managerId: ctx.userId },
        include: { department: { select: { name: true } } },
        orderBy: { lastName: "asc" },
      });
    }

    // Also include the current user's own employee record (for self-approval)
    const selfEmp = await prisma.employee.findFirst({
      where: { userId: ctx.userId, orgId: ctx.orgId },
      include: { department: { select: { name: true } } },
    });

    const empMap = new Map(employees.map((e: any) => [e.id, e]));
    if (selfEmp && !empMap.has(selfEmp.id)) {
      empMap.set(selfEmp.id, selfEmp);
    }
    const allEmployees = Array.from(empMap.values());
    const empIds = allEmployees.map((e: any) => e.id);

    // Fetch monthly reports for this month
    const reports = await prisma.monthlyReport.findMany({
      where: {
        orgId: ctx.orgId,
        employeeId: { in: empIds },
        month: m,
        year: y,
      },
    });

    const reportByEmpId = new Map(reports.map((r: any) => [r.employeeId, r]));

    const items = allEmployees.map((emp: any) => {
      const report = reportByEmpId.get(emp.id);
      const isSelf = selfEmp && emp.id === selfEmp.id;
      return {
        employeeId: emp.id,
        employeeName: `${emp.firstName} ${emp.lastName}`,
        employeeEmail: emp.email,
        departmentName: emp.department?.name ?? null,
        requireSelfSubmit: emp.requireSelfSubmit,
        isSelf: !!isSelf,
        reportId: report?.id ?? null,
        status: report?.status ?? "DRAFT",
        submittedAt: report?.submittedAt ?? null,
        reviewedAt: report?.reviewedAt ?? null,
        reviewComment: report?.reviewComment ?? null,
      };
    });

    return { ok: true, data: items };
  },
  { permission: "reports.review", methods: ["GET"] },
);
