import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";

export default withAuth(async (req, res, ctx) => {
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    include: {
      userRoles: true,
      employee: { include: { department: true, site: true } },
    },
  });

  if (!user) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "User not found" } });
  }

  return {
    ok: true,
    data: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      roles: user.userRoles.map((r) => r.role),
      employee: user.employee
        ? {
            id: user.employee.id,
            firstName: user.employee.firstName,
            lastName: user.employee.lastName,
            position: user.employee.position,
            department: user.employee.department?.name ?? null,
            site: user.employee.site.name,
          }
        : null,
    },
  };
}, { methods: ["GET"] });
