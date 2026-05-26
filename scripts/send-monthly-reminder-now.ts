/**
 * One-off: send the monthly attendance reminder NOW for every org,
 * bypassing the daily today-equals-monthStartDay check used by the cron.
 *
 * Use this when the scheduled cron at /api/cron/monthly-reminder fails
 * (e.g. DB unreachable) and employees missed the morning reminder.
 *
 * Usage:
 *   npx tsx --env-file=.env.vercel scripts/send-monthly-reminder-now.ts
 *   # add --dry-run to print recipients without sending
 */

import { prisma } from "@orbs/db";
import { email } from "../apps/api/src/services/email.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const orgs = await prisma.org.findMany({
    select: { id: true, name: true, monthStartDay: true, timezone: true },
  });

  for (const org of orgs) {
    // Determine the most recently ended reporting period in the org's timezone.
    // Mirrors the logic in api/cron/monthly-reminder.ts.
    const now = dayjs().tz(org.timezone);
    const periodEnd = now.date() >= org.monthStartDay
      ? now.date(org.monthStartDay).subtract(1, "day")
      : now.subtract(1, "month").date(org.monthStartDay).subtract(1, "day");
    const periodStart = periodEnd.date() >= org.monthStartDay
      ? periodEnd.date(org.monthStartDay)
      : periodEnd.subtract(1, "month").date(org.monthStartDay);

    const periodLabel = `${periodStart.format("MMM D")} – ${periodEnd.format("MMM D, YYYY")}`;

    const employees = await prisma.employee.findMany({
      where: { orgId: org.id, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    console.log(`\n[${org.name}] period ${periodLabel}: ${employees.length} active employees`);
    if (dryRun) {
      for (const emp of employees) {
        console.log(`  DRY-RUN -> ${emp.firstName} ${emp.lastName} <${emp.email}>`);
      }
      continue;
    }

    let sent = 0;
    let failed = 0;
    for (const emp of employees) {
      try {
        const ok = await email.sendMonthlyReminder({
          orgId: org.id,
          employeeEmail: emp.email,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          periodLabel,
          month: periodStart.month() + 1,
          year: periodStart.year(),
        });
        if (ok) {
          sent++;
          console.log(`  sent -> ${emp.email}`);
        } else {
          failed++;
          console.warn(`  FAILED -> ${emp.email} (sendMonthlyReminder returned false)`);
        }
      } catch (err) {
        failed++;
        console.error(`  ERROR -> ${emp.email}:`, err);
      }
    }
    console.log(`[${org.name}] done: ${sent} sent, ${failed} failed`);
  }
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
