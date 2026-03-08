import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";
import { requirePermission } from "@orbs/authz";
import { LeaveRequestSchema } from "@orbs/shared";
import { email } from "../services/email.js";

export async function leaveRoutes(app: FastifyInstance) {
  /**
   * POST /leave/request — Submit leave request
   */
  app.post(
    "/request",
    { preHandler: [requirePermission("leave.request")] },
    async (request, reply) => {
      const parsed = LeaveRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const employee = await prisma.employee.findFirst({
        where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
        include: { department: { include: { manager: true } } },
      });
      if (!employee) {
        return reply.status(404).send({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
      }

      // Idempotency
      const existing = await prisma.leaveRequest.findUnique({ where: { requestId: parsed.data.requestId } });
      if (existing) return { ok: true, data: existing };

      // Calculate total days — Israeli work week: Sun(0)–Thu(4); skip Fri(5) and Sat(6)
      const start = new Date(parsed.data.startDate);
      const end = new Date(parsed.data.endDate);
      let totalDays = 0;
      const current = new Date(start);
      while (current <= end) {
        const day = current.getDay();
        if (day !== 5 && day !== 6) totalDays++; // skip Friday and Saturday
        current.setDate(current.getDate() + 1);
      }

      const leave = await prisma.leaveRequest.create({
        data: {
          orgId: request.currentOrgId!,
          employeeId: employee.id,
          type: parsed.data.type,
          startDate: start,
          endDate: end,
          totalDays,
          reason: parsed.data.reason,
          requestId: parsed.data.requestId,
        },
      });

      // Notify manager via email
      if (employee.department?.manager) {
        email.notifyManager({
          orgId: request.currentOrgId!,
          managerEmail: employee.department.manager.email,
          managerName: employee.department.manager.displayName,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          eventType: `LEAVE_${parsed.data.type}`,
          date: `${parsed.data.startDate} to ${parsed.data.endDate}`,
          details: parsed.data.reason,
        }).catch(() => {});
      }

      return reply.status(201).send({ ok: true, data: leave });
    }
  );

  /**
   * GET /leave/self — Get own leave requests
   */
  app.get("/self", async (request, reply) => {
    const employee = await prisma.employee.findFirst({
      where: { userId: request.currentUserId!, orgId: request.currentOrgId! },
    });
    if (!employee) {
      return reply.status(404).send({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
    }

    const leaves = await prisma.leaveRequest.findMany({
      where: { employeeId: employee.id, orgId: request.currentOrgId! },
      orderBy: { createdAt: "desc" },
    });

    return { ok: true, data: leaves };
  });

  /**
   * GET /leave/team — Get team leave requests (manager)
   */
  app.get(
    "/team",
    { preHandler: [requirePermission("leave.view_team")] },
    async (request, reply) => {
      const ctx = request.authzContext!;
      const scopedDeptIds = ctx.scopes.filter((s) => s.scopeType === "department").map((s) => s.scopeId);

      const empWhere: any = { orgId: request.currentOrgId! };
      if (!ctx.roles.includes("admin") && scopedDeptIds.length > 0) {
        empWhere.departmentId = { in: scopedDeptIds };
      }

      const empIds = (await prisma.employee.findMany({ where: empWhere, select: { id: true } })).map((e) => e.id);

      const leaves = await prisma.leaveRequest.findMany({
        where: { orgId: request.currentOrgId!, employeeId: { in: empIds } },
        include: { employee: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      });

      return {
        ok: true,
        data: leaves.map((l) => ({
          ...l,
          employeeName: `${l.employee.firstName} ${l.employee.lastName}`,
        })),
      };
    }
  );

  /**
   * POST /leave/:id/approve
   */
  app.post(
    "/:id/approve",
    { preHandler: [requirePermission("leave.approve")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const leave = await prisma.leaveRequest.findUnique({
        where: { id },
        include: { employee: true },
      });
      if (!leave || leave.orgId !== request.currentOrgId!) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Leave not found" } });
      }

      const updated = await prisma.leaveRequest.update({
        where: { id },
        data: { status: "APPROVED", reviewedById: request.currentUserId!, reviewedAt: new Date() },
      });

      const reviewer = await prisma.user.findUnique({ where: { id: request.currentUserId! } });
      email.notifyEmployee({
        orgId: request.currentOrgId!,
        employeeEmail: leave.employee.email,
        employeeName: `${leave.employee.firstName} ${leave.employee.lastName}`,
        eventType: `LEAVE_${leave.type}`,
        status: "APPROVED",
        reviewerName: reviewer?.displayName ?? "Manager",
      }).catch(() => {});

      return { ok: true, data: updated };
    }
  );

  /**
   * POST /leave/:id/reject
   */
  app.post(
    "/:id/reject",
    { preHandler: [requirePermission("leave.approve")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const leave = await prisma.leaveRequest.findUnique({
        where: { id },
        include: { employee: true },
      });
      if (!leave || leave.orgId !== request.currentOrgId!) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Leave not found" } });
      }

      const updated = await prisma.leaveRequest.update({
        where: { id },
        data: { status: "REJECTED", reviewedById: request.currentUserId!, reviewedAt: new Date() },
      });

      return { ok: true, data: updated };
    }
  );
}
