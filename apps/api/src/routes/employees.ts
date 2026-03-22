import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";
import { requirePermission } from "@orbs/authz";
import { CreateEmployeeSchema, UpdateEmployeeSchema } from "@orbs/shared";
import { auditLog } from "../services/audit.js";

export async function employeeRoutes(app: FastifyInstance) {
  /**
   * GET /employees — List employees (scoped)
   */
  app.get("/", async (request, reply) => {
    const ctx = request.authzContext;
    if (!ctx) return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Auth required" } });

    const { page = "1", limit = "50", search, departmentId, siteId } = request.query as any;

    const where: any = { orgId: request.currentOrgId! };

    // Scope filtering
    if (ctx.roles.includes("employee") && !ctx.roles.includes("admin") && !ctx.roles.includes("manager")) {
      // Employees can only see themselves
      where.userId = request.currentUserId!;
    } else if (ctx.roles.includes("manager") && !ctx.roles.includes("admin")) {
      const scopedDeptIds = ctx.scopes.filter((s) => s.scopeType === "department").map((s) => s.scopeId);
      if (scopedDeptIds.length > 0) where.departmentId = { in: scopedDeptIds };
    }

    if (departmentId) where.departmentId = departmentId;
    if (siteId) where.siteId = siteId;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    const pg = parseInt(page);
    const lim = parseInt(limit);

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: {
          department: true,
          site: true,
          user: { select: { id: true, isActive: true, userRoles: true } },
          manager: { select: { id: true, displayName: true, email: true } },
        },
        orderBy: { lastName: "asc" },
        skip: (pg - 1) * lim,
        take: lim,
      }),
      prisma.employee.count({ where }),
    ]);

    return { ok: true, data: { items: employees, total, page: pg, limit: lim, totalPages: Math.ceil(total / lim) } };
  });

  /**
   * GET /employees/:id — Get single employee
   */
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        department: true,
        site: true,
        positionHistory: { orderBy: { startDate: "desc" } },
      },
    });

    if (!employee || employee.orgId !== request.currentOrgId!) {
      return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    }

    return { ok: true, data: employee };
  });

  /**
   * POST /employees — Create employee (admin only)
   */
  app.post(
    "/",
    { preHandler: [requirePermission("employees.create")] },
    async (request, reply) => {
      const parsed = CreateEmployeeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const data = parsed.data;

      // Create user + employee in transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create user account
        const user = await tx.user.create({
          data: {
            orgId: request.currentOrgId!,
            email: data.email,
            displayName: `${data.firstName} ${data.lastName}`,
            userRoles: { create: { role: data.role } },
          },
        });

        // Create employee record
        const employee = await tx.employee.create({
          data: {
            orgId: request.currentOrgId!,
            userId: user.id,
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            employeeNumber: data.employeeNumber,
            phone: data.phone,
            position: data.position,
            departmentId: data.departmentId,
            managerId: data.managerId,
            siteId: data.siteId,
            startDate: new Date(data.startDate),
            employmentPercentage: data.employmentPercentage ?? 100,
            daysOff: data.daysOff ?? [],
          },
        });

        // Create initial position history
        await tx.positionHistory.create({
          data: {
            employeeId: employee.id,
            position: data.position ?? "Employee",
            department: data.departmentId ? undefined : undefined,
            startDate: new Date(data.startDate),
          },
        });

        return employee;
      });

      await auditLog(request, "EMPLOYEE_CREATED", "employee", result.id, null, data);

      return reply.status(201).send({ ok: true, data: result });
    }
  );

  /**
   * PATCH /employees/:id — Update employee (admin only)
   */
  app.patch(
    "/:id",
    { preHandler: [requirePermission("employees.edit")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateEmployeeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const existing = await prisma.employee.findUnique({ where: { id } });
      if (!existing || existing.orgId !== request.currentOrgId!) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
      }

      const data = parsed.data;
      const updateData: any = { ...data };
      if (data.startDate) updateData.startDate = new Date(data.startDate);

      // Track position changes
      if (data.position && data.position !== existing.position) {
        await prisma.positionHistory.updateMany({
          where: { employeeId: id, endDate: null },
          data: { endDate: new Date() },
        });
        await prisma.positionHistory.create({
          data: {
            employeeId: id,
            position: data.position,
            startDate: new Date(),
          },
        });
      }

      const updated = await prisma.employee.update({ where: { id }, data: updateData });
      await auditLog(request, "EMPLOYEE_UPDATED", "employee", id, existing, updated);

      return { ok: true, data: updated };
    }
  );

  /**
   * PATCH /employees/:id/role — Change employee role (admin only)
   */
  app.patch(
    "/:id/role",
    { preHandler: [requirePermission("employees.edit")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { role } = request.body as { role: string };

      const employee = await prisma.employee.findUnique({
        where: { id },
        include: { user: { include: { userRoles: true } } },
      });
      if (!employee || employee.orgId !== request.currentOrgId!) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
      }
      if (!employee.userId) {
        return reply.status(400).send({ ok: false, error: { code: "NO_USER", message: "Employee has no linked user account" } });
      }

      // Replace all roles with the single new role
      await prisma.$transaction(async (tx) => {
        await tx.userRole.deleteMany({ where: { userId: employee.userId! } });
        await tx.userRole.create({ data: { userId: employee.userId!, role } });
      });

      await auditLog(request, "ROLE_ASSIGNED", "user_role", employee.userId, null, { userId: employee.userId, role });
      return { ok: true, data: { role } };
    }
  );

  /**
   * DELETE /employees/:id — Deactivate employee (admin only)
   * Soft-delete: sets employee endDate + user isActive=false.
   * Hard deletion is intentionally not supported to preserve audit trails.
   */
  app.delete(
    "/:id",
    { preHandler: [requirePermission("employees.delete")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const employee = await prisma.employee.findUnique({
        where: { id },
        include: { user: true },
      });

      if (!employee || employee.orgId !== request.currentOrgId!) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
      }

      // Prevent admins from deactivating themselves
      if (employee.userId === request.currentUserId) {
        return reply.status(400).send({ ok: false, error: { code: "SELF_DELETE", message: "You cannot deactivate your own account" } });
      }

      await prisma.$transaction(async (tx) => {
        await tx.employee.update({ where: { id }, data: { endDate: new Date() } });
        if (employee.userId) {
          await tx.user.update({ where: { id: employee.userId }, data: { isActive: false } });
        }
      });

      await auditLog(request, "EMPLOYEE_DELETED", "employee", id, employee, null);
      return { ok: true, data: { message: "Employee deactivated" } };
    }
  );

  /**
   * PATCH /employees/:id/reactivate — Reactivate a previously deactivated employee (admin only)
   */
  app.patch(
    "/:id/reactivate",
    { preHandler: [requirePermission("employees.edit")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const employee = await prisma.employee.findUnique({
        where: { id },
        include: { user: true },
      });

      if (!employee || employee.orgId !== request.currentOrgId!) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
      }

      if (employee.user?.isActive) {
        return reply.status(400).send({ ok: false, error: { code: "ALREADY_ACTIVE", message: "Employee is already active" } });
      }

      await prisma.$transaction(async (tx) => {
        await tx.employee.update({ where: { id }, data: { endDate: null } });
        if (employee.userId) {
          await tx.user.update({ where: { id: employee.userId }, data: { isActive: true } });
        }
      });

      await auditLog(request, "EMPLOYEE_REACTIVATED", "employee", id, { isActive: false }, { isActive: true });
      return { ok: true, data: { message: "Employee reactivated" } };
    }
  );
}
