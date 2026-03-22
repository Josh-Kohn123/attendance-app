import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit.js";
import { CreateEmployeeSchema } from "@orbs/shared";
import { hasPermission } from "@orbs/authz";
import type { AuthContext } from "../../lib/auth.js";

export default withAuth(async (req: VercelRequest, res: VercelResponse, ctx: AuthContext) => {
  // GET /api/employees — list employees (scope-filtered, no specific permission)
  if (req.method === "GET") {
    const { page = "1", limit = "50", search, departmentId, siteId } = req.query as Record<string, string>;

    const where: any = { orgId: ctx.orgId };

    // Scope filtering based on roles
    if (
      ctx.authzContext.roles.includes("employee") &&
      !ctx.authzContext.roles.includes("admin") &&
      !ctx.authzContext.roles.includes("manager")
    ) {
      where.userId = ctx.userId;
    } else if (ctx.authzContext.roles.includes("manager") && !ctx.authzContext.roles.includes("admin")) {
      const scopedDeptIds = ctx.authzContext.scopes
        .filter((s: any) => s.scopeType === "department")
        .map((s: any) => s.scopeId);
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
  }

  // POST /api/employees — create employee (requires employees.create)
  if (req.method === "POST") {
    if (!hasPermission(ctx.authzContext, "employees.create")) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Missing permission: employees.create" } });
    }

    const parsed = CreateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const data = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          orgId: ctx.orgId,
          email: data.email,
          displayName: `${data.firstName} ${data.lastName}`,
          userRoles: { create: { role: data.role } },
        },
      });

      const employee = await tx.employee.create({
        data: {
          orgId: ctx.orgId,
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

      await tx.positionHistory.create({
        data: {
          employeeId: employee.id,
          position: data.position ?? "Employee",
          startDate: new Date(data.startDate),
        },
      });

      return employee;
    });

    await auditLog(req, ctx, "EMPLOYEE_CREATED", "employee", result.id, null, data);

    return res.status(201).json({ ok: true, data: result });
  }

  return res.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: `${req.method} not allowed` } });
}, { methods: ["GET", "POST"] });
