import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../../lib/audit.js";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { userId, role } = req.body as { userId: string; role: string };

    const userRole = await prisma.userRole.upsert({
      where: { userId_role: { userId, role } },
      update: {},
      create: { userId, role },
    });

    await auditLog(req, ctx, "ROLE_ASSIGNED", "user_role", userRole.id, null, { userId, role });
    return { ok: true, data: userRole };
  },
  { permission: "admin.roles", methods: ["POST"] }
);
