import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    // Return all users in the org who have the admin role
    const adminRoles = await prisma.userRole.findMany({
      where: { role: "admin", user: { orgId: ctx.orgId } },
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });

    return { ok: true, data: adminRoles.map((r) => r.user) };
  },
  { permission: "admin.policies", methods: ["GET"] }
);
