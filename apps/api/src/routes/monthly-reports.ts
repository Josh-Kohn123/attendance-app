import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";
import { requirePermission } from "@orbs/authz";
import {
  MonthlyReportSubmitSchema,
  MonthlyReportRejectSchema,
  MonthlyReportQuerySchema,
  NotifySubmitRequestSchema,
} from "@orbs/shared";
import { email } from "../services/email.js";
import { auditLog } from "../services/audit.js";

/**
 * Helper: check if the current user can manage reports for a given employee.
 * Admins can manage all employees; managers can manage their direct reports only.
 */
async function canManageEmployee(request: any, employeeId: string) {
  const ctx = request.authzContext!;
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: request.currentOrgId!, isActive: true },
    include: {
      manager: { select: { id: true, email: true, displayName: true } },
      department: { select: { name: true } },
    },
  });
  if (!employee) return { allowed: false as const, employee: null };

  // Admins can manage all employees
  if (ctx.roles.includes("admin")) return { allowed: true as const, employee };

  // Managers can manage their direct reports
  if (ctx.roles.includes("manager") && employee.managerId === request.currentUserId) {
    return { allowed: true as const, employee };
  }

  return { allowed: false as const, employee: null };
}

export async function monthlyReportRoutes(app: FastifyInstance) {
  /**
   * GET /monthly-reports/status?month=X&year=Y — Get own report status for a month
   */
  app.get(
    "/status",
    { preHandler: [requirePermission("reports.view_self")] },
    async (request, reply) => {
      const { month, year } = request.query as { month?: string; year?: string };
      const m = Number(month);
      const y = Number(year);
      if (!m || !y || m < 1 || m > 12 || y < 2020) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "month (1-12) and year required" } });
      }

      const employee = await prisma.employee.findFirst({
        where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
      });

      // No employee record — still return DRAFT so the UI shows the submit button
      // (submit endpoint will give a helpful error if they try to submit without a record)
      if (!employee) {
        return {
          ok: true,
          data: {
            id: null,
            status: "DRAFT",
            submittedAt: null,
            reviewedAt: null,
            reviewerName: null,
            reviewComment: null,
            lockedAt: null,
            noEmployeeRecord: true,
          },
        };
      }

      const report = await prisma.monthlyReport.findUnique({
        where: {
          orgId_employeeId_month_year: {
            orgId: request.currentOrgId!,
            employeeId: employee.id,
            month: m,
            year: y,
          },
        },
        include: {
          reviewer: { select: { displayName: true } },
        },
      });

      // If no report exists yet, it's in DRAFT status
      return {
        ok: true,
        data: report
          ? {
              id: report.id,
              status: report.status,
              submittedAt: report.submittedAt,
              reviewedAt: report.reviewedAt,
              reviewerName: report.reviewer?.displayName ?? null,
              reviewComment: report.reviewComment,
              lockedAt: report.lockedAt,
            }
          : {
              id: null,
              status: "DRAFT",
              submittedAt: null,
              reviewedAt: null,
              reviewerName: null,
              reviewComment: null,
              lockedAt: null,
            },
      };
    }
  );

  /**
   * GET /monthly-reports/team-status?month=X&year=Y — Report status for all employees under the manager
   */
  app.get(
    "/team-status",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const { month, year } = request.query as { month?: string; year?: string };
      const m = Number(month);
      const y = Number(year);
      if (!m || !y || m < 1 || m > 12 || y < 2020) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "month (1-12) and year required" } });
      }

      const ctx = request.authzContext!;

      // Employees whose managerId points to the current user (their direct reports).
      // Admins see all employees; everyone else sees only their direct reports.
      let employees: any[];
      if (ctx.roles.includes("admin")) {
        employees = await prisma.employee.findMany({
          where: { orgId: request.currentOrgId!, isActive: true },
          include: { department: { select: { name: true } } },
          orderBy: { lastName: "asc" },
        });
      } else {
        employees = await prisma.employee.findMany({
          where: { orgId: request.currentOrgId!, isActive: true, managerId: request.currentUserId! },
          include: { department: { select: { name: true } } },
          orderBy: { lastName: "asc" },
        });
      }

      // Also include the current user's own employee record (for self-approval)
      const selfEmp = await prisma.employee.findFirst({
        where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
        include: { department: { select: { name: true } } },
      });

      const empMap = new Map(employees.map((e: any) => [e.id, e]));
      if (selfEmp && !empMap.has(selfEmp.id)) {
        empMap.set(selfEmp.id, selfEmp);
      }
      const allEmployees = Array.from(empMap.values());
      const empIds = allEmployees.map((e: any) => e.id);

      // Fetch monthly reports for this month
      const reports = await prisma.monthlyReport.findMany({
        where: {
          orgId: request.currentOrgId!,
          employeeId: { in: empIds },
          month: m,
          year: y,
        },
      });

      const reportByEmpId = new Map(reports.map((r: any) => [r.employeeId, r]));

      const items = allEmployees.map((emp: any) => {
        const report = reportByEmpId.get(emp.id);
        const isSelf = selfEmp && emp.id === selfEmp.id;
        return {
          employeeId: emp.id,
          employeeName: `${emp.firstName} ${emp.lastName}`,
          employeeEmail: emp.email,
          departmentName: emp.department?.name ?? null,
          requireSelfSubmit: emp.requireSelfSubmit,
          isSelf: !!isSelf,
          reportId: report?.id ?? null,
          status: report?.status ?? "DRAFT",
          submittedAt: report?.submittedAt ?? null,
          reviewedAt: report?.reviewedAt ?? null,
          reviewComment: report?.reviewComment ?? null,
        };
      });

      return { ok: true, data: items };
    }
  );

  /**
   * POST /monthly-reports/submit — Submit own monthly report for manager review
   */
  app.post(
    "/submit",
    { preHandler: [requirePermission("reports.submit")] },
    async (request, reply) => {
      const parsed = MonthlyReportSubmitSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { month, year } = parsed.data;

      const employee = await prisma.employee.findFirst({
        where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
        include: {
          // managerId is the sole authority — no department fallback
          manager: { select: { id: true, email: true, displayName: true } },
        },
      });

      if (!employee) {
        return reply.status(404).send({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
      }

      // The managerId field on the employee record is the single source of truth for all users,
      // regardless of role. If an employee/manager/admin has no manager assigned, they cannot submit.
      // If they are set as their own manager, their report lands in their own review queue (self-approval).
      const resolvedManager: { id: string; email: string; displayName: string } | null =
        (employee as any).manager ?? null;

      if (!resolvedManager) {
        return reply.status(400).send({
          ok: false,
          error: {
            code: "NO_MANAGER",
            message: "You do not have a manager assigned. Please contact admin.",
          },
        });
      }

      // Check if report exists and status allows submission
      const existing = await prisma.monthlyReport.findUnique({
        where: {
          orgId_employeeId_month_year: {
            orgId: request.currentOrgId!,
            employeeId: employee.id,
            month,
            year,
          },
        },
      });

      if (existing && !["DRAFT", "REJECTED"].includes(existing.status)) {
        return reply.status(400).send({
          ok: false,
          error: { code: "INVALID_STATUS", message: `Cannot submit — report is already ${existing.status.toLowerCase()}` },
        });
      }

      // Upsert the report
      const report = await prisma.monthlyReport.upsert({
        where: {
          orgId_employeeId_month_year: {
            orgId: request.currentOrgId!,
            employeeId: employee.id,
            month,
            year,
          },
        },
        update: {
          status: "SUBMITTED",
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedById: null,
          reviewComment: null,
        },
        create: {
          orgId: request.currentOrgId!,
          employeeId: employee.id,
          month,
          year,
          status: "SUBMITTED",
          submittedAt: new Date(),
        },
      });

      await auditLog(request, "MONTHLY_REPORT_SUBMITTED", "monthly_report", report.id, null, { month, year, status: "SUBMITTED" });

      return { ok: true, data: report };
    }
  );

  /**
   * GET /monthly-reports/pending-reviews — List submitted reports for manager review.
   * Scoped by managerId: each user sees reports for employees who have them assigned as manager.
   * Admins see all. Self-managing users see their own report too.
   */
  app.get(
    "/pending-reviews",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const parsed = MonthlyReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { status, page, limit } = parsed.data;
      const ctx = request.authzContext!;

      // Look up the current user's own employee record (needed for self-approval inclusion)
      const selfEmployee = await prisma.employee.findFirst({
        where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
        select: { id: true },
      });

      // Build the list of employee IDs whose reports this user can review.
      // Rule: an employee's reports go to whoever is set as their managerId.
      let reviewableEmpIds: string[];
      if (ctx.roles.includes("admin")) {
        // Admins review everyone
        reviewableEmpIds = (
          await prisma.employee.findMany({
            where: { orgId: request.currentOrgId! },
            select: { id: true },
          })
        ).map((e: any) => e.id);
      } else {
        // Non-admins: see employees whose managerId points to the current user
        reviewableEmpIds = (
          await prisma.employee.findMany({
            where: { orgId: request.currentOrgId!, managerId: request.currentUserId! },
            select: { id: true },
          })
        ).map((e: any) => e.id);
      }

      // Always include the current user's own employee record so self-managing users
      // can approve their own report
      const empIds = selfEmployee
        ? [...new Set([...reviewableEmpIds, selfEmployee.id])]
        : reviewableEmpIds;

      if (empIds.length === 0) {
        return { ok: true, data: { items: [], total: 0, page, limit, totalPages: 0 } };
      }

      const where: any = {
        orgId: request.currentOrgId!,
        employeeId: { in: empIds },
        status: status ?? "SUBMITTED",
      };

      const [reports, total] = await Promise.all([
        prisma.monthlyReport.findMany({
          where,
          include: {
            employee: {
              select: { firstName: true, lastName: true, email: true, departmentId: true },
              include: { department: { select: { name: true } } } as any,
            },
          },
          orderBy: { submittedAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.monthlyReport.count({ where }),
      ]);

      const items = reports.map((r: any) => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
        employeeEmail: r.employee.email,
        departmentName: r.employee.department?.name ?? null,
        month: r.month,
        year: r.year,
        status: r.status,
        submittedAt: r.submittedAt,
        reviewedAt: r.reviewedAt,
        reviewComment: r.reviewComment,
      }));

      return { ok: true, data: { items, total, page, limit, totalPages: Math.ceil(total / limit) } };
    }
  );

  /**
   * POST /monthly-reports/:id/approve — Manager approves a submitted report
   */
  app.post(
    "/:id/approve",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const report = await prisma.monthlyReport.findUnique({
        where: { id },
        include: { employee: true },
      });

      if (!report || report.orgId !== request.currentOrgId!) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Report not found" } });
      }

      if (report.status !== "SUBMITTED") {
        return reply.status(400).send({
          ok: false,
          error: { code: "INVALID_STATUS", message: `Cannot approve — report is ${report.status.toLowerCase()}, not submitted` },
        });
      }

      const updated = await prisma.monthlyReport.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedById: request.currentUserId!,
          lockedAt: new Date(),
        },
      });

      await auditLog(request, "MONTHLY_REPORT_APPROVED", "monthly_report", id, { status: "SUBMITTED" }, { status: "APPROVED" });

      return { ok: true, data: updated };
    }
  );

  /**
   * POST /monthly-reports/:id/reject — Manager rejects a submitted report with comment
   */
  app.post(
    "/:id/reject",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = MonthlyReportRejectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const report = await prisma.monthlyReport.findUnique({
        where: { id },
        include: { employee: true },
      });

      if (!report || report.orgId !== request.currentOrgId!) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Report not found" } });
      }

      if (report.status !== "SUBMITTED") {
        return reply.status(400).send({
          ok: false,
          error: { code: "INVALID_STATUS", message: `Cannot reject — report is ${report.status.toLowerCase()}, not submitted` },
        });
      }

      const updated = await prisma.monthlyReport.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedAt: new Date(),
          reviewedById: request.currentUserId!,
          reviewComment: parsed.data.comment,
        },
      });

      // Notify employee via email
      const reviewer = await prisma.user.findUnique({ where: { id: request.currentUserId! } });
      if (report.employee && reviewer) {
        email.notifyMonthlyReportRejected({
          orgId: request.currentOrgId!,
          employeeEmail: report.employee.email,
          employeeName: `${report.employee.firstName} ${report.employee.lastName}`,
          month: report.month,
          year: report.year,
          reviewerName: reviewer.displayName,
          comment: parsed.data.comment,
        }).catch(() => {});
      }

      await auditLog(request, "MONTHLY_REPORT_REJECTED", "monthly_report", id, { status: "SUBMITTED" }, { status: "REJECTED", comment: parsed.data.comment });

      return { ok: true, data: updated };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Proxy endpoints — admin/manager creates & submits reports on behalf of employees
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * GET /monthly-reports/status/:employeeId?month=X&year=Y — Get report status for a specific employee
   */
  app.get(
    "/status/:employeeId",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const { month, year } = request.query as { month?: string; year?: string };
      const m = Number(month);
      const y = Number(year);
      if (!m || !y || m < 1 || m > 12 || y < 2020) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "month (1-12) and year required" } });
      }

      const { allowed, employee } = await canManageEmployee(request, employeeId);
      if (!allowed || !employee) {
        return reply.status(403).send({ ok: false, error: { code: "FORBIDDEN", message: "You cannot access this employee's report" } });
      }

      const report = await prisma.monthlyReport.findUnique({
        where: {
          orgId_employeeId_month_year: {
            orgId: request.currentOrgId!,
            employeeId,
            month: m,
            year: y,
          },
        },
        include: {
          reviewer: { select: { displayName: true } },
        },
      });

      return {
        ok: true,
        data: report
          ? {
              id: report.id,
              status: report.status,
              submittedAt: report.submittedAt,
              reviewedAt: report.reviewedAt,
              reviewerName: report.reviewer?.displayName ?? null,
              reviewComment: report.reviewComment,
              lockedAt: report.lockedAt,
            }
          : {
              id: null,
              status: "DRAFT",
              submittedAt: null,
              reviewedAt: null,
              reviewerName: null,
              reviewComment: null,
              lockedAt: null,
            },
      };
    }
  );

  /**
   * POST /monthly-reports/submit-for — Submit a monthly report on behalf of an employee
   * Body: { employeeId, month, year }
   */
  app.post(
    "/submit-for",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const body = request.body as { employeeId?: string; month?: number; year?: number };
      const employeeId = body.employeeId;
      const month = body.month;
      const year = body.year;

      if (!employeeId || !month || !year || month < 1 || month > 12 || year < 2020) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "employeeId, month (1-12) and year required" } });
      }

      const { allowed, employee } = await canManageEmployee(request, employeeId);
      if (!allowed || !employee) {
        return reply.status(403).send({ ok: false, error: { code: "FORBIDDEN", message: "You cannot submit reports for this employee" } });
      }

      // Block proxy submission for employees who must submit themselves
      if (employee.requireSelfSubmit) {
        return reply.status(403).send({
          ok: false,
          error: { code: "SELF_SUBMIT_REQUIRED", message: "This employee must submit their own report" },
        });
      }

      // Resolve the manager — the person the report is sent to for review.
      // When the admin/manager creates the report, the report's manager is the employee's assigned manager.
      // If the current user IS the employee's manager, the report effectively self-submits.
      const resolvedManager: { id: string; email: string; displayName: string } | null =
        (employee as any).manager ?? null;

      // Check current report status
      const existing = await prisma.monthlyReport.findUnique({
        where: {
          orgId_employeeId_month_year: {
            orgId: request.currentOrgId!,
            employeeId,
            month,
            year,
          },
        },
      });

      if (existing && !["DRAFT", "REJECTED"].includes(existing.status)) {
        return reply.status(400).send({
          ok: false,
          error: { code: "INVALID_STATUS", message: `Cannot submit — report is already ${existing.status.toLowerCase()}` },
        });
      }

      // Upsert the report as SUBMITTED
      const report = await prisma.monthlyReport.upsert({
        where: {
          orgId_employeeId_month_year: {
            orgId: request.currentOrgId!,
            employeeId,
            month,
            year,
          },
        },
        update: {
          status: "SUBMITTED",
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedById: null,
          reviewComment: null,
        },
        create: {
          orgId: request.currentOrgId!,
          employeeId,
          month,
          year,
          status: "SUBMITTED",
          submittedAt: new Date(),
        },
      });

      await auditLog(
        request,
        "MONTHLY_REPORT_SUBMITTED",
        "monthly_report",
        report.id,
        null,
        { month, year, status: "SUBMITTED", submittedByProxy: true, onBehalfOf: employeeId }
      );

      return { ok: true, data: report };
    }
  );

  /**
   * POST /monthly-reports/notify-submit — Notify employee that their attendance is ready for self-submission
   * Body: { employeeId, month, year }
   */
  app.post(
    "/notify-submit",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const parsed = NotifySubmitRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { employeeId, month, year } = parsed.data;

      const { allowed, employee } = await canManageEmployee(request, employeeId);
      if (!allowed || !employee) {
        return reply.status(403).send({ ok: false, error: { code: "FORBIDDEN", message: "You cannot manage this employee" } });
      }

      const currentUser = await prisma.user.findUnique({ where: { id: request.currentUserId! } });

      await email.notifySubmitRequired({
        orgId: request.currentOrgId!,
        employeeEmail: employee.email,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        month,
        year,
        managerName: currentUser?.displayName ?? "Your manager",
      });

      await auditLog(
        request,
        "MONTHLY_REPORT_NOTIFY_SUBMIT",
        "employee",
        employeeId,
        null,
        { month, year, notifiedEmployee: employee.email }
      );

      return { ok: true };
    }
  );
}
