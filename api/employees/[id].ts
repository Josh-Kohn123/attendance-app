import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit";
import { UpdateEmployeeSchema } from "@orbs/shared";
import { hasPermission } from "@orbs/authz";
import type { AuthContext } from "../../lib/auth";

export default withAuth(async (req: VercelRequest, res: VercelResponse, ctx: AuthContext) => {
  const id = req.query.id as string;

  // GET /api/employees/[id] — get single employee (no specific permission)
  if (req.method === "GET") {
    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        department: true,
        site: true,
        positionHistory: { orderBy: { startDate: "desc" } },
      },
    });

    if (!employee || employee.orgId !== ctx.orgId) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    }

    return { ok: true, data: employee };
  }

  // PATCH /api/employees/[id] — update employee (requires employees.edit)
  if (req.method === "PATCH") {
    if (!hasPermission(ctx.authzContext, "employees.edit")) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Missing permission: employees.edit" } });
    }

    const parsed = UpdateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing || existing.orgId !== ctx.orgId) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
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
    await auditLog(req, ctx, "EMPLOYEE_UPDATED", "employee", id, existing, updated);

    return { ok: true, data: updated };
  }

  // DELETE /api/employees/[id] — soft-delete employee (requires employees.delete)
  if (req.method === "DELETE") {
    if (!hasPermission(ctx.authzContext, "employees.delete")) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Missing permission: employees.delete" } });
    }

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!employee || employee.orgId !== ctx.orgId) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    }

    // Prevent admins from deactivating themselves
    if (employee.userId === ctx.userId) {
      return res.status(400).json({ ok: false, error: { code: "SELF_DELETE", message: "You cannot deactivate your own account" } });
    }

    await prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { endDate: new Date() } });
      if (employee.userId) {
        await tx.user.update({ where: { id: employee.userId }, data: { isActive: false } });
      }
    });

    await auditLog(req, ctx, "EMPLOYEE_DELETED", "employee", id, employee, null);
    return { ok: true, data: { message: "Employee deactivated" } };
  }

  return res.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: `${req.method} not allowed` } });
}, { methods: ["GET", "PATCH", "DELETE"] });
