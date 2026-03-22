import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../../lib/middleware";
import { prisma } from "@orbs/db";
import { BulkCalendarEntrySchema } from "@orbs/shared";
import type { AuthContext } from "../../../../lib/auth";

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

    const parsed = BulkCalendarEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const { allowed, employee } = await canManageEmployee(ctx, employeeId);
    if (!allowed || !employee) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "You cannot edit this employee's attendance" } });
    }

    const { dates, status, siteId, source } = parsed.data;

    const events = await prisma.$transaction(async (tx) => {
      for (const date of dates) {
        const dayStart = new Date(`${date}T00:00:00Z`);
        const dayEnd = new Date(`${date}T23:59:59Z`);
        await tx.attendanceEvent.deleteMany({
          where: {
            employeeId,
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
              employeeId,
              siteId,
              eventType: "CLOCK_IN",
              source: source ?? "MANUAL",
              serverTimestamp: new Date(`${date}T09:00:00Z`),
              createdByUserId: ctx.userId,
              requestId: crypto.randomUUID(),
              notes: status,
            },
          })
        )
      );
    });

    return { ok: true, data: events };
  },
  { permission: "reports.review", methods: ["POST"] }
);
