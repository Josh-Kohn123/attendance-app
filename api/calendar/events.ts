import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { fetchEventsInRange } from "../../apps/api/src/services/google-calendar.js";

/**
 * Read-only shared-calendar events for any authenticated employee.
 *
 * Returns the raw Google Calendar events in the given range (title + date span
 * only), with the org's "Always-ignored titles" filtered out. No employee
 * name-matching or attendance lookup — this is purely a reference view so
 * employees can cross-check what they wrote on the shared calendar.
 */
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
    const allEvents = await fetchEventsInRange(calendarId, from, to, org.timezone);

    // Filter out always-ignored event titles (case-insensitive, same as the digest)
    const ignoredTitles = await prisma.ignoredCalendarEvent.findMany({
      where: { orgId: org.id },
      select: { eventTitle: true },
    });
    const ignoredSet = new Set(ignoredTitles.map((i) => i.eventTitle.toLowerCase()));
    const events = allEvents
      .filter((e) => !ignoredSet.has(e.title.toLowerCase()))
      .map((e) => ({ id: e.id, title: e.title, startDate: e.startDate, endDate: e.endDate }));

    return { ok: true, data: { events } };
  },
  { permission: "attendance.view_self", methods: ["GET"] },
);
