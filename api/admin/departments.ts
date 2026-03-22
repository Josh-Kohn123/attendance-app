import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit";
import { CreateDepartmentSchema } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    if (req.method === "GET") {
      const departments = await prisma.department.findMany({
        where: { orgId: ctx.orgId },
        include: { site: true, manager: true, _count: { select: { employees: true } } },
      });
      return { ok: true, data: departments };
    } else if (req.method === "POST") {
      const parsed = CreateDepartmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const dept = await prisma.department.create({
        data: {
          orgId: ctx.orgId,
          name: parsed.data.name,
          siteId: parsed.data.siteId,
          managerId: parsed.data.managerId,
        },
      });

      await auditLog(req, ctx, "DEPARTMENT_CREATED", "department", dept.id);
      return res.status(201).json({ ok: true, data: dept });
    }
  },
  { permission: "admin.departments", methods: ["GET", "POST"] }
);
