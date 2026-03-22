import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";
import { AttendanceQuerySchema } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = AttendanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const { from, to, page, limit } = parsed.data;

    const employee = await prisma.employee.findFirst({
      where: { userId: ctx.userId, orgId: ctx.orgId },
    });
    if (!employee) {
      return res.status(404).json({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
    }

    const [events, total] = await Promise.all([
      prisma.attendanceEvent.findMany({
        where: {
          orgId: ctx.orgId,
          employeeId: employee.id,
          serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
        },
        orderBy: { serverTimestamp: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.attendanceEvent.count({
        where: {
          orgId: ctx.orgId,
          employeeId: employee.id,
          serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
        },
      }),
    ]);

    return {
      ok: true,
      data: {
        items: events,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  },
  { permission: "attendance.view_self", methods: ["GET"] }
);
