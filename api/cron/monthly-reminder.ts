/**
 * Vercel Cron: Monthly Report Reminder
 *
 * Runs daily at 06:00 UTC (~09:00 Israel). Checks each org's
 * monthStartDay — if today matches, emails all active employees
 * a reminder to submit their monthly attendance report.
 *
 * Schedule: "0 6 * * *" (configured in vercel.json)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "@orbs/db";
import { email } from "../../apps/api/src/services/email.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify the request is from Vercel Cron
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results: Array<{ org: string; emailsSent: number }> = [];

  try {
    const orgs = await prisma.org.findMany({
      select: { id: true, name: true, monthStartDay: true, timezone: true },
    });

    for (const org of orgs) {
      const now = dayjs().tz(org.timezone);
      const today = now.date();

      if (today !== org.monthStartDay) continue;

      // The period that just ended: previous monthStartDay to yesterday
      // e.g. if monthStartDay=26 and today is April 26, period = Mar 26 – Apr 25
      const periodEnd = now.subtract(1, "day");
      const periodStart = periodEnd.date() >= org.monthStartDay
        ? periodEnd.date(org.monthStartDay)
        : periodEnd.subtract(1, "month").date(org.monthStartDay);

      const periodLabel = `${periodStart.format("MMM D")} – ${periodEnd.format("MMM D, YYYY")}`;

      const employees = await prisma.employee.findMany({
        where: { orgId: org.id, isActive: true },
        select: { id: true, email: true, firstName: true, lastName: true },
      });

      let emailsSent = 0;

      for (const emp of employees) {
        const sent = await email.sendMonthlyReminder({
          orgId: org.id,
          employeeEmail: emp.email,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          periodLabel,
          month: periodStart.month() + 1,
          year: periodStart.year(),
        });
        if (sent) emailsSent++;
      }

      results.push({ org: org.name, emailsSent });
      console.log(`[MonthlyReminder] ${org.name}: sent ${emailsSent}/${employees.length} emails`);
    }

    return res.status(200).json({ ok: true, results });
  } catch (error) {
    console.error("[MonthlyReminder] Error:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}
