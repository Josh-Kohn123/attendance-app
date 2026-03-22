import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware";
import { prisma } from "@orbs/db";
import { auditLog } from "../../../lib/audit";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { userId, role } = req.body as { userId: string; role: string };

    await prisma.userRole.deleteMany({ where: { userId, role } });
    await auditLog(req, ctx, "ROLE_REVOKED", "user_role", null, { userId, role }, null);

    return { ok: true, data: { message: "Role revoked" } };
  },
  { permission: "admin.roles", methods: ["POST"] }
);
