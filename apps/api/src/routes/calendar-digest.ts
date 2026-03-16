/**
 * Calendar Digest Routes
 *
 * Token-authenticated (legacy):
 *   GET  /calendar-digest/:token  — fetch digest data for the review page
 *   POST /calendar-digest/:token  — submit admin decisions + apply attendance records
 *
 * JWT-authenticated (admin UI):
 *   GET  /calendar-digest/fetch?from=YYYY-MM-DD&to=YYYY-MM-DD — fetch live calendar events
 *   POST /calendar-digest/apply — apply confirmed entries to attendance records
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";
import { requirePermission } from "@orbs/authz";
import dayjs from "dayjs";
import crypto from "crypto";
import type {
  DigestConfirmRequest,
  DigestEntry,
  DigestEmployee,
  CalendarDigestData,
} from "@orbs/shared";
import { fetchEventsInRange, extractAbsenceStatus } from "../services/google-calendar.js";

// Weekend days in Israeli work week (no attendance records created)
const WEEKEND_DAYS = new Set([5, 6]); // Friday, Saturday

export async function calendarDigestRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════════
  // Admin-authenticated endpoints (JWT required)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * GET /calendar-digest/fetch?from=YYYY-MM-DD&to=YYYY-MM-DD
   * Fetches live Google Calendar events and matches them against employees.
   */
  app.get(
    "/fetch",
    { preHandler: [requirePermission("admin.policies")] },
    async (request, reply) => {
      const { from, to } = request.query as { from?: string; to?: string };
      if (!from || !to) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "from and to required" } });
      }

      const calendarId = process.env.GOOGLE_CALENDAR_ID;
      if (!calendarId) {
        return reply.status(500).send({ ok: false, error: { code: "CONFIG_ERROR", message: "GOOGLE_CALENDAR_ID not configured" } });
      }

      const org = await prisma.org.findUnique({ where: { id: request.currentOrgId! } });
      if (!org) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Org not found" } });
      }

      // Fetch live events from Google Calendar
      const events = await fetchEventsInRange(calendarId, from, to, org.timezone);

      // Fetch all employees for matching
      const employees = await prisma.employee.findMany({
        where: { orgId: org.id },
        select: { id: true, firstName: true, lastName: true, isActive: true },
      });

      // Fetch existing attendance records in the range to check what's already applied
      const existingAttendance = await prisma.attendanceEvent.findMany({
        where: {
          orgId: org.id,
          eventType: "CLOCK_IN",
          source: "GOOGLE_CALENDAR",
          serverTimestamp: {
            gte: new Date(`${from}T00:00:00Z`),
            lte: new Date(`${to}T23:59:59Z`),
          },
        },
        select: { employeeId: true, serverTimestamp: true, notes: true },
      });

      // Build a set of "employeeId:date" for quick lookup
      const appliedSet = new Set(
        existingAttendance.map((a) => `${a.employeeId}:${a.serverTimestamp.toISOString().slice(0, 10)}`),
      );

      // Match events to employees
      const entries = events.map((event) => {
        const titleLower = event.title.toLowerCase();

        const matched = employees.filter((emp) => {
          const first = emp.firstName.toLowerCase();
          const full = `${emp.firstName} ${emp.lastName}`.toLowerCase();
          return titleLower.includes(first) || titleLower.includes(full);
        });

        let matchType: string;
        let proposedEmployeeId: string | null = null;
        let proposedStatus: string | null = null;
        let candidateEmployeeIds: string[] = [];
        let hasExistingEntry = false;

        if (matched.length === 0) {
          matchType = "UNMATCHED";
        } else if (matched.length > 1) {
          matchType = "AMBIGUOUS_NAME";
          candidateEmployeeIds = matched.map((e) => e.id);
        } else {
          const employee = matched[0];
          proposedEmployeeId = employee.id;

          if (!employee.isActive) {
            matchType = "INACTIVE_EMPLOYEE";
          } else {
            const status = extractAbsenceStatus(titleLower);
            if (status) {
              matchType = "MATCHED";
              proposedStatus = status;
            } else {
              matchType = "UNCLEAR_STATUS";
            }
          }

          // Check if already applied for all dates in the event range
          const workdays = getWorkdaysInRange(event.startDate, event.endDate);
          hasExistingEntry = workdays.length > 0 && workdays.every((d) => appliedSet.has(`${employee.id}:${d}`));
        }

        return {
          eventId: event.id,
          eventTitle: event.title,
          startDate: event.startDate,
          endDate: event.endDate,
          matchType,
          proposedEmployeeId,
          proposedStatus,
          candidateEmployeeIds,
          hasExistingEntry,
        };
      });

      return {
        ok: true,
        data: {
          entries,
          employees: employees.map((e) => ({
            id: e.id,
            firstName: e.firstName,
            lastName: e.lastName,
            isActive: e.isActive,
          })),
        },
      };
    },
  );

  /**
   * POST /calendar-digest/apply
   * Apply confirmed calendar entries to attendance records.
   */
  app.post(
    "/apply",
    { preHandler: [requirePermission("admin.policies")] },
    async (request, reply) => {
      const { entries = [], additionalEntries = [] } = request.body as {
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
        return reply.status(500).send({ ok: false, error: { code: "CONFIG_ERROR", message: "SYSTEM_USER_ID not configured" } });
      }

      let applied = 0;

      const allEntries = [...entries, ...additionalEntries];
      for (const entry of allEntries) {
        const employee = await prisma.employee.findUnique({
          where: { id: entry.employeeId },
          select: { id: true, siteId: true, orgId: true, isActive: true },
        });

        if (!employee || !employee.isActive || employee.orgId !== request.currentOrgId!) continue;

        const workdays = getWorkdaysInRange(entry.startDate, entry.endDate);
        for (const date of workdays) {
          await applyAttendanceIfAbsent(request.currentOrgId!, employee, date, entry.status, systemUserId);
        }
        applied++;
      }

      return { ok: true, data: { applied } };
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // Token-authenticated endpoints (legacy digest email links)
  // ═══════════════════════════════════════════════════════════════════
  // ─── GET /calendar-digest/:token ─────────────────────────────
  // Returns digest data with live hasExistingEntry checks.

  app.get<{ Params: { token: string } }>("/:token", async (request, reply) => {
    const { token } = request.params;

    const digest = await prisma.calendarDigest.findUnique({
      where: { token },
      include: {
        entries: { orderBy: { createdAt: "asc" } },
        org: { select: { id: true, name: true } },
      },
    });

    if (!digest) {
      return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Digest not found" } });
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
  });

  // ─── POST /calendar-digest/:token ────────────────────────────
  // Admin submits decisions. Confirmed entries are applied immediately.

  app.post<{ Params: { token: string }; Body: DigestConfirmRequest }>(
    "/:token",
    async (request, reply) => {
      const { token } = request.params;
      const { decisions = [], additionalEntries = [] } = request.body ?? {};

      const digest = await prisma.calendarDigest.findUnique({
        where: { token },
        include: {
          entries: true,
          org: { select: { id: true, timezone: true } },
        },
      });

      if (!digest) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Digest not found" } });
      }

      if (digest.status === "SUBMITTED") {
        return reply.status(400).send({ ok: false, error: { code: "ALREADY_SUBMITTED", message: "Digest already submitted" } });
      }

      const systemUserId = process.env.SYSTEM_USER_ID;
      if (!systemUserId) {
        return reply.status(500).send({ ok: false, error: { code: "CONFIG_ERROR", message: "SYSTEM_USER_ID not configured" } });
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
          await applyAttendanceIfAbsent(digest.orgId, employee, date, status, systemUserId);
        }

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
    },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Returns all workdays (non-Fri/Sat) between startDate and endDate inclusive.
 */
function getWorkdaysInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let current = dayjs(startDate);
  const end = dayjs(endDate);

  while (!current.isAfter(end)) {
    if (!WEEKEND_DAYS.has(current.day())) {
      dates.push(current.format("YYYY-MM-DD"));
    }
    current = current.add(1, "day");
  }

  return dates;
}

/**
 * Create an attendance CLOCK_IN event only if one doesn't already exist for that day.
 */
async function applyAttendanceIfAbsent(
  orgId: string,
  employee: { id: string; siteId: string },
  dateStr: string,
  status: string,
  systemUserId: string,
): Promise<void> {
  const existing = await prisma.attendanceEvent.findFirst({
    where: {
      employeeId: employee.id,
      eventType: "CLOCK_IN",
      serverTimestamp: {
        gte: new Date(`${dateStr}T00:00:00Z`),
        lte: new Date(`${dateStr}T23:59:59Z`),
      },
    },
    select: { id: true },
  });

  if (existing) return; // already entered — skip

  await prisma.attendanceEvent.create({
    data: {
      orgId,
      employeeId: employee.id,
      siteId: employee.siteId,
      eventType: "CLOCK_IN",
      source: "GOOGLE_CALENDAR",
      serverTimestamp: new Date(`${dateStr}T09:00:00Z`),
      createdByUserId: systemUserId,
      requestId: crypto.randomUUID(),
      notes: status,
    },
  });
}

/**
 * Create or update an attendance CLOCK_IN event for a manual admin entry.
 *
 * Unlike applyAttendanceIfAbsent, this always writes the record:
 * - If a GOOGLE_CALENDAR CLOCK_IN already exists for the day, its status is updated.
 * - If a device/kiosk CLOCK_IN exists, a separate GOOGLE_CALENDAR record is created
 *   so the manual entry is preserved alongside the physical clock-in.
 * - Returns true if a record was created or updated, false if nothing changed.
 */
async function applyAttendanceForced(
  orgId: string,
  employee: { id: string; siteId: string },
  dateStr: string,
  status: string,
  systemUserId: string,
): Promise<boolean> {
  // Check for an existing GOOGLE_CALENDAR CLOCK_IN on this day
  const existingCalendar = await prisma.attendanceEvent.findFirst({
    where: {
      employeeId: employee.id,
      eventType: "CLOCK_IN",
      source: "GOOGLE_CALENDAR",
      serverTimestamp: {
        gte: new Date(`${dateStr}T00:00:00Z`),
        lte: new Date(`${dateStr}T23:59:59Z`),
      },
    },
    select: { id: true, notes: true },
  });

  if (existingCalendar) {
    // Update the existing calendar entry with the new status
    await prisma.attendanceEvent.update({
      where: { id: existingCalendar.id },
      data: { notes: status },
    });
    console.log(`[CalendarDigest] Updated existing GOOGLE_CALENDAR entry for ${employee.id} on ${dateStr}: ${existingCalendar.notes} → ${status}`);
    return true;
  }

  // No calendar entry — create one (even if a kiosk entry exists)
  await prisma.attendanceEvent.create({
    data: {
      orgId,
      employeeId: employee.id,
      siteId: employee.siteId,
      eventType: "CLOCK_IN",
      source: "GOOGLE_CALENDAR",
      serverTimestamp: new Date(`${dateStr}T09:00:00Z`),
      createdByUserId: systemUserId,
      requestId: crypto.randomUUID(),
      notes: status,
    },
  });
  return true;
}
