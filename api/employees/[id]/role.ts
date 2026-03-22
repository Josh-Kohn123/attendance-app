import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware";
import { prisma } from "@orbs/db";
import { auditLog } from "../../../lib/audit";
import type { AuthContext } from "../../../lib/auth";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx: AuthContext) => {
    const id = req.query.id as string;
    const { role } = req.body as { role: string };

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: { user: { include: { userRoles: true } } },
    });

    if (!employee || employee.orgId !== ctx.orgId) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Employee not found" } });
    }

    if (!employee.userId) {
      return res.status(400).json({ ok: false, error: { code: "NO_USER", message: "Employee has no linked user account" } });
    }

    // Replace all roles with the single new role
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: employee.userId! } });
      await tx.userRole.create({ data: { userId: employee.userId!, role } });
    });

    await auditLog(req, ctx, "ROLE_ASSIGNED", "user_role", employee.userId, null, { userId: employee.userId, role });
    return { ok: true, data: { role } };
  },
  { permission: "employees.edit", methods: ["PATCH"] }
);
