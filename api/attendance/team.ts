import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { AttendanceQuerySchema } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = AttendanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const { from, to, page, limit, departmentId, siteId } = parsed.data;

    // Build scope filter — managers see only their scoped departments/sites
    const scopedDeptIds = ctx.authzContext.scopes
      .filter((s) => s.scopeType === "department")
      .map((s) => s.scopeId);
    const scopedSiteIds = ctx.authzContext.scopes
      .filter((s) => s.scopeType === "site")
      .map((s) => s.scopeId);

    // Get employees in scope
    const employeeWhere: any = { orgId: ctx.orgId };
    if (departmentId) {
      employeeWhere.departmentId = departmentId;
    } else if (scopedDeptIds.length > 0) {
      employeeWhere.departmentId = { in: scopedDeptIds };
    }
    if (siteId) {
      employeeWhere.siteId = siteId;
    } else if (scopedSiteIds.length > 0) {
      employeeWhere.siteId = { in: scopedSiteIds };
    }

    const employees = await prisma.employee.findMany({
      where: employeeWhere,
      select: { id: true, firstName: true, lastName: true },
    });
    const empIds = employees.map((e) => e.id);

    const [events, total] = await Promise.all([
      prisma.attendanceEvent.findMany({
        where: {
          orgId: ctx.orgId,
          employeeId: { in: empIds },
          serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
        },
        include: { employee: { select: { firstName: true, lastName: true } } },
        orderBy: { serverTimestamp: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.attendanceEvent.count({
        where: {
          orgId: ctx.orgId,
          employeeId: { in: empIds },
          serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
        },
      }),
    ]);

    return { ok: true, data: { items: events, total, page, limit, totalPages: Math.ceil(total / limit) } };
  },
  { permission: "attendance.view_team", methods: ["GET"] }
);
