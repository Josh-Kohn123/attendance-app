import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { from, to } = req.query as { from: string; to: string };
    if (!from || !to) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "from and to required" } });
    }

    const departments = await prisma.department.findMany({
      where: { orgId: ctx.orgId },
      include: { employees: { where: { isActive: true } } },
    });

    const allEmpIds = departments.flatMap((d) => d.employees.map((e) => e.id));
    const events = await prisma.attendanceEvent.findMany({
      where: {
        orgId: ctx.orgId,
        employeeId: { in: allEmpIds },
        eventType: "CLOCK_IN",
        serverTimestamp: { gte: new Date(from as string), lte: new Date(`${to}T23:59:59Z`) },
      },
    });

    const eventsByEmp = new Map<string, number>();
    for (const e of events) {
      eventsByEmp.set(e.employeeId, (eventsByEmp.get(e.employeeId) ?? 0) + 1);
    }

    const summary = departments.map((dept) => ({
      departmentId: dept.id,
      departmentName: dept.name,
      employeeCount: dept.employees.length,
      totalAttendanceDays: dept.employees.reduce((sum, emp) => sum + (eventsByEmp.get(emp.id) ?? 0), 0),
    }));

    return { ok: true, data: summary };
  },
  { permission: "reports.view_all", methods: ["GET"] },
);
