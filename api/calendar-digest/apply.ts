import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";
import { getWorkdaysInRange, applyAttendanceIfAbsent } from "../../lib/calendar-digest-helpers";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { entries = [], additionalEntries = [] } = (req.body ?? {}) as {
      entries?: Array<{
        employeeId: string;
        status: string;
        startDate: string;
        endDate: string;
      }>;
      additionalEntries?: Array<{
        employeeId: string;
        status: string;
        startDate: string;
        endDate: string;
      }>;
    };

    const systemUserId = process.env.SYSTEM_USER_ID;
    if (!systemUserId) {
      return res.status(500).json({ ok: false, error: { code: "CONFIG_ERROR", message: "SYSTEM_USER_ID not configured" } });
    }

    let applied = 0;

    const allEntries = [...entries, ...additionalEntries];
    for (const entry of allEntries) {
      const employee = await prisma.employee.findUnique({
        where: { id: entry.employeeId },
        select: { id: true, siteId: true, orgId: true, isActive: true },
      });

      if (!employee || !employee.isActive || employee.orgId !== ctx.orgId) continue;

      const workdays = getWorkdaysInRange(entry.startDate, entry.endDate);
      for (const date of workdays) {
        await applyAttendanceIfAbsent(ctx.orgId, employee, date, entry.status, systemUserId);
      }
      applied++;
    }

    return { ok: true, data: { applied } };
  },
  { permission: "admin.policies", methods: ["POST"] },
);
