import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware.js";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const id = req.query.id as string;

    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!leave || leave.orgId !== ctx.orgId) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Leave not found" } });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status: "APPROVED", reviewedById: ctx.userId, reviewedAt: new Date() },
    });

    return { ok: true, data: updated };
  },
  { permission: "leave.approve", methods: ["POST"] }
);
