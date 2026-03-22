import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { page = "1", limit = "50", action, userId } = req.query as {
      page?: string;
      limit?: string;
      action?: string;
      userId?: string;
    };
    const pg = parseInt(page);
    const lim = parseInt(limit);

    const where: any = { orgId: ctx.orgId };
    if (action) where.action = action;
    if (userId) where.userId = userId;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { displayName: true, email: true } } },
        orderBy: { createdAt: "desc" },
        skip: (pg - 1) * lim,
        take: lim,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { ok: true, data: { items: logs, total, page: pg, limit: lim, totalPages: Math.ceil(total / lim) } };
  },
  { permission: "admin.audit_log", methods: ["GET"] }
);
