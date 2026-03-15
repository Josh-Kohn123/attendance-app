/**
 * Calendar Digest — manual test runner
 *
 * Bypasses the time-window check and runs the full digest pipeline right now:
 *   1. Checks env vars and org configuration
 *   2. Deletes any existing digest record for today (so idempotency doesn't block)
 *   3. Fetches today's Google Calendar events
 *   4. Builds digest entries and sends the email
 *
 * Usage (from repo root):
 *   npx tsx --env-file=../../.env apps/worker/src/test-digest.ts
 *
 * Or from apps/worker/:
 *   npx tsx --env-file=../../.env src/test-digest.ts
 */

import { prisma } from "@orbs/db";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

import { fetchDayEvents } from "./services/google-calendar.js";

dayjs.extend(utc);
dayjs.extend(timezone);

// ─── Colour helpers ────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function ok(msg: string) { console.log(`${c.green}✓${c.reset} ${msg}`); }
function warn(msg: string) { console.log(`${c.yellow}⚠${c.reset} ${msg}`); }
function fail(msg: string) { console.log(`${c.red}✗${c.reset} ${msg}`); }
function info(msg: string) { console.log(`${c.cyan}→${c.reset} ${msg}`); }
function section(msg: string) { console.log(`\n${c.bold}${msg}${c.reset}`); }

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold}${c.cyan}Calendar Digest Test Runner${c.reset}`);
  console.log(`${c.dim}${new Date().toISOString()}${c.reset}\n`);

  // ── 1. Env vars ──────────────────────────────────────────────────────
  section("1. Environment variables");

  const enabled = process.env.DAILY_ATTENDANCE_ENABLED;
  if (enabled !== "true") {
    warn(`DAILY_ATTENDANCE_ENABLED="${enabled}" — digest is disabled. Set to "true" in .env`);
  } else {
    ok(`DAILY_ATTENDANCE_ENABLED=true`);
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    fail("GOOGLE_CALENDAR_ID is not set — cannot fetch calendar events");
    process.exit(1);
  }
  ok(`GOOGLE_CALENDAR_ID=${calendarId}`);

  const serviceAccountJson = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    fail("GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON is not set");
    process.exit(1);
  }
  ok(`GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON is set`);

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  const gmailOAuth = process.env.GMAIL_OAUTH_CLIENT_ID;
  if (!gmailUser) {
    fail("GMAIL_USER is not set");
    process.exit(1);
  }
  ok(`GMAIL_USER=${gmailUser}`);
  if (gmailOAuth) {
    ok(`Email auth: OAuth2 (GMAIL_OAUTH_CLIENT_ID is set)`);
  } else if (gmailPass) {
    ok(`Email auth: App Password (GMAIL_APP_PASSWORD is set)`);
  } else {
    fail("No email auth configured — set GMAIL_APP_PASSWORD or GMAIL_OAUTH_CLIENT_ID");
    process.exit(1);
  }

  const digestTime = process.env.CALENDAR_DIGEST_TIME ?? "08:00";
  ok(`CALENDAR_DIGEST_TIME=${digestTime}`);

  // ── 2. Org configuration ─────────────────────────────────────────────
  section("2. Organisation configuration");

  const orgs = await prisma.org.findMany({
    include: {
      calendarDigestAdminUser: { select: { id: true, email: true, displayName: true } },
    },
  });

  if (orgs.length === 0) {
    fail("No organisations found in the database");
    process.exit(1);
  }

  const configuredOrgs = orgs.filter((o) => o.calendarDigestAdminUser !== null);

  for (const org of orgs) {
    if (org.calendarDigestAdminUser) {
      ok(
        `Org "${org.name}" (${org.timezone}) → admin: ${org.calendarDigestAdminUser.email}`,
      );
    } else {
      warn(
        `Org "${org.name}" has no calendarDigestAdminUserId set — ` +
          `go to Administration → Policies to configure one`,
      );
    }
  }

  if (configuredOrgs.length === 0) {
    fail("No orgs have a calendarDigestAdminUserId configured — cannot run digest");
    process.exit(1);
  }

  // ── 3. Per-org test ──────────────────────────────────────────────────
  for (const org of configuredOrgs) {
    const admin = org.calendarDigestAdminUser!;
    const today = dayjs().tz(org.timezone).format("YYYY-MM-DD");

    section(`3. Testing org "${org.name}" — ${today}`);

    // Clear any existing digest for today so we can re-run
    const existing = await prisma.calendarDigest.findUnique({
      where: { orgId_date: { orgId: org.id, date: today } },
    });
    if (existing) {
      info(`Deleting existing digest record for today (id: ${existing.id}) so test can run fresh`);
      await prisma.calendarDigest.deleteMany({
        where: { orgId: org.id, date: today },
      });
      ok(`Cleared existing digest`);
    }

    // ── 4. Fetch calendar events ───────────────────────────────────────
    section("4. Fetching Google Calendar events");
    info(`Calendar: ${calendarId}`);
    info(`Date: ${today} (${org.timezone})`);

    let events;
    try {
      events = await fetchDayEvents(calendarId, today, org.timezone);
    } catch (err) {
      fail(`fetchDayEvents threw an error: ${err}`);
      process.exit(1);
    }

    if (events.length === 0) {
      warn(`No events found on ${today}. The digest email won't be sent for empty days.`);
      warn(`Add a test event to the calendar (e.g. "Test - Sick") and re-run.`);

      // Still verify email works by sending a test email
      section("4b. Sending test email (no calendar events)");
      await sendTestEmail(gmailUser, admin.email, org.name, today);
      process.exit(0);
    }

    ok(`Found ${events.length} event(s) on ${today}:`);
    for (const ev of events) {
      console.log(`   ${c.dim}•${c.reset} "${ev.title}"  ${ev.startDate} → ${ev.endDate}`);
    }

    // ── 5. Run the real digest ─────────────────────────────────────────
    section("5. Running digest pipeline");
    info(`Importing processCalendarDigest...`);

    // Temporarily set the digest time to NOW so processCalendarDigest doesn't skip us
    const orgNow = dayjs().tz(org.timezone);
    const fakeTime = orgNow.format("HH:mm");
    process.env.CALENDAR_DIGEST_TIME = fakeTime;
    info(`Set CALENDAR_DIGEST_TIME=${fakeTime} (current org time) to bypass time-window check`);

    const { processCalendarDigest } = await import("./jobs/calendar-digest.js");
    await processCalendarDigest();

    // ── 6. Verify digest was created ──────────────────────────────────
    section("6. Verifying digest record");
    const created = await prisma.calendarDigest.findUnique({
      where: { orgId_date: { orgId: org.id, date: today } },
      include: { entries: true },
    });

    if (!created) {
      fail("Digest record was NOT created — check worker logs above for errors");
      process.exit(1);
    }

    ok(`Digest record created (id: ${created.id})`);
    ok(`Status: ${created.status}`);
    ok(`Entries: ${created.entries.length}`);
    for (const entry of created.entries) {
      const matched = entry.matchType === "MATCHED" ? c.green : c.yellow;
      console.log(
        `   ${matched}•${c.reset} "${entry.eventTitle}"  ` +
          `match=${entry.matchType}  status=${entry.proposedStatus ?? "—"}`,
      );
    }

    section("✅ Done");
    ok(`Check ${admin.email}'s inbox for the digest email`);
    ok(`Review URL: ${process.env.CORS_ORIGIN ?? "http://localhost:5173"}/digest/${created.token}`);
  }

  await prisma.$disconnect();
}

