import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    if (req.method === "GET") {
      // List all ignored titles for this org
      const ignored = await prisma.ignoredCalendarEvent.findMany({
        where: { orgId: ctx.orgId },
        orderBy: { createdAt: "desc" },
        select: { id: true, eventTitle: true, createdAt: true },
      });
      return { ok: true, data: ignored };
    }

    if (req.method === "POST") {
      const { eventTitle } = (req.body ?? {}) as { eventTitle?: string };
      if (!eventTitle || typeof eventTitle !== "string" || !eventTitle.trim()) {
        return res.status(400).json({
          ok: false,
          error: { code: "VALIDATION", message: "eventTitle is required" },
        });
      }

      const trimmed = eventTitle.trim();

      // Upsert to handle duplicates gracefully
      const record = await prisma.ignoredCalendarEvent.upsert({
        where: {
          orgId_eventTitle: { orgId: ctx.orgId, eventTitle: trimmed },
        },
        update: {},
        create: { orgId: ctx.orgId, eventTitle: trimmed },
      });

      return { ok: true, data: record };
    }

    if (req.method === "DELETE") {
      const eventTitle = req.query.eventTitle as string | undefined;
      if (!eventTitle || !eventTitle.trim()) {
        return res.status(400).json({
          ok: false,
          error: { code: "VALIDATION", message: "eventTitle query param is required" },
        });
      }

      const trimmed = eventTitle.trim();

      await prisma.ignoredCalendarEvent.deleteMany({
        where: { orgId: ctx.orgId, eventTitle: trimmed },
      });

      return { ok: true, data: { deleted: true } };
    }

    return res.status(405).json({
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "GET, POST, or DELETE required" },
    });
  },
  { permission: "admin.policies", methods: ["GET", "POST", "DELETE"] },
);
