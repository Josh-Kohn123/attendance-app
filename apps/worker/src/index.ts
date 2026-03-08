/**
 * Worker Process
 *
 * Handles scheduled background tasks with direct Gmail email sending:
 *   - Daily reminder checks (which employees haven't clocked in)
 *   - Auto-logout events
 *   - Scheduled report generation triggers
 *
 * In a more advanced setup, this would use BullMQ queues.
 * For now, it runs on a simple interval.
 */

import { prisma } from "@orbs/db";
import dayjs from "dayjs";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

// ─── Email transporter ──────────────────────────────────────────────

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const useOAuth = !!process.env.GMAIL_OAUTH_CLIENT_ID;

  if (useOAuth) {
    transporter = nodemailer.createTransport({
      service: "gmail",
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
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER!,
        pass: process.env.GMAIL_APP_PASSWORD!,
      },
    });
  }

  return transporter;
}

async function sendReminderEmail(to: string, employeeName: string, message: string) {
  try {
    const fromName = process.env.GMAIL_FROM_NAME ?? "Orbs Attendance";
    const fromEmail = process.env.GMAIL_USER ?? "noreply@orbs.com";
    const frontendUrl = process.env.CORS_ORIGIN ?? "http://localhost:5173";

    await getTransporter().sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject: `[Attendance] Reminder — Don't forget to clock in`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background-color:#2563eb;padding:24px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Orbs Attendance</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;color:#111827;font-size:18px;">Attendance Reminder</h2>
          <p style="color:#374151;line-height:1.6;">Hi ${employeeName.split(" ")[0]},</p>
          <p style="color:#374151;line-height:1.6;">${message}</p>
          <p style="margin-top:24px;">
            <a href="${frontendUrl}/clock"
               style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
              Clock In Now
            </a>
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

    console.log(`[Worker] Reminder sent to ${to}`);
  } catch (error) {
    console.error(`[Worker] Reminder send failed for ${to}:`, error);
  }
}

// ─── Check reminders ────────────────────────────────────────────────

async function checkReminders() {
  console.log("[Worker] Checking reminders...");

  const orgs = await prisma.org.findMany({
    where: { reminderEnabled: true },
  });

  for (const org of orgs) {
    if (!org.reminderTime) continue;

    const now = dayjs();
    const [hours, minutes] = org.reminderTime.split(":").map(Number);
    const reminderTime = now.hour(hours).minute(minutes);

    // Only send if we're within 5 minutes of reminder time
    if (Math.abs(now.diff(reminderTime, "minute")) > 5) continue;

    const today = now.format("YYYY-MM-DD");

    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: { orgId: org.id, isActive: true },
      include: { user: true },
    });

    // Get who already clocked in today
    const clockedIn = await prisma.attendanceEvent.findMany({
      where: {
        orgId: org.id,
        eventType: "CLOCK_IN",
        serverTimestamp: {
          gte: new Date(`${today}T00:00:00Z`),
          lte: new Date(`${today}T23:59:59Z`),
        },
      },
      select: { employeeId: true },
    });

    const clockedInIds = new Set(clockedIn.map((e) => e.employeeId));

    // Send reminders to those who haven't clocked in
    for (const emp of employees) {
      if (clockedInIds.has(emp.id)) continue;

      const employeeName = `${emp.firstName} ${emp.lastName}`;
      const message = `Hi ${emp.firstName}, don't forget to clock in today!`;

      await sendReminderEmail(emp.email, employeeName, message);
    }
  }
}

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
      await checkReminders();
      await checkAutoLogout();
    } catch (err) {
      console.error("[Worker] Error:", err);
    }
  };

  await tick();
  setInterval(tick, INTERVAL);
}

run().catch(console.error);
