/**
 * Google Calendar Integration Service
 *
 * Reads a shared org-wide Google Calendar to detect employee absences.
 * Uses a Google service account for authentication (no user interaction needed).
 *
 * Calendar convention: employees write events like "Josh - Sick" or "Josh Absent"
 * on the shared calendar. This service matches employee names + absence keywords.
 */

import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import type { DayStatus } from "@orbs/shared";

// ─── Types ───────────────────────────────────────────────────────────

export interface CalendarAbsence {
  status: DayStatus;
  eventTitle: string;
  eventId: string;
}

export interface RawCalendarEvent {
  id: string;
  title: string;
  startDate: string; // YYYY-MM-DD (inclusive)
  endDate: string;   // YYYY-MM-DD (inclusive, already adjusted from Google's exclusive end)
}

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  [key: string]: unknown;
}

// ─── Keyword → Status mapping ────────────────────────────────────────

const STATUS_KEYWORDS: Array<{ keywords: string[]; status: DayStatus }> = [
  { keywords: ["sick", "ill", "medical", "doctor", "appointment"], status: "SICK" },
  { keywords: ["vacation", "annual leave", "holiday", "pto", "time off", "day off"], status: "VACATION" },
  { keywords: ["reserves", "reserve duty", "miluim"], status: "RESERVES" },
  { keywords: ["half day", "half-day", "halfday", "partial"], status: "HALF_DAY" },
];

// Catch-all absence keywords (if no specific type matches, defaults to VACATION)
const GENERAL_ABSENCE_KEYWORDS = [
  "absent", "off", "not working", "not present", "unavailable", "out of office", "ooo",
];

// ─── Calendar client ─────────────────────────────────────────────────

let calendarClient: calendar_v3.Calendar | null = null;

function getCalendarClient(): calendar_v3.Calendar | null {
  if (calendarClient) return calendarClient;

  const serviceAccountJson = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    console.warn("[GoogleCalendar] GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON not set — skipping calendar integration");
    return null;
  }

  try {
    const credentials: ServiceAccountCredentials = JSON.parse(serviceAccountJson);

    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });

    calendarClient = google.calendar({ version: "v3", auth });
    return calendarClient;
  } catch (error) {
    console.error("[GoogleCalendar] Failed to initialize calendar client:", error);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Search the shared calendar for an absence event matching the given employee.
 *
 * @param calendarId - The shared Google Calendar ID
 * @param date       - The date to check (YYYY-MM-DD)
 * @param timezone   - IANA timezone string (e.g. "Asia/Jerusalem")
 * @param employeeFirstName - Employee's first name to match in event titles
 * @param employeeFullName  - Employee's full name to match in event titles
 * @returns Absence info if found, or null if no matching absence event
 */
export async function findEmployeeAbsence(
  calendarId: string,
  date: string,
  timezone: string,
  employeeFirstName: string,
  employeeFullName: string,
): Promise<CalendarAbsence | null> {
  const client = getCalendarClient();
  if (!client) return null;

  try {
    const timeMin = `${date}T00:00:00`;
    const timeMax = `${date}T23:59:59`;

    const response = await client.events.list({
      calendarId,
      timeMin: new Date(`${timeMin}+00:00`).toISOString(),
      timeMax: new Date(`${timeMax}+00:00`).toISOString(),
      timeZone: timezone,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 100,
    });

    const events = response.data.items ?? [];

    for (const event of events) {
      const title = (event.summary ?? "").toLowerCase();
      const description = (event.description ?? "").toLowerCase();
      const searchText = `${title} ${description}`;

      // Check if this event mentions the employee (by first name or full name)
      const firstNameMatch = title.includes(employeeFirstName.toLowerCase());
      const fullNameMatch = title.includes(employeeFullName.toLowerCase());

      if (!firstNameMatch && !fullNameMatch) continue;

      // Try to extract a specific status from keywords
      const status = extractStatus(searchText);
      if (status) {
        return {
          status,
          eventTitle: event.summary ?? "",
          eventId: event.id ?? "",
        };
      }
    }

    return null;
  } catch (error) {
    console.error(`[GoogleCalendar] Error fetching events for ${date}:`, error);
    return null;
  }
}

/**
 * Fetch all calendar events for a given date.
 * Used by the digest job to get everything on the shared calendar for a day.
 *
 * Google Calendar returns all-day event end dates as exclusive (next day),
 * so we subtract one day to get the inclusive end date.
 */
export async function fetchDayEvents(
  calendarId: string,
  date: string,
  timezone: string,
): Promise<RawCalendarEvent[]> {
  const client = getCalendarClient();
  if (!client) return [];

  try {
    const response = await client.events.list({
      calendarId,
      timeMin: new Date(`${date}T00:00:00Z`).toISOString(),
      timeMax: new Date(`${date}T23:59:59Z`).toISOString(),
      timeZone: timezone,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    const events = response.data.items ?? [];
    const results: RawCalendarEvent[] = [];

    for (const event of events) {
      if (!event.id || !event.summary) continue;

      // Parse start/end dates — handle both all-day and timed events
      let startDate: string;
      let endDate: string;

      if (event.start?.date) {
        // All-day event: start.date and end.date (end is exclusive)
        startDate = event.start.date;
        const exclusiveEnd = new Date(event.end!.date!);
        exclusiveEnd.setDate(exclusiveEnd.getDate() - 1);
        endDate = exclusiveEnd.toISOString().slice(0, 10);
      } else if (event.start?.dateTime) {
        // Timed event: use just the date portion
        startDate = event.start.dateTime.slice(0, 10);
        endDate = (event.end?.dateTime ?? event.start.dateTime).slice(0, 10);
      } else {
        continue;
      }

      results.push({
        id: event.id,
        title: event.summary,
        startDate,
        endDate,
      });
    }

    return results;
  } catch (error) {
    console.error(`[GoogleCalendar] Error fetching events for ${date}:`, error);
    return [];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract a DayStatus from text based on keyword matching.
 * Returns VACATION as default if only general absence keywords match.
 * Exported for use by the calendar digest job.
 */
export function extractAbsenceStatus(text: string): DayStatus | null {
  return extractStatus(text);
}

function extractStatus(text: string): DayStatus | null {
  // Check specific status keywords first
  for (const { keywords, status } of STATUS_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw))) {
      return status;
    }
  }

  // Check general absence keywords (defaults to VACATION)
  if (GENERAL_ABSENCE_KEYWORDS.some((kw) => text.includes(kw))) {
    return "VACATION";
  }

  return null;
}
