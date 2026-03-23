import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../../lib/middleware.js";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "from and to required" } });
    }

    const holidays = await prisma.holiday.findMany({
      where: { orgId: ctx.orgId },
    });

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const result: { date: string; name: string; halfDay: boolean }[] = [];

    for (const h of holidays) {
      if (h.recurring) {
        // Expand recurring holidays across all years in the range
        for (let y = fromDate.getFullYear(); y <= toDate.getFullYear(); y++) {
          const d = new Date(h.date);
          d.setFullYear(y);
          if (d >= fromDate && d <= toDate) {
            result.push({ date: d.toISOString().split("T")[0], name: h.name, halfDay: h.halfDay });
          }
        }
      } else {
        const d = new Date(h.date);
        if (d >= fromDate && d <= toDate) {
          result.push({ date: d.toISOString().split("T")[0], name: h.name, halfDay: h.halfDay });
        }
      }
    }

    return { ok: true, data: result };
  },
  { methods: ["GET"] }
);
