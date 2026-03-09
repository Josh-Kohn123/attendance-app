/**
 * Calendar Digest Job
 *
 * Runs once each morning (CALENDAR_DIGEST_TIME, default 08:00) per org.
 * Reads the shared Google Calendar, classifies each event against the
 * employee roster, and emails the designated admin a link to a review
 * page where they can confirm or decline each proposed change before
 * anything is written to attendance records.
 *
 * Match types:
 *   MATCHED           — single employee + known absence keyword
 *   AMBIGUOUS_NAME    — multiple employees share that first name
 *   UNMATCHED         — no employee found (typo, nickname, unknown)
 *   INACTIVE_EMPLOYEE — matched but employee is inactive
 *   UNCLEAR_STATUS    — employee matched, keyword unrecognised
 *
 * Idempotency: only one digest is created per org per day.
 * Multi-day events: a single entry covers the full date range; once
 *   confirmed, attendance records are created for every workday in that
 *   span. On subsequent days the worker skips events already in a prior
 *   confirmed digest entry for the same eventId.
 */

import { prisma } from "@orbs/db";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

import { fetchDayEvents } from "../services/google-calendar.js";
import { extractAbsenceStatus } from "../services/google-calendar.js";

dayjs.extend(utc);
dayjs.extend(timezone);

// ─── Email transporter (same pattern as worker/index.ts) ─────────────

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (process.env.GMAIL_OAUTH_CLIENT_ID) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        type: "OAuth2",
        user: process.env.GMAIL_USER!,
        clientId: process.env.GMAIL_OAUTH_CLIENT_ID!,
        clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
        refreshToken: process.env.GMAIL_OAUTH_REFRESH_TOKEN!,
      },
    });
  } else {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER!,
        pass: process.env.GMAIL_APP_PASSWORD!,
      },
    });
  }

  return transporter;
}

// ─── Main entry point ────────────────────────────────────────────────

export async function processCalendarDigest(): Promise<void> {
  const enabled = process.env.DAILY_ATTENDANCE_ENABLED === "true";
  if (!enabled) return;

  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) return;

  const configuredTime = process.env.CALENDAR_DIGEST_TIME ?? "08:00";
  const now = dayjs();

  const orgs = await prisma.org.findMany({
    where: { calendarDigestAdminUserId: { not: null } },
    include: {
      calendarDigestAdminUser: { select: { id: true, email: true, displayName: true } },
    },
  });

  for (const org of orgs) {
    try {
      const orgNow = now.tz(org.timezone);
      const [hours, minutes] = configuredTime.split(":").map(Number);
      const targetTime = orgNow.hour(hours).minute(minutes);

      if (Math.abs(orgNow.diff(targetTime, "minute")) > 5) continue;

      await processOrgDigest(org, calendarId);
    } catch (error) {
      console.error(`[CalendarDigest] Error processing org ${org.id}:`, error);
    }
  }
}

// ─── Per-org digest processing ───────────────────────────────────────

