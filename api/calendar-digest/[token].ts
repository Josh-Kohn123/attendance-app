import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withPublic } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import type { DigestConfirmRequest, DigestEntry, DigestEmployee, CalendarDigestData } from "@orbs/shared";
import {
  getWorkdaysInRange,
  applyAttendanceForced,
} from "../../lib/calendar-digest-helpers.js";
import { getReportingMonth } from "@orbs/shared";
import { email } from "../../apps/api/src/services/email.js";

/**
 * Check if an employee has a SUBMITTED monthly report covering the given date range.
 * If so, send an email alert to the calendar-digest admin about the discrepancy.
 */
async function checkSubmittedReportMismatch(
  orgId: string,
  employeeId: string,
  startDate: string,
  endDate: string,
) {
  try {
    // Find the org's monthStartDay to determine which reporting months are affected
    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { monthStartDay: true, calendarDigestAdminUserId: true },
    });
    if (!org) return;

    // Get the reporting months that the date range spans
    const startReporting = getReportingMonth(startDate, org.monthStartDay);
    const endReporting = getReportingMonth(endDate, org.monthStartDay);

    // Collect unique month/year combos
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

      if (report && report.status === "SUBMITTED") {
        // Report was already submitted — admin edit creates a mismatch
        // Send email to admin
        if (org.calendarDigestAdminUserId) {
          const adminUser = await prisma.user.findUnique({
            where: { id: org.calendarDigestAdminUserId },
            select: { email: true, displayName: true },
          });
          if (adminUser) {
            const periodLabel = `${new Date(y, m - 1).toLocaleString("default", { month: "long" })} ${y}`;
            await email.alertException({
              orgId,
              managerEmail: adminUser.email,
              exceptionType: "Submitted Report Mismatch",
              employeeName: `${employee.firstName} ${employee.lastName}`,
              details: `An admin update from Calendar Digest modified attendance for ${startDate} to ${endDate}, but ${employee.firstName} ${employee.lastName} has already submitted their monthly report for ${periodLabel}. The report data and the calendar now differ — please review and re-approve if needed.`,
            });
            console.log(`[CalendarDigest] Mismatch alert sent to ${adminUser.email} for ${employee.firstName} ${employee.lastName} (${periodLabel})`);
          }
        }
      }
    }
  } catch (err) {
    // Don't let email failures block the digest submission
    console.error("[CalendarDigest] Error checking submitted report mismatch:", err);
  }
}

