import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware.js";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const org = await prisma.org.findUnique({ where: { id: ctx.orgId } });
    return { ok: true, data: { monthStartDay: org?.monthStartDay ?? 26 } };
  },
  { methods: ["GET"] }
);
