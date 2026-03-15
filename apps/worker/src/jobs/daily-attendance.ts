/**
 * Daily Attendance Automation Job
 *
 * Runs at end of workday (~17:00) to auto-fill attendance records.
 * Calendar-based absences are now handled separately by the morning
 * calendar-digest job — the admin reviews and confirms them before
 * this job runs, so by 17:00 confirmed entries already exist.
 *
 *   Monday & Wednesday (WFH days):
 *     - Employee already has an entry (confirmed by admin or manual) → skip
 *     - No entry AND today's digest is SUBMITTED → mark PRESENT (no absence noted)
 *     - No entry AND digest still PENDING → leave blank (admin hasn't reviewed yet)
 *     - No calendar configured → mark PRESENT (old behaviour)
 *
 *   Sunday, Tuesday & Thursday (Office days):
 *     - Check HikVision for building sign-in → mark PRESENT
 *     - No HikVision, no existing entry → send confirmation email to employee
 *
 *   Friday & Saturday: skipped (Israeli work week weekend)
 *
 * Manual entries always take priority.
 */

import { prisma } from "@orbs/db";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import crypto from "crypto";

import { checkEmployeeSignIn, getHikVisionConfig } from "../services/hikvision.js";
import { sendPresenceConfirmationEmail } from "./confirm-presence.js";

dayjs.extend(utc);
dayjs.extend(timezone);

// ─── Constants ───────────────────────────────────────────────────────

const WFH_DAYS = new Set([1, 3]);    // Monday, Wednesday
const OFFICE_DAYS = new Set([0, 2, 4]); // Sunday, Tuesday, Thursday
const WEEKEND_DAYS = new Set([5, 6]); // Friday, Saturday

// ─── Types ───────────────────────────────────────────────────────────

interface ProcessingStats {
  processed: number;
  skippedExisting: number;
  markedPresent: number;
  emailsSent: number;
  skippedPendingDigest: number;
  errors: number;
}

// ─── Main entry point ────────────────────────────────────────────────

export async function processDailyAttendance(): Promise<void> {
  const enabled = process.env.DAILY_ATTENDANCE_ENABLED === "true";
  if (!enabled) {
    console.log("[DailyAttendance] Disabled — set DAILY_ATTENDANCE_ENABLED=true to enable");
    return;
  }

  const configuredTime = process.env.DAILY_ATTENDANCE_TIME ?? "17:00";
  const now = dayjs();

  const orgs = await prisma.org.findMany();

  for (const org of orgs) {
    try {
      const orgNow = now.tz(org.timezone);
      const [hours, minutes] = configuredTime.split(":").map(Number);
      const targetTime = orgNow.hour(hours).minute(minutes);

      if (Math.abs(orgNow.diff(targetTime, "minute")) > 5) continue;

      await processOrganization(org.id, org.timezone);
    } catch (error) {
      console.error(`[DailyAttendance] Error processing org ${org.id}:`, error);
    }
  }
}

// ─── Per-organization processing ─────────────────────────────────────