// ─── Send a minimal test email to confirm SMTP works ──────────────────

async function sendTestEmail(
  fromEmail: string,
  toEmail: string,
  orgName: string,
  date: string,
) {
  info(`Sending test email to ${toEmail} to verify SMTP credentials...`);

  const nodemailer = await import("nodemailer");
  let transporter;

  if (process.env.GMAIL_OAUTH_CLIENT_ID) {
    transporter = nodemailer.default.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        type: "OAuth2",
        user: fromEmail,
        clientId: process.env.GMAIL_OAUTH_CLIENT_ID!,
        clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
        refreshToken: process.env.GMAIL_OAUTH_REFRESH_TOKEN!,
      },
    });
  } else {
    transporter = nodemailer.default.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: fromEmail, pass: process.env.GMAIL_APP_PASSWORD! },
    });
  }

  try {
    const info = await transporter.sendMail({
      from: `"${process.env.GMAIL_FROM_NAME ?? "Orbs Attendance"}" <${fromEmail}>`,
      to: toEmail,
      subject: `[Attendance] Digest test — ${date}`,
      html: `
        <p>Hi,</p>
        <p>This is a test email from the Orbs Attendance digest runner.</p>
        <p><strong>Org:</strong> ${orgName}</p>
        <p><strong>Date:</strong> ${date}</p>
        <p>No calendar events were found for today, so no real digest was sent.
           SMTP is working correctly if you received this email.</p>
      `,
    });
    ok(`Test email sent successfully (messageId: ${info.messageId})`);
  } catch (err: any) {
    fail(`SMTP send failed: ${err?.message ?? err}`);
    if (err?.responseCode === 535) {
      fail("Authentication error — double-check GMAIL_APP_PASSWORD or OAuth credentials");
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${c.red}Fatal error:${c.reset}`, err);
  process.exit(1);
});
