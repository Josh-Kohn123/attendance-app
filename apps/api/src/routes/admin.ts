import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";
import { requirePermission } from "@orbs/authz";
import {
  UpdatePolicySchema,
  CreateHolidaySchema,
  CreateDepartmentSchema,
  CreateSiteSchema,
} from "@orbs/shared";
import { auditLog } from "../services/audit.js";

export async function adminRoutes(app: FastifyInstance) {
  // ─── Policies ─────────────────────────────────────────────────

  /**
   * GET /admin/policies/public — Returns non-sensitive org config (e.g. monthStartDay).
   * Any authenticated user can access this (no admin permission required).
   */
  app.get(
    "/policies/public",
    async (request, reply) => {
      if (!request.currentOrgId) {
        return reply.status(401).send({ ok: false, error: { code: "UNAUTHORIZED", message: "Auth required" } });
      }
      const org = await prisma.org.findUnique({ where: { id: request.currentOrgId } });
      return { ok: true, data: { monthStartDay: org?.monthStartDay ?? 26 } };
    }
  );

  app.get(
    "/policies",
    { preHandler: [requirePermission("admin.policies")] },
    async (request) => {
      const org = await prisma.org.findUnique({ where: { id: request.currentOrgId! } });
      return { ok: true, data: org };
    }
  );

  app.patch(
    "/policies",
    { preHandler: [requirePermission("admin.policies")] },
    async (request, reply) => {
      const parsed = UpdatePolicySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const before = await prisma.org.findUnique({ where: { id: request.currentOrgId! } });
      const updated = await prisma.org.update({ where: { id: request.currentOrgId! }, data: parsed.data });
      await auditLog(request, "POLICY_UPDATED", "org", request.currentOrgId!, before, updated);

      return { ok: true, data: updated };
    }
  );

  // ─── Holidays ─────────────────────────────────────────────────

  app.get(
    "/holidays",
    { preHandler: [requirePermission("admin.holidays")] },
    async (request) => {
      const holidays = await prisma.holiday.findMany({
        where: { orgId: request.currentOrgId! },
        orderBy: { date: "asc" },
      });
      return { ok: true, data: holidays };
    }
  );

  app.post(
    "/holidays",
    { preHandler: [requirePermission("admin.holidays")] },
    async (request, reply) => {
      const parsed = CreateHolidaySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const holiday = await prisma.holiday.create({
        data: {
          orgId: request.currentOrgId!,
          name: parsed.data.name,
          date: new Date(parsed.data.date),
          recurring: parsed.data.recurring,
        },
      });

      await auditLog(request, "HOLIDAY_CREATED", "holiday", holiday.id);
      return reply.status(201).send({ ok: true, data: holiday });
    }
  );

  /**
   * GET /admin/holidays/dates?from=YYYY-MM-DD&to=YYYY-MM-DD
   * Returns all holiday dates (as YYYY-MM-DD strings) in the given range.
   * Expands recurring holidays to the relevant years. No admin permission required — any auth user can fetch.
   */
  app.get(
    "/holidays/dates",
    async (request, reply) => {
      const { from, to } = request.query as { from?: string; to?: string };
      if (!from || !to) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "from and to required" } });
      }

      const holidays = await prisma.holiday.findMany({
        where: { orgId: request.currentOrgId! },
      });

      const fromDate = new Date(from);
      const toDate = new Date(to);
      const result: { date: string; name: string }[] = [];

      for (const h of holidays) {
        if (h.recurring) {
          // Expand recurring holidays across all years in the range
          for (let y = fromDate.getFullYear(); y <= toDate.getFullYear(); y++) {
            const d = new Date(h.date);
            d.setFullYear(y);
            if (d >= fromDate && d <= toDate) {
              result.push({ date: d.toISOString().split("T")[0], name: h.name });
            }
          }
        } else {
          const d = new Date(h.date);
          if (d >= fromDate && d <= toDate) {
            result.push({ date: d.toISOString().split("T")[0], name: h.name });
          }
        }
      }

      return { ok: true, data: result };
    }
  );

  // ─── Departments ──────────────────────────────────────────────

  app.get(
    "/departments",
    { preHandler: [requirePermission("admin.departments")] },
    async (request) => {
      const departments = await prisma.department.findMany({
        where: { orgId: request.currentOrgId! },
        include: { site: true, manager: true, _count: { select: { employees: true } } },
      });
      return { ok: true, data: departments };
    }
  );

  app.post(
    "/departments",
    { preHandler: [requirePermission("admin.departments")] },
    async (request, reply) => {
      const parsed = CreateDepartmentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const dept = await prisma.department.create({
        data: {
          orgId: request.currentOrgId!,
          name: parsed.data.name,
          siteId: parsed.data.siteId,
          managerId: parsed.data.managerId,
        },
      });

      await auditLog(request, "DEPARTMENT_CREATED", "department", dept.id);
      return reply.status(201).send({ ok: true, data: dept });
    }
  );

  // ─── Sites ────────────────────────────────────────────────────

  app.get(
    "/sites",
    { preHandler: [requirePermission("admin.sites")] },
    async (request) => {
      const sites = await prisma.site.findMany({
        where: { orgId: request.currentOrgId! },
        include: { _count: { select: { employees: true, departments: true } } },
      });
      return { ok: true, data: sites };
    }
  );

  app.post(
    "/sites",
    { preHandler: [requirePermission("admin.sites")] },
    async (request, reply) => {
      const parsed = CreateSiteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const site = await prisma.site.create({
        data: { orgId: request.currentOrgId!, name: parsed.data.name, address: parsed.data.address },
      });

      await auditLog(request, "SITE_CREATED", "site", site.id);
      return reply.status(201).send({ ok: true, data: site });
    }
  );

  // ─── Audit Log ────────────────────────────────────────────────

  app.get(
    "/audit-log",
    { preHandler: [requirePermission("admin.audit_log")] },
    async (request) => {
      const { page = "1", limit = "50", action, userId } = request.query as any;
      const pg = parseInt(page);
      const lim = parseInt(limit);

      const where: any = { orgId: request.currentOrgId! };
      if (action) where.action = action;
      if (userId) where.userId = userId;

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: { user: { select: { displayName: true, email: true } } },
          orderBy: { createdAt: "desc" },
          skip: (pg - 1) * lim,
          take: lim,
        }),
        prisma.auditLog.count({ where }),
      ]);

      return { ok: true, data: { items: logs, total, page: pg, limit: lim, totalPages: Math.ceil(total / lim) } };
    }
  );

  // ─── Admin users list (for calendar digest dropdown) ──────────

  app.get(
    "/admin-users",
    { preHandler: [requirePermission("admin.policies")] },
    async (request) => {
      // Return all users in the org who have the admin role
      const adminRoles = await prisma.userRole.findMany({
        where: { role: "admin", user: { orgId: request.currentOrgId! } },
        include: { user: { select: { id: true, displayName: true, email: true } } },
      });

      return { ok: true, data: adminRoles.map((r) => r.user) };
    }
  );

  // ─── Roles Management ─────────────────────────────────────────

  app.post(
    "/roles/assign",
    { preHandler: [requirePermission("admin.roles")] },
    async (request, reply) => {
      const { userId, role } = request.body as { userId: string; role: string };

      const userRole = await prisma.userRole.upsert({
        where: { userId_role: { userId, role } },
        update: {},
        create: { userId, role },
      });

      await auditLog(request, "ROLE_ASSIGNED", "user_role", userRole.id, null, { userId, role });
      return { ok: true, data: userRole };
    }
  );

  app.post(
    "/roles/revoke",
    { preHandler: [requirePermission("admin.roles")] },
    async (request, reply) => {
      const { userId, role } = request.body as { userId: string; role: string };

      await prisma.userRole.deleteMany({ where: { userId, role } });
      await auditLog(request, "ROLE_REVOKED", "user_role", null, { userId, role }, null);

      return { ok: true, data: { message: "Role revoked" } };
    }
  );
}
