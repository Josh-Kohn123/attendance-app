// ─── Day Status (calendar-based attendance) ────────────────────────

export const DAY_STATUSES = [
  "PRESENT",
  "SICK",
  "CHILD_SICK",
  "VACATION",
  "RESERVES",
  "HALF_DAY",
  "WORK_FROM_HOME",
  "PUBLIC_HOLIDAY",
  "DAY_OFF",
] as const;

export type DayStatus = (typeof DAY_STATUSES)[number];

// ─── Attendance Event Types ─────────────────────────────────────────

export const EVENT_TYPES = [
  "CLOCK_IN",
  "CORRECTION_SUBMITTED",
  "APPROVED",
  "REJECTED",
  "LOCKED",
  "SIGNED",
  "AUTO_LOGOUT",
  "LEAVE_REQUESTED",
  "LEAVE_APPROVED",
  "LEAVE_REJECTED",
  "LEAVE_CANCELLED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_SOURCES = ["MANUAL", "HIKVISION", "GOOGLE_CALENDAR", "IMPORT", "SYSTEM"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

// ─── Audit Action Types ─────────────────────────────────────────────

export const AUDIT_ACTIONS = [
  "USER_LOGIN",
  "USER_LOGOUT",
  "EMPLOYEE_CREATED",
  "EMPLOYEE_UPDATED",
  "ROLE_ASSIGNED",
  "ROLE_REVOKED",
  "SCOPE_ASSIGNED",
  "SCOPE_REVOKED",
  "POLICY_UPDATED",
  "REPORT_EXPORTED",
  "REPORT_LOCKED",
  "REPORT_SIGNED",
  "HOLIDAY_CREATED",
  "HOLIDAY_DELETED",
  "DEPARTMENT_CREATED",
  "DEPARTMENT_UPDATED",
  "SITE_CREATED",
  "SITE_UPDATED",
  "ATTENDANCE_CORRECTED",
  "NOTIFICATION_SENT",
  "MONTHLY_REPORT_SUBMITTED",
  "MONTHLY_REPORT_APPROVED",
  "MONTHLY_REPORT_REJECTED",
  "MONTHLY_REPORT_NOTIFY_SUBMIT",
  "DAILY_ATTENDANCE_PROCESSED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
