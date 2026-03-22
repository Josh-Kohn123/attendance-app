import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { fetchEventsInRange, extractAbsenceStatus } from "../../apps/api/src/services/google-calendar.js";
import { getWorkdaysInRange } from "../../lib/calendar-digest-helpers.js";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "from and to required" } });
    }

    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) {
      return res.status(500).json({ ok: false, error: { code: "CONFIG_ERROR", message: "GOOGLE_CALENDAR_ID not configured" } });
    }

    const org = await prisma.org.findUnique({ where: { id: ctx.orgId } });
    if (!org) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Org not found" } });
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
  { permission: "admin.policies", methods: ["GET"] },
);
