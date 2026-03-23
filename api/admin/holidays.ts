import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit.js";
import { CreateHolidaySchema } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    if (req.method === "GET") {
      const holidays = await prisma.holiday.findMany({
        where: { orgId: ctx.orgId },
        orderBy: { date: "asc" },
      });
      return { ok: true, data: holidays };
    } else if (req.method === "POST") {
      const parsed = CreateHolidaySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const holiday = await prisma.holiday.create({
        data: {
          orgId: ctx.orgId,
          name: parsed.data.name,
          date: new Date(parsed.data.date),
          recurring: parsed.data.recurring,
          halfDay: parsed.data.halfDay,
        },
      });

      await auditLog(req, ctx, "HOLIDAY_CREATED", "holiday", holiday.id);
      return res.status(201).json({ ok: true, data: holiday });
    }
  },
  { permission: "admin.holidays", methods: ["GET", "POST"] }
);
