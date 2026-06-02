/**
 * Calendar Routes (employee-facing, read-only)
 *
 *   GET /calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD
 *     Read-only shared Google Calendar events for the given range. Returns
 *     titles + date spans only, with the org's "Always-ignored titles"
 *     filtered out. No employee name-matching or attendance lookup — this is
 *     purely a reference view so employees can cross-check what they wrote on
 *     the shared calendar.
 *
 * Mirrors the Vercel serverless function in /api/calendar/events.ts (used in
 * production); this plugin serves the same route on the local Fastify dev server.
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";
import { requirePermission } from "@orbs/authz";
import { fetchEventsInRange } from "../services/google-calendar.js";

export async function calendarRoutes(app: FastifyInstance) {
  app.get(
    "/events",
    { preHandler: [requirePermission("attendance.view_self")] },
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
  );
}
