import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { CalendarEntrySchema } from "@orbs/shared";
import type { AuthContext } from "../../../../lib/auth.js";

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

    if (req.method === "POST") {
      const parsed = CalendarEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { allowed, employee } = await canManageEmployee(ctx, employeeId);
      if (!allowed || !employee) {
        return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "You cannot edit this employee's attendance" } });
      }

      const { date, status, siteId, source, requestId } = parsed.data;

      // Idempotency
      const existing = await prisma.attendanceEvent.findUnique({ where: { requestId } });
      if (existing) return { ok: true, data: existing };

      // Upsert: delete existing for this employee+date, then create
      const dayStart = new Date(`${date}T00:00:00Z`);
      const dayEnd = new Date(`${date}T23:59:59Z`);
      await prisma.attendanceEvent.deleteMany({
        where: {
          employeeId,
          serverTimestamp: { gte: dayStart, lte: dayEnd },
          eventType: "CLOCK_IN",
        },
      });

      const event = await prisma.attendanceEvent.create({
        data: {
          orgId: ctx.orgId,
          employeeId,
          siteId,
          eventType: "CLOCK_IN",
          source,
          serverTimestamp: new Date(`${date}T09:00:00Z`),
          createdByUserId: ctx.userId,
          requestId,
          notes: status,
        },
      });

      return { ok: true, data: event };
    } else if (req.method === "DELETE") {
      const { date } = req.query as { date?: string };
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date as string)) {
        return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "date query param required (YYYY-MM-DD)" } });
      }

      const { allowed } = await canManageEmployee(ctx, employeeId);
      if (!allowed) {
        return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "You cannot edit this employee's attendance" } });
      }

      const dayStart = new Date(`${date}T00:00:00Z`);
      const dayEnd = new Date(`${date}T23:59:59Z`);
      await prisma.attendanceEvent.deleteMany({
        where: {
          employeeId,
          serverTimestamp: { gte: dayStart, lte: dayEnd },
          eventType: "CLOCK_IN",
        },
      });

      return { ok: true };
    }
  },
  { permission: "reports.review", methods: ["POST", "DELETE"] }
);
