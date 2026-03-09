/**
 * Presence Confirmation Email
 *
 * Sends an email to employees on office days (Sun/Tue/Thu) when:
 *   - No HikVision sign-in was detected
 *   - No absence event found on Google Calendar
 *
 * The email asks: "Were you present on [date]?"
 * and links to the app where the employee can confirm via the
 * normal calendar-entry flow.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

// ─── Email transporter (reuses worker's existing pattern) ────────────

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const useOAuth = !!process.env.GMAIL_OAUTH_CLIENT_ID;

  if (useOAuth) {
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

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Send a confirmation email to an employee asking if they were present.
 *
 * The email links to the frontend app's calendar page where the employee
 * can mark their attendance for that day through the normal UI flow.
 */
export async function sendPresenceConfirmationEmail(
  employeeEmail: string,
  employeeFirstName: string,
  date: string,
): Promise<void> {
  const fromName = process.env.GMAIL_FROM_NAME ?? "Orbs Attendance";
  const fromEmail = process.env.GMAIL_USER ?? "noreply@orbs.com";
  const frontendUrl = process.env.CORS_ORIGIN ?? "http://localhost:5173";

  // Link to the calendar page with the date pre-selected
  const calendarLink = `${frontendUrl}/calendar?date=${date}`;

  await getTransporter().sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: employeeEmail,
    subject: `[Attendance] Were you present on ${date}?`,
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
          <h2 style="margin:0 0 16px;color:#111827;font-size:18px;">Attendance Confirmation Needed</h2>
          <p style="color:#374151;line-height:1.6;">Hi ${employeeFirstName},</p>
          <p style="color:#374151;line-height:1.6;">
            We didn't detect your presence at the office on <strong>${date}</strong>,
            and there's no absence noted on the shared calendar.
          </p>
          <p style="color:#374151;line-height:1.6;">
            Please update your attendance for this day:
          </p>
          <p style="margin-top:24px;text-align:center;">
            <a href="${calendarLink}"
               style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:500;font-size:15px;">
              Update My Attendance
            </a>
          </p>
          <p style="color:#6b7280;font-size:13px;line-height:1.5;margin-top:24px;">
            If you were present, please mark yourself as "Present" in the calendar.
            If you were absent, please select the appropriate absence type (Sick, Vacation, etc.).
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

  console.log(`[ConfirmPresence] Email sent to ${employeeEmail} for ${date}`);
}
