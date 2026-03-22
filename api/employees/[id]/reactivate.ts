import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../../lib/audit.js";
import type { AuthContext } from "../../../lib/auth.js";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx: AuthContext) => {
    const id = req.query.id as string;

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!employee || employee.orgId !== ctx.orgId) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    }

    if (employee.user?.isActive) {
      return res.status(400).json({ ok: false, error: { code: "ALREADY_ACTIVE", message: "Employee is already active" } });
    }

    await prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { endDate: null } });
      if (employee.userId) {
        await tx.user.update({ where: { id: employee.userId }, data: { isActive: true } });
      }
    });

    await auditLog(req, ctx, "EMPLOYEE_REACTIVATED", "employee", id, { isActive: false }, { isActive: true });
    return { ok: true, data: { message: "Employee reactivated" } };
  },
  { permission: "employees.edit", methods: ["PATCH"] }
);