export default withPublic(
  async (req: VercelRequest, res: VercelResponse, _ctx) => {
    const token = req.query.token as string;

    // ── GET /calendar-digest/:token ──────────────────────────────────────
    if (req.method === "GET") {
      const digest = await prisma.calendarDigest.findUnique({
        where: { token },
        include: {
          entries: { orderBy: { createdAt: "asc" } },
          org: { select: { id: true, name: true } },
        },
      });

      if (!digest) {
        return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Digest not found" } });
      }

      // Fetch all employees for dropdowns
      const employees = await prisma.employee.findMany({
        where: { orgId: digest.orgId },
        select: { id: true, firstName: true, lastName: true, isActive: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      });

      // Build employee lookup map
      const empMap = new Map(employees.map((e) => [e.id, e]));

      // Enrich each entry with live data
      const enrichedEntries: DigestEntry[] = await Promise.all(
        digest.entries.map(async (entry) => {
          const effectiveEmployeeId = entry.resolvedEmployeeId ?? entry.proposedEmployeeId;

          // Live check: does this employee already have an attendance record for the date range?
          let hasExistingEntry = false;
          if (effectiveEmployeeId) {
            const existing = await prisma.attendanceEvent.findFirst({
              where: {
                employeeId: effectiveEmployeeId,
                eventType: "CLOCK_IN",
                serverTimestamp: {
                  gte: new Date(`${entry.startDate}T00:00:00Z`),
                  lte: new Date(`${entry.endDate}T23:59:59Z`),
                },
              },
              select: { id: true },
            });
            hasExistingEntry = existing !== null;
          }

          const proposedEmp = entry.proposedEmployeeId ? empMap.get(entry.proposedEmployeeId) : null;

          return {
            id: entry.id,
            eventTitle: entry.eventTitle,
            eventId: entry.eventId,
            startDate: entry.startDate,
            endDate: entry.endDate,
            matchType: entry.matchType as DigestEntry["matchType"],
            proposedEmployeeId: entry.proposedEmployeeId,
            proposedEmployeeName: proposedEmp
              ? `${proposedEmp.firstName} ${proposedEmp.lastName}`
              : null,
            proposedStatus: entry.proposedStatus,
            candidateEmployees: entry.candidateEmployeeIds
              .map((id) => {
                const emp = empMap.get(id);
                return emp ? { id: emp.id, firstName: emp.firstName, lastName: emp.lastName } : null;
              })
              .filter(Boolean) as DigestEntry["candidateEmployees"],
            decision: entry.decision as DigestEntry["decision"],
            resolvedEmployeeId: entry.resolvedEmployeeId,
            resolvedStatus: entry.resolvedStatus,
            hasExistingEntry,
          };
        }),
      );

      const digestEmployees: DigestEmployee[] = employees.map((e) => ({
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        isActive: e.isActive,
      }));

      const data: CalendarDigestData = {
        id: digest.id,
        orgId: digest.orgId,
        orgName: digest.org.name,
        date: digest.date,
        status: digest.status as CalendarDigestData["status"],
        entries: enrichedEntries,
        employees: digestEmployees,
      };

      return { ok: true, data };
    }

    // ── POST /calendar-digest/:token ─────────────────────────────────────
    if (req.method === "POST") {
      const { decisions = [], additionalEntries = [] } = (req.body ?? {}) as DigestConfirmRequest;

      const digest = await prisma.calendarDigest.findUnique({
        where: { token },
        include: {
          entries: true,
          org: { select: { id: true, timezone: true } },
        },
      });

      if (!digest) {
        return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Digest not found" } });
      }

      if (digest.status === "SUBMITTED") {
        return res.status(400).json({ ok: false, error: { code: "ALREADY_SUBMITTED", message: "Digest already submitted" } });
      }

      const systemUserId = process.env.SYSTEM_USER_ID;
      if (!systemUserId) {
        return res.status(500).json({ ok: false, error: { code: "CONFIG_ERROR", message: "SYSTEM_USER_ID not configured" } });
      }

      const entryMap = new Map(digest.entries.map((e) => [e.id, e]));
      let applied = 0;
      let declined = 0;

      // ── Process admin decisions ──────────────────────────────
      for (const dec of decisions) {
        const entry = entryMap.get(dec.entryId);
        if (!entry) continue;

        // Update entry decision in DB
        await prisma.calendarDigestEntry.update({
          where: { id: entry.id },
          data: {
            decision: dec.decision,
            resolvedEmployeeId: dec.resolvedEmployeeId ?? null,
            resolvedStatus: dec.resolvedStatus ?? null,
          },
        });

        if (dec.decision === "DECLINED") {
          declined++;
          continue;
        }

        // Apply CONFIRMED entry
        const employeeId = dec.resolvedEmployeeId ?? entry.proposedEmployeeId;
        const status = dec.resolvedStatus ?? entry.proposedStatus;

        if (!employeeId || !status) {
          console.warn(`[CalendarDigest] Skipping entry ${entry.id} — missing employeeId or status`);
          continue;
        }

        const employee = await prisma.employee.findUnique({
          where: { id: employeeId },
          select: { id: true, siteId: true, isActive: true },
        });

        if (!employee || !employee.isActive) continue;

        // Use admin-overridden date range if provided, otherwise fall back to the entry's dates
        const effectiveStart = dec.startDate ?? entry.startDate;
        const effectiveEnd = dec.endDate ?? entry.endDate;
        const workdays = getWorkdaysInRange(effectiveStart, effectiveEnd);
        for (const date of workdays) {
          await applyAttendanceForced(digest.orgId, employee, date, status, systemUserId);
        }

        // Check if employee has a submitted monthly report that now has a mismatch
        await checkSubmittedReportMismatch(digest.orgId, employeeId, effectiveStart, effectiveEnd);

        applied++;
      }

      // ── Process additional entries added by admin ────────────
      for (const extra of additionalEntries) {
        const employee = await prisma.employee.findUnique({
          where: { id: extra.employeeId },
          select: { id: true, siteId: true, orgId: true, isActive: true },
        });

        if (!employee || !employee.isActive || employee.orgId !== digest.orgId) {
          console.warn(`[CalendarDigest] Skipping additional entry for employee ${extra.employeeId} — not found, inactive, or wrong org`);
          continue;
        }

        const workdays = getWorkdaysInRange(extra.startDate, extra.endDate);
        let entriesCreated = 0;
        for (const date of workdays) {
          const created = await applyAttendanceForced(digest.orgId, employee, date, extra.status, systemUserId);
          if (created) entriesCreated++;
        }

        console.log(`[CalendarDigest] Additional entry for employee ${extra.employeeId} (${extra.startDate}→${extra.endDate}): ${entriesCreated} attendance records written`);

        // Check if employee has a submitted monthly report that now has a mismatch
        await checkSubmittedReportMismatch(digest.orgId, extra.employeeId, extra.startDate, extra.endDate);

        // Record in digest entries for audit trail
        await prisma.calendarDigestEntry.create({
          data: {
            digestId: digest.id,
            eventTitle: `Manual entry by admin`,
            startDate: extra.startDate,
            endDate: extra.endDate,
            matchType: "MANUAL",
            proposedEmployeeId: extra.employeeId,
            proposedStatus: extra.status,
            candidateEmployeeIds: [],
            decision: "CONFIRMED",
            resolvedEmployeeId: extra.employeeId,
            resolvedStatus: extra.status,
          },
        });

        if (entriesCreated > 0) applied++;
      }

      // Mark digest as submitted
      await prisma.calendarDigest.update({
        where: { id: digest.id },
        data: { status: "SUBMITTED", submittedAt: new Date() },
      });

      console.log(
        `[CalendarDigest] Digest ${digest.id} submitted — applied: ${applied}, declined: ${declined}`,
      );

      return { ok: true, data: { applied, declined } };
    }
  },
  { methods: ["GET", "POST"] },
);
