/**
 * Calendar Digest Routes (token-authenticated, no JWT required)
 *
 * GET  /calendar-digest/:token  — fetch digest data for the review page
 * POST /calendar-digest/:token  — submit admin decisions + apply attendance records
 *
 * Authentication is the unguessable UUID token embedded in the link.
 * These routes are intentionally unauthenticated so the admin can
 * open the review page directly from the email without logging in first.
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";
import dayjs from "dayjs";
import crypto from "crypto";
import type {
  DigestConfirmRequest,
  DigestEntry,
  DigestEmployee,
  CalendarDigestData,
} from "@orbs/shared";

// Weekend days in Israeli work week (no attendance records created)
const WEEKEND_DAYS = new Set([5, 6]); // Friday, Saturday

export async function calendarDigestRoutes(app: FastifyInstance) {
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

        const workdays = getWorkdaysInRange(entry.startDate, entry.endDate);
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

        if (!employee || !employee.isActive || employee.orgId !== digest.orgId) continue;

        const workdays = getWorkdaysInRange(extra.startDate, extra.endDate);
        for (const date of workdays) {
          await applyAttendanceIfAbsent(digest.orgId, employee, date, extra.status, systemUserId);
        }

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

        applied++;
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