async function processOrganization(orgId: string, timezone: string): Promise<void> {
  const today = dayjs().tz(timezone);
  const dayOfWeek = today.day();
  const dateStr = today.format("YYYY-MM-DD");

  if (WEEKEND_DAYS.has(dayOfWeek)) {
    console.log(`[DailyAttendance] Skipping weekend (${today.format("dddd")}) for org ${orgId}`);
    return;
  }

  console.log(`[DailyAttendance] Processing org ${orgId} for ${dateStr} (${today.format("dddd")})`);

  const systemUserId = process.env.SYSTEM_USER_ID;
  const hikConfig = getHikVisionConfig();
  const calendarConfigured = !!process.env.GOOGLE_CALENDAR_ID;

  if (!systemUserId) {
    console.error("[DailyAttendance] SYSTEM_USER_ID not set — cannot create events");
    return;
  }

  // Check if today's digest has been submitted (only relevant on WFH days with calendar)
  let digestSubmitted = false;
  if (calendarConfigured && WFH_DAYS.has(dayOfWeek)) {
    const digest = await prisma.calendarDigest.findUnique({
      where: { orgId_date: { orgId, date: dateStr } },
      select: { status: true },
    });
    digestSubmitted = digest?.status === "SUBMITTED";
  }

  const employees = await prisma.employee.findMany({
    where: { orgId, isActive: true },
    include: { user: true },
  });

  const stats: ProcessingStats = {
    processed: 0,
    skippedExisting: 0,
    markedPresent: 0,
    emailsSent: 0,
    skippedPendingDigest: 0,
    errors: 0,
  };

  for (const employee of employees) {
    try {
      stats.processed++;

      const hasExisting = await employeeHasEntryForDate(employee.id, dateStr);
      if (hasExisting) {
        stats.skippedExisting++;
        continue;
      }

      if (WFH_DAYS.has(dayOfWeek)) {
        if (!calendarConfigured || digestSubmitted) {
          // No calendar, or admin reviewed and found no absence for this employee → PRESENT
          await createAttendanceEvent(orgId, employee.id, employee.siteId, dateStr, "PRESENT", "SYSTEM", systemUserId);
          stats.markedPresent++;
        } else {
          // Calendar configured but digest not yet reviewed — leave blank
          stats.skippedPendingDigest++;
        }
      } else if (OFFICE_DAYS.has(dayOfWeek)) {
        if (hikConfig) {
          const signIn = await checkEmployeeSignIn(hikConfig, employee.id, dateStr);
          if (signIn?.signedIn) {
            await createAttendanceEvent(orgId, employee.id, employee.siteId, dateStr, "PRESENT", "HIKVISION", systemUserId);
            stats.markedPresent++;
            console.log(`[DailyAttendance] HikVision sign-in: ${employee.firstName} ${employee.lastName} → PRESENT`);
            continue;
          }
        }

        // No HikVision sign-in and no existing entry → ask employee
        try {
          await sendPresenceConfirmationEmail(employee.email, employee.firstName, dateStr);
          stats.emailsSent++;
          console.log(`[DailyAttendance] Confirmation email sent: ${employee.firstName} ${employee.lastName}`);
        } catch (error) {
          console.error(`[DailyAttendance] Failed to send email to ${employee.email}:`, error);
        }
      }
    } catch (error) {
      stats.errors++;
      console.error(
        `[DailyAttendance] Error processing employee ${employee.firstName} ${employee.lastName}:`,
        error,
      );
    }
  }

  console.log(
    `[DailyAttendance] Org ${orgId} done — ` +
      `processed: ${stats.processed}, skipped: ${stats.skippedExisting}, ` +
      `present: ${stats.markedPresent}, emails: ${stats.emailsSent}, ` +
      `pending digest: ${stats.skippedPendingDigest}, errors: ${stats.errors}`,
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function employeeHasEntryForDate(employeeId: string, dateStr: string): Promise<boolean> {
  const dayStart = new Date(`${dateStr}T00:00:00Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59Z`);

  const existing = await prisma.attendanceEvent.findFirst({
    where: {
      employeeId,
      eventType: "CLOCK_IN",
      serverTimestamp: { gte: dayStart, lte: dayEnd },
    },
    select: { id: true },
  });

  return existing !== null;
}

async function createAttendanceEvent(
  orgId: string,
  employeeId: string,
  siteId: string,
  dateStr: string,
  status: string,
  source: string,
  createdByUserId: string,
): Promise<void> {
  await prisma.attendanceEvent.create({
    data: {
      orgId,
      employeeId,
      siteId,
      eventType: "CLOCK_IN",
      source,
      serverTimestamp: new Date(`${dateStr}T09:00:00Z`),
      createdByUserId,
      requestId: crypto.randomUUID(),
      notes: status,
    },
  });
}
