import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { month, year } = req.query as { month?: string; year?: string };
    const m = Number(month);
    const y = Number(year);
    if (!m || !y || m < 1 || m > 12 || y < 2020) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "month (1-12) and year required" } });
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: ctx.userId, orgId: ctx.orgId },
    });

    // No employee record — still return DRAFT so the UI shows the submit button
    // (submit endpoint will give a helpful error if they try to submit without a record)
    if (!employee) {
      return {
        ok: true,
        data: {
          id: null,
          status: "DRAFT",
          submittedAt: null,
          reviewedAt: null,
          reviewerName: null,
          reviewComment: null,
          lockedAt: null,
          noEmployeeRecord: true,
        },
      };
    }

    const report = await prisma.monthlyReport.findUnique({
      where: {
        orgId_employeeId_month_year: {
          orgId: ctx.orgId,
          employeeId: employee.id,
          month: m,
          year: y,
        },
      },
      include: {
        reviewer: { select: { displayName: true } },
      },
    });

    // If no report exists yet, it's in DRAFT status
    return {
      ok: true,
      data: report
        ? {
            id: report.id,
            status: report.status,
            submittedAt: report.submittedAt,
            reviewedAt: report.reviewedAt,
            reviewerName: report.reviewer?.displayName ?? null,
            reviewComment: report.reviewComment,
            lockedAt: report.lockedAt,
          }
        : {
            id: null,
            status: "DRAFT",
            submittedAt: null,
            reviewedAt: null,
            reviewerName: null,
            reviewComment: null,
            lockedAt: null,
          },
    };
  },
  { permission: "reports.view_self", methods: ["GET"] },
);
