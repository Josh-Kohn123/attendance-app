import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { CalendarEntrySchema } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    if (req.method === "POST") {
      const parsed = CalendarEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { date, status, siteId, source, requestId, notes } = parsed.data;

      const employee = await prisma.employee.findFirst({
        where: { userId: ctx.userId, orgId: ctx.orgId },
      });
      if (!employee) {
        return res.status(404).json({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
      }

      // Idempotency
      const existing = await prisma.attendanceEvent.findUnique({ where: { requestId } });
      if (existing) return { ok: true, data: existing };

      // Upsert: delete any existing event for this employee+date, then create new one
      const dayStart = new Date(`${date}T00:00:00Z`);
      const dayEnd = new Date(`${date}T23:59:59Z`);
      await prisma.attendanceEvent.deleteMany({
        where: {
          employeeId: employee.id,
          serverTimestamp: { gte: dayStart, lte: dayEnd },
          eventType: "CLOCK_IN",
        },
      });

      const event = await prisma.attendanceEvent.create({
        data: {
          orgId: ctx.orgId,
          employeeId: employee.id,
          siteId,
          eventType: "CLOCK_IN",
          source,
          serverTimestamp: new Date(`${date}T09:00:00Z`),
          createdByUserId: ctx.userId,
          requestId,
          notes: status, // Store status in notes field for now (clean migration later)
        },
      });

      return { ok: true, data: event };
    } else if (req.method === "DELETE") {
      const { date } = req.query as { date?: string };
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date as string)) {
        return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "date query param required (YYYY-MM-DD)" } });
      }

      const employee = await prisma.employee.findFirst({
        where: { userId: ctx.userId, orgId: ctx.orgId },
      });
      if (!employee) {
        return res.status(404).json({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
      }

      const dayStart = new Date(`${date}T00:00:00Z`);
      const dayEnd = new Date(`${date}T23:59:59Z`);
      await prisma.attendanceEvent.deleteMany({
        where: {
          employeeId: employee.id,
          serverTimestamp: { gte: dayStart, lte: dayEnd },
          eventType: "CLOCK_IN",
        },
      });

      return { ok: true };
    }
  },
  { permission: "attendance.clock_in", methods: ["POST", "DELETE"] }
);
