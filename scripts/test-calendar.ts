/**
 * Test script for Google Calendar integration
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/test-calendar.ts
 *
 * What it does:
 *   1. Verifies your service account credentials are valid
 *   2. Connects to your shared calendar
 *   3. Fetches today's events
 *   4. Tests absence keyword matching against each event
 *
 * Run this before enabling the automation to confirm everything is wired up.
 */

import { google } from "googleapis";

const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

// ─── Keyword matching (mirrors the actual service) ───────────────────

const STATUS_KEYWORDS = [
  { keywords: ["sick", "ill", "medical", "doctor", "appointment"], status: "SICK" },
  { keywords: ["vacation", "annual leave", "holiday", "pto", "time off", "day off"], status: "VACATION" },
  { keywords: ["reserves", "reserve duty", "miluim"], status: "RESERVES" },
  { keywords: ["half day", "half-day", "halfday", "partial"], status: "HALF_DAY" },
];

const GENERAL_ABSENCE_KEYWORDS = [
  "absent", "off", "not working", "not present", "unavailable", "out of office", "ooo",
];

function extractStatus(text: string): string | null {
  for (const { keywords, status } of STATUS_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw))) return status;
  }
  if (GENERAL_ABSENCE_KEYWORDS.some((kw) => text.includes(kw))) return "VACATION";
  return null;
}

// ─── Main test ───────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════");
  console.log("  Google Calendar Integration Test");
  console.log("══════════════════════════════════════════\n");

  // 1. Check env vars
  console.log("── Step 1: Checking environment variables ──");
  if (!SERVICE_ACCOUNT_JSON) {
    console.error("❌  GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON is not set in .env");
    process.exit(1);
  }
  if (!CALENDAR_ID) {
    console.error("❌  GOOGLE_CALENDAR_ID is not set in .env");
    process.exit(1);
  }
  console.log("✅  GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON is set");
  console.log(`✅  GOOGLE_CALENDAR_ID = ${CALENDAR_ID}\n`);

  // 2. Parse service account credentials
  console.log("── Step 2: Parsing service account credentials ──");
  let credentials: any;
  try {
    credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
    console.log(`✅  Service account email: ${credentials.client_email}`);
    console.log(`✅  Project ID: ${credentials.project_id}\n`);
  } catch (err) {
    console.error("❌  Failed to parse GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON — is it valid JSON?");
    console.error(err);
    process.exit(1);
  }

  // 3. Initialize Google Calendar client
  console.log("── Step 3: Connecting to Google Calendar API ──");
  let calendar: any;
  try {
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });
    calendar = google.calendar({ version: "v3", auth });
    console.log("✅  Calendar client initialized\n");
  } catch (err) {
    console.error("❌  Failed to initialize Google Calendar client");
    console.error(err);
    process.exit(1);
  }

  // 4. Fetch today's events
  console.log("── Step 4: Fetching today's calendar events ──");
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  console.log(`    Checking date: ${today}`);

  let events: any[] = [];
  try {
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(`${today}T00:00:00Z`).toISOString(),
      timeMax: new Date(`${today}T23:59:59Z`).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    events = response.data.items ?? [];
    console.log(`✅  Successfully connected to calendar`);
    console.log(`    Found ${events.length} event(s) today\n`);
  } catch (err: any) {
    console.error("❌  Failed to fetch calendar events");
    if (err?.message?.includes("Not Found")) {
      console.error(`    Calendar ID not found — check GOOGLE_CALENDAR_ID is correct`);
      console.error(`    Also make sure the calendar is shared with: ${credentials.client_email}`);
    } else if (err?.message?.includes("invalid_grant") || err?.message?.includes("unauthorized")) {
      console.error(`    Authentication failed — check your service account key is correct and the Calendar API is enabled`);
    } else {
      console.error(err?.message ?? err);
    }
    process.exit(1);
  }

  // 5. Show events and test keyword matching
  console.log("── Step 5: Testing keyword matching on today's events ──");
  if (events.length === 0) {
    console.log("    No events today — this is fine!");
    console.log("    To test keyword matching, add a test event like:");
    console.log('    "Josh - Sick" or "Josh Absent" to the shared calendar\n');
  } else {
    for (const event of events) {
      const title = event.summary ?? "(no title)";
      const description = event.description ?? "";
      const searchText = `${title} ${description}`.toLowerCase();
      const status = extractStatus(searchText);

      console.log(`    📅 "${title}"`);
      if (status) {
        console.log(`       → Matched absence: ${status}`);
      } else {
        console.log(`       → No absence keyword detected (not an absence event)`);
      }
    }
    console.log();
  }

  // 6. Test a specific employee name (optional)
  const testName = process.argv[2];
  if (testName) {
    console.log(`── Step 6: Checking for absence events matching "${testName}" ──`);
    const [firstName, ...rest] = testName.split(" ");
    const fullName = testName.toLowerCase();
    const matches = events.filter((event) => {
      const title = (event.summary ?? "").toLowerCase();
      return title.includes(firstName.toLowerCase()) || title.includes(fullName);
    });

    if (matches.length === 0) {
      console.log(`    No events found mentioning "${testName}" today`);
      console.log(`    (If they're working, this is correct — they'll be marked PRESENT on WFH days)`);
    } else {
      for (const event of matches) {
        const title = event.summary ?? "";
        const status = extractStatus(`${title} ${event.description ?? ""}`.toLowerCase());
        console.log(`    Found: "${title}" → ${status ?? "no absence keyword"}`);
      }
    }
    console.log();
  }

  console.log("══════════════════════════════════════════");
  console.log("  All checks passed! ✅");
  console.log("══════════════════════════════════════════");
  console.log();
  console.log("Tip: To test with a specific employee name, run:");
  console.log('  npx tsx --env-file=.env scripts/test-calendar.ts "Josh Kohn"');
  console.log();
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
