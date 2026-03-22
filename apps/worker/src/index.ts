/**
 * Worker Process
 *
 * Handles scheduled background tasks:
 *   - Auto-logout events
 *   - Daily attendance processing
 *
 * In a more advanced setup, this would use BullMQ queues.
 * For now, it runs on a simple interval.
 */

import { prisma } from "@orbs/db";
import dayjs from "dayjs";

import { processDailyAttendance } from "./jobs/daily-attendance.js";

// ─── Check auto-logout ──────────────────────────────────────────────

async function checkAutoLogout() {
  console.log("[Worker] Checking auto-logout...");

  const orgs = await prisma.org.findMany({
    where: { autoLogoutEnabled: true },
  });

  for (const org of orgs) {
    if (!org.autoLogoutTime) continue;

    const now = dayjs();
    const [hours, minutes] = org.autoLogoutTime.split(":").map(Number);
    const logoutTime = now.hour(hours).minute(minutes);

    if (Math.abs(now.diff(logoutTime, "minute")) > 5) continue;

    const today = now.format("YYYY-MM-DD");

    // Get today's clock-in events that don't have a corresponding auto-logout
    const clockIns = await prisma.attendanceEvent.findMany({
      where: {
        orgId: org.id,
        eventType: "CLOCK_IN",
        serverTimestamp: {
          gte: new Date(`${today}T00:00:00Z`),
          lte: new Date(`${today}T23:59:59Z`),
        },
      },
    });

    for (const clockIn of clockIns) {
      // Check if already auto-logged out
      const existing = await prisma.attendanceEvent.findFirst({
        where: {
          orgId: org.id,
          employeeId: clockIn.employeeId,
          eventType: "AUTO_LOGOUT",
          serverTimestamp: {
            gte: new Date(`${today}T00:00:00Z`),
          },
        },
      });

      if (existing) continue;

      // Create auto-logout event
      await prisma.attendanceEvent.create({
        data: {
          orgId: org.id,
          employeeId: clockIn.employeeId,
          siteId: clockIn.siteId,
          eventType: "AUTO_LOGOUT",
          source: "SYSTEM",
          createdByUserId: clockIn.createdByUserId,
          requestId: crypto.randomUUID(),
          notes: `Auto-logout at ${org.autoLogoutTime}`,
        },
      });
    }
  }
}

// ─── Run loop ───────────────────────────────────────────────────────

const INTERVAL = 5 * 60 * 1000; // 5 minutes

async function run() {
  console.log("[Worker] Starting worker process...");

  const tick = async () => {
    try {
      await checkAutoLogout();
      await processDailyAttendance();
    } catch (err) {
      console.error("[Worker] Error:", err);
    }
  };

  await tick();
  setInterval(tick, INTERVAL);
}

run().catch(console.error);
