import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { BulkCalendarEntrySchema } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = BulkCalendarEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const { dates, status, siteId, source, notes } = parsed.data;

    const employee = await prisma.employee.findFirst({
      where: { userId: ctx.userId, orgId: ctx.orgId },
    });
    if (!employee) {
      return res.status(404).json({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
    }

    // Delete existing entries for these dates, then create new ones
    const events = await prisma.$transaction(async (tx) => {
      for (const date of dates) {
        const dayStart = new Date(`${date}T00:00:00Z`);
        const dayEnd = new Date(`${date}T23:59:59Z`);
        await tx.attendanceEvent.deleteMany({
          where: {
            employeeId: employee.id,
            serverTimestamp: { gte: dayStart, lte: dayEnd },
            eventType: "CLOCK_IN",
          },
        });
      }

      return Promise.all(
        dates.map((date) =>
          tx.attendanceEvent.create({
            data: {
              orgId: ctx.orgId,
              employeeId: employee.id,
              siteId,
              eventType: "CLOCK_IN",
              source: source ?? "MANUAL",
              serverTimestamp: new Date(`${date}T09:00:00Z`),
              createdByUserId: ctx.userId,
              requestId: crypto.randomUUID(),
              notes: status, // Store status in notes field
            },
          })
        )
      );
    });

    return { ok: true, data: events };
  },
  { permission: "attendance.clock_in", methods: ["POST"] }
);
