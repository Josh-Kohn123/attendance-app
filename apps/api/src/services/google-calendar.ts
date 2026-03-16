/**
 * Google Calendar Integration Service (API-side)
 *
 * Fetches events from a shared Google Calendar for a date range.
 * Uses a Google service account for authentication.
 * Replicates the worker's google-calendar.ts logic for use in authenticated API endpoints.
 */

import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import type { DayStatus } from "@orbs/shared";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

export interface RawCalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
}

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  [key: string]: unknown;
}

// ─── Keyword → Status mapping ────────────────────────────────────────

const STATUS_KEYWORDS: Array<{ keywords: string[]; status: DayStatus }> = [
  { keywords: ["sick", "ill", "medical", "doctor", "appointment"], status: "SICK" },
  { keywords: ["child sick", "child-sick", "childsick"], status: "CHILD_SICK" },
  { keywords: ["vacation", "annual leave", "holiday", "pto", "time off", "day off"], status: "VACATION" },
  { keywords: ["reserves", "reserve duty", "miluim"], status: "RESERVES" },
  { keywords: ["half day", "half-day", "halfday", "partial"], status: "HALF_DAY" },
  { keywords: ["work from home", "wfh", "remote"], status: "WORK_FROM_HOME" },
];

const GENERAL_ABSENCE_KEYWORDS = [
  "absent", "off", "not working", "not present", "unavailable", "out of office", "ooo",
];

// ─── Calendar client ─────────────────────────────────────────────────

let calendarClient: calendar_v3.Calendar | null = null;

function getCalendarClient(): calendar_v3.Calendar | null {
  if (calendarClient) return calendarClient;

  const serviceAccountJson = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    console.warn("[GoogleCalendar] GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON not set");
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

/**
 * Fetch all calendar events for a date range.
 * Google Calendar returns all-day event end dates as exclusive, so we adjust.
 */
export async function fetchEventsInRange(
  calendarId: string,
  fromDate: string,
  toDate: string,
  orgTimezone: string,
): Promise<RawCalendarEvent[]> {
  const client = getCalendarClient();
  if (!client) return [];

  try {
    const timeMin = dayjs.tz(`${fromDate} 00:00:00`, orgTimezone).toISOString();
    const timeMax = dayjs.tz(`${toDate} 23:59:59`, orgTimezone).toISOString();

    const allEvents: RawCalendarEvent[] = [];
    let pageToken: string | undefined;

    do {
      const response = await client.events.list({
        calendarId,
        timeMin,
        timeMax,
        timeZone: orgTimezone,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });

      const events = response.data.items ?? [];
      for (const event of events) {
        if (!event.id || !event.summary) continue;

        let startDate: string;
        let endDate: string;

        if (event.start?.date) {
          startDate = event.start.date;
          const exclusiveEnd = new Date(event.end!.date!);
          exclusiveEnd.setDate(exclusiveEnd.getDate() - 1);
          endDate = exclusiveEnd.toISOString().slice(0, 10);
        } else if (event.start?.dateTime) {
          startDate = event.start.dateTime.slice(0, 10);
          endDate = (event.end?.dateTime ?? event.start.dateTime).slice(0, 10);
        } else {
          continue;
        }

        allEvents.push({ id: event.id, title: event.summary, startDate, endDate });
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return allEvents;
  } catch (error) {
    console.error(`[GoogleCalendar] Error fetching events for ${fromDate}→${toDate}:`, error);
    return [];
  }
}

/**
 * Extract a DayStatus from text based on keyword matching.
 */
export function extractAbsenceStatus(text: string): DayStatus | null {
  const lower = text.toLowerCase();
  for (const { keywords, status } of STATUS_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return status;
    }
  }
  if (GENERAL_ABSENCE_KEYWORDS.some((kw) => lower.includes(kw))) {
    return "VACATION";
  }
  return null;
}
