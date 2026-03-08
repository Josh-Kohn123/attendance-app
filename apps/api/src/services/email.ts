/**
 * Gmail Email Service
 *
 * Sends all notifications, reminders, and reports directly via Gmail SMTP.
 * Uses Nodemailer with either:
 *   - Gmail App Password (simpler setup)
 *   - Google OAuth2 (more secure, recommended for production)
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

// ─── Transporter singleton ──────────────────────────────────────────

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const useOAuth = !!process.env.GMAIL_OAUTH_CLIENT_ID;

  if (useOAuth) {
    // OAuth2 method (production-recommended)
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
    // App Password method (simpler setup)
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

// ─── Base send function ─────────────────────────────────────────────

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const transport = getTransporter();
    const fromName = process.env.GMAIL_FROM_NAME ?? "Orbs Attendance";
    const fromEmail = process.env.GMAIL_USER ?? "noreply@orbs.com";

    await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    console.log(`[Email] Sent to ${options.to}: ${options.subject}`);
    return true;
  } catch (error) {
    console.error(`[Email] Failed to send to ${options.to}:`, error);
    return false;
  }
}

// ─── Email template helpers ─────────────────────────────────────────

function wrapTemplate(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
          <td style="background-color:#2563eb;padding:24px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Orbs Attendance</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 16px;color:#111827;font-size:18px;">${title}</h2>
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">This is an automated message from Orbs Attendance. Please do not reply directly.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Notification methods ───────────────────────────────────────────

export const email = {
  /** Notify manager of a new clock-in, correction, or leave request */
  async notifyManager(data: {
    orgId: string;
    managerEmail: string;
    managerName: string;
    employeeName: string;
    eventType: string;
    date: string;
    details?: string;
  }) {
    const eventLabel = data.eventType.replace(/_/g, " ").toLowerCase();
    return sendEmail({
      to: data.managerEmail,
      subject: `[Attendance] ${data.employeeName} — ${eventLabel}`,
      html: wrapTemplate(
        `New ${eventLabel}`,
        `
        <p style="color:#374151;line-height:1.6;">
          <strong>${data.employeeName}</strong> has a new <strong>${eventLabel}</strong> event on <strong>${data.date}</strong>.
        </p>
        ${data.details ? `<p style="color:#6b7280;line-height:1.6;">Details: ${data.details}</p>` : ""}
        <p style="margin-top:24px;">
          <a href="${process.env.CORS_ORIGIN}/manager/approvals"
             style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
            Review in Dashboard
          </a>
        </p>`
      ),
    });
  },

  /** Notify employee of approval/rejection */
  async notifyEmployee(data: {
    orgId: string;
    employeeEmail: string;
    employeeName: string;
    eventType: string;
    status: string;
    reviewerName: string;
    comment?: string;
  }) {
    const statusColor = data.status === "APPROVED" ? "#059669" : "#dc2626";
    const statusLabel = data.status.toLowerCase();
    return sendEmail({
      to: data.employeeEmail,
      subject: `[Attendance] Your ${data.eventType.replace(/_/g, " ").toLowerCase()} was ${statusLabel}`,
      html: wrapTemplate(
        `Request ${data.status}`,
        `
        <p style="color:#374151;line-height:1.6;">
          Hi ${data.employeeName.split(" ")[0]},
        </p>
        <p style="color:#374151;line-height:1.6;">
          Your <strong>${data.eventType.replace(/_/g, " ").toLowerCase()}</strong> request has been
          <strong style="color:${statusColor};">${statusLabel}</strong> by <strong>${data.reviewerName}</strong>.
        </p>
        ${data.comment ? `<div style="background-color:#f3f4f6;border-left:4px solid #d1d5db;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <p style="margin:0;color:#4b5563;font-style:italic;">"${data.comment}"</p>
        </div>` : ""}
        <p style="margin-top:24px;">
          <a href="${process.env.CORS_ORIGIN}/timesheets"
             style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
            View Your Timesheets
          </a>
        </p>`
      ),
    });
  },

  /** Send attendance reminder to employee */
  async sendReminder(data: {
    orgId: string;
    employeeEmail: string;
    employeeName: string;
    message: string;
  }) {
    return sendEmail({
      to: data.employeeEmail,
      subject: `[Attendance] Reminder — Don't forget to clock in`,
      html: wrapTemplate(
        "Attendance Reminder",
        `
        <p style="color:#374151;line-height:1.6;">
          Hi ${data.employeeName.split(" ")[0]},
        </p>
        <p style="color:#374151;line-height:1.6;">${data.message}</p>
        <p style="margin-top:24px;">
          <a href="${process.env.CORS_ORIGIN}/clock"
             style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
            Clock In Now
          </a>
        </p>`
      ),
    });
  },

  /** Trigger report-ready notification */
  async sendReport(data: {
    orgId: string;
    recipientEmail: string;
    recipientName: string;
    reportType: string;
    period: string;
    downloadUrl: string;
  }) {
    return sendEmail({
      to: data.recipientEmail,
      subject: `[Attendance] Your ${data.reportType} report is ready`,
      html: wrapTemplate(
        "Report Ready",
        `
        <p style="color:#374151;line-height:1.6;">
          Hi ${data.recipientName.split(" ")[0]},
        </p>
        <p style="color:#374151;line-height:1.6;">
          Your <strong>${data.reportType}</strong> attendance report for <strong>${data.period}</strong> is ready.
        </p>
        <p style="margin-top:24px;">
          <a href="${data.downloadUrl}"
             style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
            Download Report
          </a>
        </p>`
      ),
    });
  },

  /** Notify about report lock/sign */
  async notifyReportAction(data: {
    orgId: string;
    recipientEmail: string;
    action: "locked" | "signed";
    period: string;
    actorName: string;
  }) {
    return sendEmail({
      to: data.recipientEmail,
      subject: `[Attendance] Report ${data.action} — ${data.period}`,
      html: wrapTemplate(
        `Report ${data.action.charAt(0).toUpperCase() + data.action.slice(1)}`,
        `
        <p style="color:#374151;line-height:1.6;">
          The attendance report for <strong>${data.period}</strong> has been
          <strong>${data.action}</strong> by <strong>${data.actorName}</strong>.
        </p>
        <p style="margin-top:24px;">
          <a href="${process.env.CORS_ORIGIN}/manager/reports"
             style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
            View Reports
          </a>
        </p>`
      ),
    });
  },

  /** Notify manager when an employee submits their monthly report */
  async notifyMonthlyReportSubmitted(data: {
    orgId: string;
    managerEmail: string;
    managerName: string;
    employeeName: string;
    month: number;
    year: number;
  }) {
    const period = `${new Date(data.year, data.month - 1).toLocaleString("default", { month: "long" })} ${data.year}`;
    return sendEmail({
      to: data.managerEmail,
      subject: `[Attendance] Monthly Report Pending — ${data.employeeName}`,
      html: wrapTemplate(
        "Monthly Report Submitted",
        `
        <p style="color:#374151;line-height:1.6;">
          <strong>${data.employeeName}</strong> has submitted their monthly attendance report for <strong>${period}</strong> for your approval.
        </p>
        <p style="margin-top:24px;">
          <a href="${process.env.CORS_ORIGIN}/manager/approvals"
             style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
            Review Report
          </a>
        </p>`
      ),
    });
  },

  /** Notify employee when their monthly report is rejected */
  async notifyMonthlyReportRejected(data: {
    orgId: string;
    employeeEmail: string;
    employeeName: string;
    month: number;
    year: number;
    reviewerName: string;
    comment: string;
  }) {
    const period = `${new Date(data.year, data.month - 1).toLocaleString("default", { month: "long" })} ${data.year}`;
    return sendEmail({
      to: data.employeeEmail,
      subject: `[Attendance] Monthly Report Rejected — ${period}`,
      html: wrapTemplate(
        "Monthly Report Needs Corrections",
        `
        <p style="color:#374151;line-height:1.6;">
          Hi ${data.employeeName.split(" ")[0]},
        </p>
        <p style="color:#374151;line-height:1.6;">
          Your monthly attendance report for <strong>${period}</strong> was sent back by <strong>${data.reviewerName}</strong> for corrections.
        </p>
        <div style="background-color:#fef2f2;border-left:4px solid #f87171;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <p style="margin:0;color:#991b1b;font-style:italic;">"${data.comment}"</p>
        </div>
        <p style="color:#374151;line-height:1.6;">
          Please review the feedback, make corrections to your calendar, and resubmit.
        </p>
        <p style="margin-top:24px;">
          <a href="${process.env.CORS_ORIGIN}/calendar"
             style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
            Update Calendar
          </a>
        </p>`
      ),
    });
  },

  /** Alert on exceptions (missing clock-in, shortages) */
  async alertException(data: {
    orgId: string;
    managerEmail: string;
    exceptionType: string;
    employeeName: string;
    details: string;
  }) {
    return sendEmail({
      to: data.managerEmail,
      subject: `[Attendance] Exception Alert — ${data.employeeName}`,
      html: wrapTemplate(
        "Exception Alert",
        `
        <div style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:16px;">
          <p style="margin:0;color:#991b1b;font-weight:600;">${data.exceptionType}</p>
        </div>
        <p style="color:#374151;line-height:1.6;">
          <strong>${data.employeeName}</strong> — ${data.details}
        </p>
        <p style="margin-top:24px;">
          <a href="${process.env.CORS_ORIGIN}/manager"
             style="display:inline-block;background-color:#2563eb;color:#ffffff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:500;">
            View Dashboard
          </a>
        </p>`
      ),
    });
  },
};
