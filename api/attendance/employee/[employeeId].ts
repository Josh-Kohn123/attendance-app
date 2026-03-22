import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { AttendanceQuerySchema } from "@orbs/shared";
import type { AuthContext } from "../../../lib/auth.js";

async function canManageEmployee(ctx: AuthContext, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: ctx.orgId, isActive: true },
    include: { department: { select: { name: true } } },
  });
  if (!employee) return { allowed: false as const, employee: null };
  if (ctx.authzContext.roles.includes("admin")) return { allowed: true as const, employee };
  if (ctx.authzContext.roles.includes("manager") && employee.managerId === ctx.userId) {
    return { allowed: true as const, employee };
  }
  return { allowed: false as const, employee: null };
}

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const employeeId = req.query.employeeId as string;

    const parsed = AttendanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const { allowed } = await canManageEmployee(ctx, employeeId);
    if (!allowed) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "You cannot access this employee's attendance" } });
    }

    const { from, to, page, limit } = parsed.data;

    const [events, total] = await Promise.all([
      prisma.attendanceEvent.findMany({
        where: {
          orgId: ctx.orgId,
          employeeId,
          serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
        },
        orderBy: { serverTimestamp: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.attendanceEvent.count({
        where: {
          orgId: ctx.orgId,
          employeeId,
          serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
        },
      }),
    ]);

    return { ok: true, data: { items: events, total, page, limit, totalPages: Math.ceil(total / limit) } };
  },
  { permission: "reports.review", methods: ["GET"] }
);
