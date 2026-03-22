import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { from, to } = req.query as { from: string; to: string };
    if (!from || !to) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "from and to required" } });
    }

    const scopedDeptIds = ctx.authzContext.scopes
      .filter((s: any) => s.scopeType === "department")
      .map((s: any) => s.scopeId);
    const empWhere: any = { orgId: ctx.orgId };
    if (!ctx.roles.includes("admin") && scopedDeptIds.length > 0) {
      empWhere.departmentId = { in: scopedDeptIds };
    }

    const employees = await prisma.employee.findMany({
      where: empWhere,
      include: { department: true, site: true },
    });

    const empIds = employees.map((e) => e.id);
    const events = await prisma.attendanceEvent.findMany({
      where: {
        orgId: ctx.orgId,
        employeeId: { in: empIds },
        eventType: "CLOCK_IN",
        serverTimestamp: { gte: new Date(from as string), lte: new Date(`${to}T23:59:59Z`) },
      },
    });

    // Group by employee and status (stored in notes field)
    const eventsByEmployee = new Map<string, { total: number; present: number; sick: number; childSick: number; vacation: number; reserves: number; halfDay: number; workFromHome: number; publicHoliday: number; holidayEve: number; choiceDay: number; advancedStudy: number; dayOff: number }>();
    for (const event of events) {
      const existing = eventsByEmployee.get(event.employeeId) ?? { total: 0, present: 0, sick: 0, childSick: 0, vacation: 0, reserves: 0, halfDay: 0, workFromHome: 0, publicHoliday: 0, holidayEve: 0, choiceDay: 0, advancedStudy: 0, dayOff: 0 };
      const status = ((event.notes as string) ?? "PRESENT").toUpperCase();
      existing.total += 1;
      if (status === "SICK") existing.sick += 1;
      else if (status === "CHILD_SICK") existing.childSick += 1;
      else if (status === "VACATION") existing.vacation += 1;
      else if (status === "RESERVES") existing.reserves += 1;
      else if (status === "HALF_DAY") existing.halfDay += 1;
      else if (status === "WORK_FROM_HOME") existing.workFromHome += 1;
      else if (status === "PUBLIC_HOLIDAY") existing.publicHoliday += 1;
      else if (status === "HOLIDAY_EVE") existing.holidayEve += 1;
      else if (status === "CHOICE_DAY") existing.choiceDay += 1;
      else if (status === "ADVANCED_STUDY") existing.advancedStudy += 1;
      else if (status === "DAY_OFF") existing.dayOff += 1;
      else existing.present += 1;
      eventsByEmployee.set(event.employeeId, existing);
    }

    const summary = employees.map((emp) => {
      const counts = eventsByEmployee.get(emp.id) ?? { total: 0, present: 0, sick: 0, childSick: 0, vacation: 0, reserves: 0, halfDay: 0, workFromHome: 0, publicHoliday: 0, holidayEve: 0, choiceDay: 0, advancedStudy: 0, dayOff: 0 };
      return {
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        department: emp.department?.name ?? "N/A",
        site: emp.site.name,
        totalDays: counts.total,
        present: counts.present,
        sick: counts.sick,
        childSick: counts.childSick,
        vacation: counts.vacation,
        reserves: counts.reserves,
        halfDay: counts.halfDay,
        workFromHome: counts.workFromHome,
        publicHoliday: counts.publicHoliday,
        dayOff: counts.dayOff,
      };
    });

    return { ok: true, data: summary };
  },
  { permission: "reports.view_team", methods: ["GET"] },
);
