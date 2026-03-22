import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const employee = await prisma.employee.findFirst({
      where: { userId: ctx.userId, orgId: ctx.orgId },
    });
    if (!employee) {
      return res.status(404).json({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
    }

    const leaves = await prisma.leaveRequest.findMany({
      where: { employeeId: employee.id, orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
    });

    return { ok: true, data: leaves };
  },
  { methods: ["GET"] }
);
