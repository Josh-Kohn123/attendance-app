import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";
import { requirePermission } from "@orbs/authz";
import {
  ClockInSchema,
  CorrectionSchema,
  CalendarEntrySchema,
  BulkCalendarEntrySchema,
  AttendanceQuerySchema,
} from "@orbs/shared";
import { email } from "../services/email.js";
import { auditLog } from "../services/audit.js";

/**
 * Helper: check if the current user can manage attendance for a given employee.
 * Admins can manage all employees; managers can manage their direct reports only.
 */
async function canManageEmployee(request: any, employeeId: string) {
  const ctx = request.authzContext!;
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: request.currentOrgId!, isActive: true },
    include: { department: { select: { name: true } } },
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

export async function attendanceRoutes(app: FastifyInstance) {
  /**
   * POST /attendance/clock-in — Clock in for today
   */
  app.post(
    "/clock-in",
    { preHandler: [requirePermission("attendance.clock_in")] },
    async (request, reply) => {
      const parsed = ClockInSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { siteId, source, clientTimestamp, requestId, notes } = parsed.data;

      // Get employee record
      const employee = await prisma.employee.findFirst({
        where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
      });

      if (!employee) {
        return reply.status(404).send({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record found" } });
      }

      // Idempotency check
      const existing = await prisma.attendanceEvent.findUnique({ where: { requestId } });
      if (existing) {
        return { ok: true, data: existing };
      }

      // Create event (append-only)
      const event = await prisma.attendanceEvent.create({
        data: {
          orgId: request.currentOrgId!,
          employeeId: employee.id,
          siteId,
          eventType: "CLOCK_IN",
          source,
          clientTimestamp: clientTimestamp ? new Date(clientTimestamp) : null,
          createdByUserId: request.currentUserId!,
          requestId,
          notes,
        },
      });

      // Email notification to manager (async, non-blocking)
      const dept = employee.departmentId
        ? await prisma.department.findUnique({
            where: { id: employee.departmentId },
            include: { manager: true },
          })
        : null;

      if (dept?.manager) {
        email.notifyManager({
          orgId: request.currentOrgId!,
          managerEmail: dept.manager.email,
          managerName: dept.manager.displayName,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          eventType: "CLOCK_IN",
          date: new Date().toISOString().split("T")[0],
        }).catch(() => {});
      }

      return { ok: true, data: event };
    }
  );

  /**
   * POST /attendance/calendar-entry — Set status for a single date (calendar view)
   */
  app.post(
    "/calendar-entry",
    { preHandler: [requirePermission("attendance.clock_in")] },
    async (request, reply) => {
      const parsed = CalendarEntrySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { date, status, siteId, source, requestId, notes } = parsed.data;

      const employee = await prisma.employee.findFirst({
        where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
      });
      if (!employee) {
        return reply.status(404).send({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
      }

      // Idempotency
      const existing = await prisma.attendanceEvent.findUnique({ where: { requestId } });
      if (existing) return { ok: true, data: existing };

      // Upsert: delete any existing event for this employee+date, then create new one
      const dayStart = new Date(`${date}T00:00:00Z`);
      const dayEnd = new Date(`${date}T23:59:59Z`);
      await prisma.attendanceEvent.deleteMany({
        where: {
          employeeId: employee.id,
          serverTimestamp: { gte: dayStart, lte: dayEnd },
          eventType: "CLOCK_IN",
        },
      });

      const event = await prisma.attendanceEvent.create({
        data: {
          orgId: request.currentOrgId!,
          employeeId: employee.id,
          siteId,
          eventType: "CLOCK_IN",
          source,
          serverTimestamp: new Date(`${date}T09:00:00Z`),
          createdByUserId: request.currentUserId!,
          requestId,
          notes: status, // Store status in notes field for now (clean migration later)
        },
      });

      return { ok: true, data: event };
    }
  );

  /**
   * DELETE /attendance/calendar-entry?date=YYYY-MM-DD — Clear status for a single date
   */
  app.delete(
    "/calendar-entry",
    { preHandler: [requirePermission("attendance.clock_in")] },
    async (request, reply) => {
      const { date } = request.query as { date?: string };
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "date query param required (YYYY-MM-DD)" } });
      }

      const employee = await prisma.employee.findFirst({
        where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
      });
      if (!employee) {
        return reply.status(404).send({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
      }

      const dayStart = new Date(`${date}T00:00:00Z`);
      const dayEnd = new Date(`${date}T23:59:59Z`);
      await prisma.attendanceEvent.deleteMany({
        where: {
          employeeId: employee.id,
          serverTimestamp: { gte: dayStart, lte: dayEnd },
          eventType: "CLOCK_IN",
        },
      });

      return { ok: true };
    }
  );

  /**
   * POST /attendance/calendar-bulk — Set the same status for multiple dates at once
   */
  app.post(
    "/calendar-bulk",
    { preHandler: [requirePermission("attendance.clock_in")] },
    async (request, reply) => {
      const parsed = BulkCalendarEntrySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { dates, status, siteId, source, notes } = parsed.data;

      const employee = await prisma.employee.findFirst({
        where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
      });
      if (!employee) {
        return reply.status(404).send({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
      }

      // Delete existing entries for these dates, then create new ones
      const events = await prisma.$transaction(async (tx) => {
        for (const date of dates) {
          const dayStart = new Date(`${date}T00:00:00Z`);
          const dayEnd = new Date(`${date}T23:59:59Z`);
          await tx.attendanceEvent.deleteMany({
            where: {
              employeeId: employee.id,
              serverTimestamp: { gte: dayStart, lte: dayEnd },
              eventType: "CLOCK_IN",
            },
          });
        }

        return Promise.all(
          dates.map((date) =>
            tx.attendanceEvent.create({
              data: {
                orgId: request.currentOrgId!,
                employeeId: employee.id,
                siteId,
                eventType: "CLOCK_IN",
                source: source ?? "MANUAL",
                serverTimestamp: new Date(`${date}T09:00:00Z`),
                createdByUserId: request.currentUserId!,
                requestId: crypto.randomUUID(),
                notes: status, // Store status in notes field
              },
            })
          )
        );
      });

      return { ok: true, data: events };
    }
  );

  /**
   * GET /attendance/self — Get own attendance events
   */
  app.get(
    "/self",
    { preHandler: [requirePermission("attendance.view_self")] },
    async (request, reply) => {
      const parsed = AttendanceQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { from, to, page, limit } = parsed.data;

      const employee = await prisma.employee.findFirst({
        where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
      });
      if (!employee) {
        return reply.status(404).send({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
      }

      const [events, total] = await Promise.all([
        prisma.attendanceEvent.findMany({
          where: {
            orgId: request.currentOrgId!,
            employeeId: employee.id,
            serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
          },
          orderBy: { serverTimestamp: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.attendanceEvent.count({
          where: {
            orgId: request.currentOrgId!,
            employeeId: employee.id,
            serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
          },
        }),
      ]);

      return {
        ok: true,
        data: {
          items: events,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  /**
   * GET /attendance/team — Get team attendance (manager scoped)
   */
  app.get(
    "/team",
    { preHandler: [requirePermission("attendance.view_team")] },
    async (request, reply) => {
      const parsed = AttendanceQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { from, to, page, limit, departmentId, siteId } = parsed.data;
      const ctx = request.authzContext!;

      // Build scope filter — managers see only their scoped departments/sites
      const scopedDeptIds = ctx.scopes
        .filter((s) => s.scopeType === "department")
        .map((s) => s.scopeId);
      const scopedSiteIds = ctx.scopes
        .filter((s) => s.scopeType === "site")
        .map((s) => s.scopeId);

      // Get employees in scope
      const employeeWhere: any = { orgId: request.currentOrgId! };
      if (departmentId) {
        employeeWhere.departmentId = departmentId;
      } else if (scopedDeptIds.length > 0) {
        employeeWhere.departmentId = { in: scopedDeptIds };
      }
      if (siteId) {
        employeeWhere.siteId = siteId;
      } else if (scopedSiteIds.length > 0) {
        employeeWhere.siteId = { in: scopedSiteIds };
      }

      const employees = await prisma.employee.findMany({
        where: employeeWhere,
        select: { id: true, firstName: true, lastName: true },
      });
      const empIds = employees.map((e) => e.id);

      const [events, total] = await Promise.all([
        prisma.attendanceEvent.findMany({
          where: {
            orgId: request.currentOrgId!,
            employeeId: { in: empIds },
            serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
          },
          include: { employee: { select: { firstName: true, lastName: true } } },
          orderBy: { serverTimestamp: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.attendanceEvent.count({
          where: {
            orgId: request.currentOrgId!,
            employeeId: { in: empIds },
            serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
          },
        }),
      ]);

      return { ok: true, data: { items: events, total, page, limit, totalPages: Math.ceil(total / limit) } };
    }
  );

  /**
   * POST /attendance/corrections — Submit a correction
   */
  app.post(
    "/corrections",
    { preHandler: [requirePermission("attendance.correct")] },
    async (request, reply) => {
      const parsed = CorrectionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { originalEventId, correctedDate, reason, requestId } = parsed.data;

      // Verify original event exists and belongs to user
      const original = await prisma.attendanceEvent.findUnique({ where: { id: originalEventId } });
      if (!original || original.orgId !== request.currentOrgId!) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Original event not found" } });
      }

      // Idempotency
      const existing = await prisma.attendanceEvent.findUnique({ where: { requestId } });
      if (existing) return { ok: true, data: existing };

      const correction = await prisma.attendanceEvent.create({
        data: {
          orgId: request.currentOrgId!,
          employeeId: original.employeeId,
          siteId: original.siteId,
          eventType: "CORRECTION_SUBMITTED",
          source: "MANUAL",
          previousEventId: originalEventId,
          createdByUserId: request.currentUserId!,
          requestId,
          notes: reason,
        },
      });

      await auditLog(request, "ATTENDANCE_CORRECTED", "attendance_event", correction.id, { originalEventId }, { correctionId: correction.id });

      return { ok: true, data: correction };
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Proxy endpoints — admin/manager writes attendance on behalf of an employee
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * GET /attendance/employee/:employeeId — Get attendance events for a specific employee
   */
  app.get(
    "/employee/:employeeId",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const parsed = AttendanceQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { allowed } = await canManageEmployee(request, employeeId);
      if (!allowed) {
        return reply.status(403).send({ ok: false, error: { code: "FORBIDDEN", message: "You cannot access this employee's attendance" } });
      }

      const { from, to, page, limit } = parsed.data;

      const [events, total] = await Promise.all([
        prisma.attendanceEvent.findMany({
          where: {
            orgId: request.currentOrgId!,
            employeeId,
            serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
          },
          orderBy: { serverTimestamp: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.attendanceEvent.count({
          where: {
            orgId: request.currentOrgId!,
            employeeId,
            serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
          },
        }),
      ]);

      return { ok: true, data: { items: events, total, page, limit, totalPages: Math.ceil(total / limit) } };
    }
  );

  /**
   * POST /attendance/employee/:employeeId/calendar-entry — Set status for a date on behalf of employee
   */
  app.post(
    "/employee/:employeeId/calendar-entry",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const parsed = CalendarEntrySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { allowed, employee } = await canManageEmployee(request, employeeId);
      if (!allowed || !employee) {
        return reply.status(403).send({ ok: false, error: { code: "FORBIDDEN", message: "You cannot edit this employee's attendance" } });
      }

      const { date, status, siteId, source, requestId } = parsed.data;

      // Idempotency
      const existing = await prisma.attendanceEvent.findUnique({ where: { requestId } });
      if (existing) return { ok: true, data: existing };

      // Upsert: delete existing for this employee+date, then create
      const dayStart = new Date(`${date}T00:00:00Z`);
      const dayEnd = new Date(`${date}T23:59:59Z`);
      await prisma.attendanceEvent.deleteMany({
        where: {
          employeeId,
          serverTimestamp: { gte: dayStart, lte: dayEnd },
          eventType: "CLOCK_IN",
        },
      });

      const event = await prisma.attendanceEvent.create({
        data: {
          orgId: request.currentOrgId!,
          employeeId,
          siteId,
          eventType: "CLOCK_IN",
          source,
          serverTimestamp: new Date(`${date}T09:00:00Z`),
          createdByUserId: request.currentUserId!,
          requestId,
          notes: status,
        },
      });

      return { ok: true, data: event };
    }
  );

  /**
   * DELETE /attendance/employee/:employeeId/calendar-entry?date=YYYY-MM-DD — Clear status on behalf of employee
   */
  app.delete(
    "/employee/:employeeId/calendar-entry",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const { date } = request.query as { date?: string };
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "date query param required (YYYY-MM-DD)" } });
      }

      const { allowed } = await canManageEmployee(request, employeeId);
      if (!allowed) {
        return reply.status(403).send({ ok: false, error: { code: "FORBIDDEN", message: "You cannot edit this employee's attendance" } });
      }

      const dayStart = new Date(`${date}T00:00:00Z`);
      const dayEnd = new Date(`${date}T23:59:59Z`);
      await prisma.attendanceEvent.deleteMany({
        where: {
          employeeId,
          serverTimestamp: { gte: dayStart, lte: dayEnd },
          eventType: "CLOCK_IN",
        },
      });

      return { ok: true };
    }
  );

  /**
   * POST /attendance/employee/:employeeId/calendar-bulk — Bulk set status on behalf of employee
   */
  app.post(
    "/employee/:employeeId/calendar-bulk",
    { preHandler: [requirePermission("reports.review")] },
    async (request, reply) => {
      const { employeeId } = request.params as { employeeId: string };
      const parsed = BulkCalendarEntrySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const { allowed, employee } = await canManageEmployee(request, employeeId);
      if (!allowed || !employee) {
        return reply.status(403).send({ ok: false, error: { code: "FORBIDDEN", message: "You cannot edit this employee's attendance" } });
      }

      const { dates, status, siteId, source } = parsed.data;

      const events = await prisma.$transaction(async (tx) => {
        for (const date of dates) {
          const dayStart = new Date(`${date}T00:00:00Z`);
          const dayEnd = new Date(`${date}T23:59:59Z`);
          await tx.attendanceEvent.deleteMany({
            where: {
              employeeId,
              serverTimestamp: { gte: dayStart, lte: dayEnd },
              eventType: "CLOCK_IN",
            },
          });
        }

        return Promise.all(
          dates.map((date) =>
            tx.attendanceEvent.create({
              data: {
                orgId: request.currentOrgId!,
                employeeId,
                siteId,
                eventType: "CLOCK_IN",
                source: source ?? "MANUAL",
                serverTimestamp: new Date(`${date}T09:00:00Z`),
                createdByUserId: request.currentUserId!,
                requestId: crypto.randomUUID(),
                notes: status,
              },
            })
          )
        );
      });

      return { ok: true, data: events };
    }
  );
}
