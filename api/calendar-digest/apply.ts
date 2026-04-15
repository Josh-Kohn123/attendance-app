import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { getWorkdaysInRange, applyAttendanceForced } from "../../lib/calendar-digest-helpers.js";
import { getReportingMonth } from "@orbs/shared";
import { email } from "../../apps/api/src/services/email.js";

/**
 * Check if an employee has a SUBMITTED/APPROVED monthly report covering the given date range.
 * If so, send an email alert to the admin about the discrepancy including a table of changes.
 */
async function checkSubmittedReportMismatch(
  orgId: string,
  employeeId: string,
  startDate: string,
  endDate: string,
  adminEmail: string,
  changes: Array<{ date: string; previousStatus: string | null; newStatus: string }>,
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
        const reportStatusLabel = report.status === "APPROVED"
          ? "had their report approved"
          : "submitted their monthly report";

        // Build changes table rows
        const changesTableRows = changes
          .map((c) => {
            const prev = c.previousStatus ?? "—";
            return `<tr>
              <td style="padding:6px 12px;border:1px solid #e5e7eb;">${c.date}</td>
              <td style="padding:6px 12px;border:1px solid #e5e7eb;">${prev}</td>
              <td style="padding:6px 12px;border:1px solid #e5e7eb;font-weight:600;">${c.newStatus}</td>
            </tr>`;
          })
          .join("");

        const changesTable = `
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <thead>
              <tr style="background-color:#f3f4f6;">
                <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left;">Date</th>
                <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left;">Previous</th>
                <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left;">Updated</th>
              </tr>
            </thead>
            <tbody>${changesTableRows}</tbody>
          </table>`;

        await email.alertException({
          orgId,
          managerEmail: adminEmail,
          exceptionType: "Submitted Report Mismatch",
          employeeName: empName,
          details: `An admin update from Calendar Digest modified attendance for <strong>${empName}</strong>, who has already ${reportStatusLabel} for ${periodLabel}. The employee's report has been updated to reflect the admin's input.${changesTable}<p style="margin-top:16px;color:#991b1b;font-weight:500;">If this report was already downloaded and saved to bookkeeping, the bookkeeping records will need to be updated as well.</p>`,
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
    try {
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

      console.log("[CalendarDigest/apply] Received", entries.length, "entries,", additionalEntries.length, "additional");

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
        console.log("[CalendarDigest/apply] Processing entry:", entry.employeeId, entry.status, entry.startDate, "→", entry.endDate);

        const employee = await prisma.employee.findUnique({
          where: { id: entry.employeeId },
          select: { id: true, siteId: true, orgId: true, isActive: true },
        });

        if (!employee || !employee.isActive || employee.orgId !== ctx.orgId) continue;

        const workdays = getWorkdaysInRange(entry.startDate, entry.endDate);
        const changes: Array<{ date: string; previousStatus: string | null; newStatus: string }> = [];
        for (const date of workdays) {
          const { previousStatus } = await applyAttendanceForced(ctx.orgId, employee, date, entry.status, systemUserId);
          changes.push({ date, previousStatus, newStatus: entry.status });
        }

        // Check if this employee has a submitted report that now mismatches
        if (adminEmail) {
          await checkSubmittedReportMismatch(ctx.orgId, entry.employeeId, entry.startDate, entry.endDate, adminEmail, changes);
        }

        applied++;
      }

      return { ok: true, data: { applied } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[CalendarDigest/apply] Error:", message, err);
      return res.status(500).json({ ok: false, error: { code: "APPLY_ERROR", message } });
    }
  },
  { permission: "admin.policies", methods: ["POST"] },
);
