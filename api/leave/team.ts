import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const scopedDeptIds = ctx.authzContext.scopes
      .filter((s) => s.scopeType === "department")
      .map((s) => s.scopeId);

    const empWhere: any = { orgId: ctx.orgId };
    if (!ctx.authzContext.roles.includes("admin") && scopedDeptIds.length > 0) {
      empWhere.departmentId = { in: scopedDeptIds };
    }

    const empIds = (await prisma.employee.findMany({ where: empWhere, select: { id: true } })).map((e) => e.id);

    const leaves = await prisma.leaveRequest.findMany({
      where: { orgId: ctx.orgId, employeeId: { in: empIds } },
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
  },
  { permission: "leave.view_team", methods: ["GET"] }
);