async function processOrgDigest(
  org: {
    id: string;
    name: string;
    timezone: string;
    calendarDigestAdminUser: { id: string; email: string; displayName: string } | null;
  },
  calendarId: string,
): Promise<void> {
  const admin = org.calendarDigestAdminUser;
  if (!admin) return;

  const today = dayjs().tz(org.timezone).format("YYYY-MM-DD");

  // Idempotency: skip if digest already sent today
  const existing = await prisma.calendarDigest.findUnique({
    where: { orgId_date: { orgId: org.id, date: today } },
  });
  if (existing) {
    console.log(`[CalendarDigest] Digest already sent for org ${org.id} on ${today}`);
    return;
  }

  // Fetch all calendar events for today
  const events = await fetchDayEvents(calendarId, today, org.timezone);
  if (events.length === 0) {
    console.log(`[CalendarDigest] No events on ${today} for org ${org.id}`);
    return;
  }

  // Fetch all employees for this org (active and inactive, for matching)
  const employees = await prisma.employee.findMany({
    where: { orgId: org.id },
    select: { id: true, firstName: true, lastName: true, isActive: true },
  });

  // Build digest entries from calendar events
  const entryData: Array<{
    eventTitle: string;
    eventId: string;
    startDate: string;
    endDate: string;
    matchType: string;
    proposedEmployeeId?: string;
    proposedStatus?: string;
    candidateEmployeeIds: string[];
  }> = [];

  for (const event of events) {
    // Skip events already covered by a prior confirmed digest entry for the same eventId
    // (handles multi-day events that span across multiple digest days)
    const alreadyHandled = await prisma.calendarDigestEntry.findFirst({
      where: {
        eventId: event.id,
        decision: { not: "DECLINED" },
        digest: { orgId: org.id },
      },
    });
    if (alreadyHandled) continue;

    const titleLower = event.title.toLowerCase();

    // Match event title against employees (first name or full name)
    const matched = employees.filter((emp) => {
      const first = emp.firstName.toLowerCase();
      const full = `${emp.firstName} ${emp.lastName}`.toLowerCase();
      return titleLower.includes(first) || titleLower.includes(full);
    });

    if (matched.length === 0) {
      entryData.push({
        eventTitle: event.title,
        eventId: event.id,
        startDate: event.startDate,
        endDate: event.endDate,
        matchType: "UNMATCHED",
        candidateEmployeeIds: [],
      });
      continue;
    }

    if (matched.length > 1) {
      entryData.push({
        eventTitle: event.title,
        eventId: event.id,
        startDate: event.startDate,
        endDate: event.endDate,
        matchType: "AMBIGUOUS_NAME",
        candidateEmployeeIds: matched.map((e) => e.id),
      });
      continue;
    }

    const employee = matched[0];

    if (!employee.isActive) {
      entryData.push({
        eventTitle: event.title,
        eventId: event.id,
        startDate: event.startDate,
        endDate: event.endDate,
        matchType: "INACTIVE_EMPLOYEE",
        proposedEmployeeId: employee.id,
        candidateEmployeeIds: [],
      });
      continue;
    }

    const status = extractAbsenceStatus(titleLower);

    if (!status) {
      entryData.push({
        eventTitle: event.title,
        eventId: event.id,
        startDate: event.startDate,
        endDate: event.endDate,
        matchType: "UNCLEAR_STATUS",
        proposedEmployeeId: employee.id,
        candidateEmployeeIds: [],
      });
    } else {
      entryData.push({
        eventTitle: event.title,
        eventId: event.id,
        startDate: event.startDate,
        endDate: event.endDate,
        matchType: "MATCHED",
        proposedEmployeeId: employee.id,
        proposedStatus: status,
        candidateEmployeeIds: [],
      });
    }
  }

  if (entryData.length === 0) {
    console.log(`[CalendarDigest] All events already handled for org ${org.id} on ${today}`);
    return;
  }

  // Create digest record and entries
  const digest = await prisma.calendarDigest.create({
    data: {
      orgId: org.id,
      date: today,
      entries: {
        create: entryData,
      },
    },
  });

  // Send email to admin
  const frontendUrl = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  const reviewUrl = `${frontendUrl}/digest/${digest.token}`;

  await sendDigestEmail(admin.email, admin.displayName, org.name, today, entryData, reviewUrl);

  console.log(
    `[CalendarDigest] Digest sent to ${admin.email} for org ${org.id} on ${today} ` +
      `(${entryData.length} events, token: ${digest.token})`,
  );
}

// ─── Email ───────────────────────────────────────────────────────────

async function sendDigestEmail(
  adminEmail: string,
  adminName: string,
  orgName: string,
  date: string,
  entries: Array<{
    eventTitle: string;
    matchType: string;
    proposedStatus?: string;
    candidateEmployeeIds: string[];
  }>,
  reviewUrl: string,
): Promise<void> {
  const fromName = process.env.GMAIL_FROM_NAME ?? "Orbs Attendance";
  const fromEmail = process.env.GMAIL_USER ?? "noreply@orbs.com";
  const firstName = adminName.split(" ")[0];

  const matchLabel: Record<string, string> = {
    MATCHED: "Proposed",
    AMBIGUOUS_NAME: "Ambiguous — needs clarification",
    UNMATCHED: "No employee found",
    INACTIVE_EMPLOYEE: "Inactive employee",
    UNCLEAR_STATUS: "Status unclear",
  };

  const statusLabel: Record<string, string> = {
    SICK: "Sick",
    VACATION: "Vacation",
    RESERVES: "Reserves (Miluim)",
    HALF_DAY: "Half Day",
    PRESENT: "Present",
  };

  const rows = entries
    .map(
      (e) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;">${e.eventTitle}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">${matchLabel[e.matchType] ?? e.matchType}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">${e.proposedStatus ? statusLabel[e.proposedStatus] ?? e.proposedStatus : "—"}</td>
    </tr>`,
    )
    .join("");

  await getTransporter().sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: adminEmail,
    subject: `[Attendance] Calendar digest for ${date} — action required`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background-color:#2563eb;padding:24px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${orgName} — Attendance</h1>
        </td></tr>
        <tr><td style="padding:28px 32px 16px;">
          <h2 style="margin:0 0 8px;color:#111827;font-size:17px;">Calendar digest for ${date}</h2>
          <p style="color:#374151;line-height:1.6;margin:0 0 20px;">
            Hi ${firstName}, the shared calendar has ${entries.length} event${entries.length === 1 ? "" : "s"} for today.
            Please review the proposed actions below and confirm before they are applied to attendance records.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <thead>
              <tr style="background-color:#f9fafb;">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Calendar Event</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Match</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Proposed Action</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </td></tr>
        <tr><td style="padding:16px 32px 28px;text-align:center;">
          <a href="${reviewUrl}"
             style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:13px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
            Review &amp; Confirm Changes
          </a>
          <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;">
            No changes will be applied until you confirm on the review page.
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">This is an automated message from Orbs Attendance.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}
