import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { getWorkdaysInRange, applyAttendanceForced } from "../../lib/calendar-digest-helpers.js";
import { getReportingMonth } from "@orbs/shared";
import { email } from "../../apps/api/src/services/email.js";

/**
 * Check if an employee has a SUBMITTED/APPROVED monthly report covering the given date range.
 * If so, send an email alert to the admin about the discrepancy.
 */
async function checkSubmittedReportMismatch(
  orgId: string,
  employeeId: string,
  startDate: string,
  endDate: string,
  adminEmail: string,
) {
  try {
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { monthStartDay: true },
    });
    if (!org) return;

    // Determine which reporting months are affected
    const startReporting = getReportingMonth(startDate, org.monthStartDay);
    const endReporting = getReportingMonth(endDate, org.monthStartDay);

    const periods = new Set<string>();
    periods.add(`${startReporting.month}-${startReporting.year}`);
    periods.add(`${endReporting.month}-${endReporting.year}`);

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true },
    });
    if (!employee) return;

    for (const key of periods) {
      const [m, y] = key.split("-").map(Number);
      const report = await prisma.monthlyReport.findUnique({
        where: {
          orgId_employeeId_month_year: {
            orgId,
            employeeId,
            month: m,
            year: y,
          },
        },
        select: { status: true },
      });

      if (report && (report.status === "SUBMITTED" || report.status === "APPROVED")) {
        const periodLabel = `${new Date(y, m - 1).toLocaleString("default", { month: "long" })} ${y}`;
        const empName = `${employee.firstName} ${employee.lastName}`;
        await email.alertException({
          orgId,
          managerEmail: adminEmail,
          exceptionType: "Submitted Report Mismatch",
          employeeName: empName,
          details: `An admin update from Calendar Digest modified attendance for ${startDate} to ${endDate}, but ${empName} has already ${report.status === "APPROVED" ? "had their report approved" : "submitted their monthly report"} for ${periodLabel}. The report data and the calendar now differ — please review and re-approve if needed.`,
        });
        console.log(`[CalendarDigest] Mismatch alert sent to ${adminEmail} for ${empName} (${periodLabel})`);
      }
    }
  } catch (err) {
    console.error("[CalendarDigest] Error checking submitted report mismatch:", err);
  }
}

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

    // Get admin email for mismatch notifications
    const adminUser = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { email: true },
    });
    const adminEmail = adminUser?.email ?? "";

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
        await applyAttendanceForced(ctx.orgId, employee, date, entry.status, systemUserId);
      }

      // Check if this employee has a submitted report that now mismatches
      if (adminEmail) {
        await checkSubmittedReportMismatch(ctx.orgId, entry.employeeId, entry.startDate, entry.endDate, adminEmail);
      }

      applied++;
    }

    return { ok: true, data: { applied } };
  },
  { permission: "admin.policies", methods: ["POST"] },
);
