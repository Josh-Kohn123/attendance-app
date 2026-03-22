import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit.js";
import { UpdatePolicySchema } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    if (req.method === "GET") {
      const org = await prisma.org.findUnique({ where: { id: ctx.orgId } });
      return { ok: true, data: org };
    } else if (req.method === "PATCH") {
      const parsed = UpdatePolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const before = await prisma.org.findUnique({ where: { id: ctx.orgId } });
      const updated = await prisma.org.update({ where: { id: ctx.orgId }, data: parsed.data });
      await auditLog(req, ctx, "POLICY_UPDATED", "org", ctx.orgId, before, updated);

      return { ok: true, data: updated };
    }
  },
  { permission: "admin.policies", methods: ["GET", "PATCH"] }
);
