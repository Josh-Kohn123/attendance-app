// ─── Roles & Permissions ───────────────────────────────────────────

export const ROLES = ["dev_management", "admin", "manager", "employee"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Attendance
  "attendance.clock_in",
  "attendance.view_self",
  "attendance.view_team",
  "attendance.view_all",
  "attendance.correct",
  "attendance.approve",
  "attendance.auto_logout_config",

  // Reports
  "reports.view_self",
  "reports.view_team",
  "reports.view_all",
  "reports.export",
  "reports.lock",
  "reports.sign",

  // Employees
  "employees.view_self",
  "employees.view_team",
  "employees.view_all",
  "employees.create",
  "employees.edit",
  "employees.delete",

  // Leave
  "leave.request",
  "leave.approve",
  "leave.view_team",
  "leave.view_all",

  // Admin
  "admin.policies",
  "admin.holidays",
  "admin.departments",
  "admin.sites",
  "admin.audit_log",
  "admin.roles",

  // Monthly Reports
  "reports.submit",
  "reports.review",
  "reports.admin_edit",

  // Notifications
  "notifications.manage",

  // System (dev_management)
  "system.health",
  "system.logs",
  "system.migrations",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Role → granted permissions mapping */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  dev_management: [
    "system.health",
    "system.logs",
    "system.migrations",
  ],

  admin: [
    // Self-service (admin is also an employee who needs to clock in, etc.)
    "attendance.clock_in",
    "attendance.view_self",
    "attendance.correct",
    "reports.view_self",
    "employees.view_self",
    "leave.request",
    // Management / org-wide
    "attendance.view_team",
    "attendance.view_all",
    "attendance.approve",
    "attendance.auto_logout_config",
    "reports.view_team",
    "reports.view_all",
    "reports.export",
    "reports.lock",
    "reports.sign",
    "employees.view_team",
    "employees.view_all",
    "employees.create",
    "employees.edit",
    "employees.delete",
    "leave.view_team",
    "leave.view_all",
    "leave.approve",
    "admin.policies",
    "admin.holidays",
    "admin.departments",
    "admin.sites",
    "admin.audit_log",
    "admin.roles",
    "reports.submit",
    "reports.review",
    "reports.admin_edit",
    "notifications.manage",
  ],

  manager: [
    "attendance.clock_in",
    "attendance.view_self",
    "attendance.view_team",
    "attendance.correct",
    "attendance.approve",
    "reports.view_self",
    "reports.view_team",
    "reports.export",
    "employees.view_self",
    "employees.view_team",
    "leave.request",
    "leave.approve",
    "leave.view_team",
    "reports.submit",
    "reports.review",
  ],

  employee: [
    "attendance.clock_in",
    "attendance.view_self",
    "attendance.correct",
    "reports.view_self",
    "employees.view_self",
    "leave.request",
    "reports.submit",
  ],
};

// ─── ABAC Scopes ───────────────────────────────────────────────────

export const SCOPE_TYPES = ["org", "site", "department", "employee"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export interface UserScope {
  userId: string;
  scopeType: ScopeType;
  scopeId: string;
}
