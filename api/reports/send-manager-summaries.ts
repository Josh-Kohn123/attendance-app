import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { email } from "../../apps/api/src/services/email.js";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { from, to, month, year } = req.body as {
      from: string;
      to: string;
      month: number;
      year: number;
    };

    if (!from || !to || !month || !year) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "from, to, month, year required" } });
    }

    const org = await prisma.org.findUnique({ where: { id: ctx.orgId } });
    if (!org) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Org not found" } });
    }

    // Find all managers (users with manager role)
    const managerRoles = await prisma.userRole.findMany({
      where: { role: "manager", user: { orgId: ctx.orgId } },
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });

    const period = `${new Date(year, month - 1).toLocaleString("default", { month: "long" })} ${year}`;
    let sent = 0;

    for (const { user: manager } of managerRoles) {
      // Get this manager's direct reports
      const employees = await prisma.employee.findMany({
        where: { orgId: ctx.orgId, isActive: true, managerId: manager.id },
        include: { department: { select: { name: true } } },
        orderBy: { lastName: "asc" },
      });

      if (employees.length === 0) continue;

      const empIds = employees.map((e) => e.id);

      const events = await prisma.attendanceEvent.findMany({
        where: {
          orgId: ctx.orgId,
          employeeId: { in: empIds },
          eventType: "CLOCK_IN",
          serverTimestamp: {
            gte: new Date(`${from}T00:00:00Z`),
            lte: new Date(`${to}T23:59:59Z`),
          },
        },
        select: { employeeId: true, notes: true },
      });

      // Get monthly report statuses
      const reports = await prisma.monthlyReport.findMany({
        where: {
          orgId: ctx.orgId,
          employeeId: { in: empIds },
          month,
          year,
        },
        select: { employeeId: true, status: true },
      });
      const reportMap = new Map(reports.map((r) => [r.employeeId, r.status]));

      // Tally per employee
      const empSummaries = employees.map((emp) => {
        const empEvents = events.filter((e) => e.employeeId === emp.id);
        const counts = { present: 0, sick: 0, childSick: 0, vacation: 0, reserves: 0, halfDay: 0, workFromHome: 0, publicHoliday: 0, holidayEve: 0, choiceDay: 0, advancedStudy: 0, dayOff: 0 };
        for (const ev of empEvents) {
          const status = ev.notes ?? "PRESENT";
          if (status === "PRESENT") counts.present++;
          else if (status === "SICK") counts.sick++;
          else if (status === "CHILD_SICK") counts.childSick++;
          else if (status === "VACATION") counts.vacation++;
          else if (status === "RESERVES") counts.reserves++;
          else if (status === "HALF_DAY") counts.halfDay++;
          else if (status === "WORK_FROM_HOME") counts.workFromHome++;
          else if (status === "PUBLIC_HOLIDAY") counts.publicHoliday++;
          else if (status === "HOLIDAY_EVE") counts.holidayEve++;
          else if (status === "CHOICE_DAY") counts.choiceDay++;
          else if (status === "ADVANCED_STUDY") counts.advancedStudy++;
          else if (status === "DAY_OFF") counts.dayOff++;
          else counts.present++;
        }
        return {
          name: `${emp.firstName} ${emp.lastName}`,
          department: emp.department?.name ?? "-",
          ...counts,
          reportStatus: reportMap.get(emp.id) ?? "DRAFT",
        };
      });

      await email.sendManagerSummary({
        managerEmail: manager.email,
        managerName: manager.displayName,
        orgName: org.name,
        period,
        employees: empSummaries,
      });
      sent++;
    }

    return { ok: true, data: { sent } };
  },
  { permission: "admin.policies", methods: ["POST"] },
);
