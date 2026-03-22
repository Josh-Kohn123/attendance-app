import type { VercelRequest, VercelResponse } from "@vercel/node";
import { prisma } from "@orbs/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok", database: "connected" });
  } catch {
    res.status(200).json({ status: "error", database: "disconnected" });
  }
}
