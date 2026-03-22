import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit.js";
import { CreateSiteSchema } from "@orbs/shared";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    if (req.method === "GET") {
      const sites = await prisma.site.findMany({
        where: { orgId: ctx.orgId },
        include: { _count: { select: { employees: true, departments: true } } },
      });
      return { ok: true, data: sites };
    } else if (req.method === "POST") {
      const parsed = CreateSiteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const site = await prisma.site.create({
        data: { orgId: ctx.orgId, name: parsed.data.name, address: parsed.data.address },
      });

      await auditLog(req, ctx, "SITE_CREATED", "site", site.id);
      return res.status(201).json({ ok: true, data: site });
    }
  },
  { permission: "admin.sites", methods: ["GET", "POST"] }
);
