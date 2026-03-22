import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit";
import { NotifySubmitRequestSchema } from "@orbs/shared";
import { email } from "../../apps/api/src/services/email.js";
import type { AuthContext } from "../../lib/auth";

async function canManageEmployee(ctx: AuthContext, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, orgId: ctx.orgId, isActive: true },
    include: {
      manager: { select: { id: true, email: true, displayName: true } },
      department: { select: { name: true } },
    },
  });
  if (!employee) return { allowed: false as const, employee: null };
  if (ctx.authzContext.roles.includes("admin")) return { allowed: true as const, employee };
  if (ctx.authzContext.roles.includes("manager") && employee.managerId === ctx.userId) return { allowed: true as const, employee };
  return { allowed: false as const, employee: null };
}

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = NotifySubmitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const { employeeId, month, year } = parsed.data;

    const { allowed, employee } = await canManageEmployee(ctx, employeeId);
    if (!allowed || !employee) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "You cannot manage this employee" } });
    }

    const currentUser = await prisma.user.findUnique({ where: { id: ctx.userId } });

    await email.notifySubmitRequired({
      orgId: ctx.orgId,
      employeeEmail: employee.email,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      month,
      year,
      managerName: currentUser?.displayName ?? "Your manager",
    });

    await auditLog(
      req,
      ctx,
      "MONTHLY_REPORT_NOTIFY_SUBMIT",
      "employee",
      employeeId,
      null,
      { month, year, notifiedEmployee: employee.email },
    );

    return { ok: true };
  },
  { permission: "reports.review", methods: ["POST"] },
);
