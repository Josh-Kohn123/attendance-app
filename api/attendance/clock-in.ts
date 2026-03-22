import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware";
import { prisma } from "@orbs/db";
import { ClockInSchema } from "@orbs/shared";
import { email } from "../../apps/api/src/services/email.js";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = ClockInSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const { siteId, source, clientTimestamp, requestId, notes } = parsed.data;

    // Get employee record
    const employee = await prisma.employee.findFirst({
      where: { userId: ctx.userId, orgId: ctx.orgId },
    });

    if (!employee) {
      return res.status(404).json({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record found" } });
    }

    // Idempotency check
    const existing = await prisma.attendanceEvent.findUnique({ where: { requestId } });
    if (existing) {
      return { ok: true, data: existing };
    }

    // Create event (append-only)
    const event = await prisma.attendanceEvent.create({
      data: {
        orgId: ctx.orgId,
        employeeId: employee.id,
        siteId,
        eventType: "CLOCK_IN",
        source,
        clientTimestamp: clientTimestamp ? new Date(clientTimestamp) : null,
        createdByUserId: ctx.userId,
        requestId,
        notes,
      },
    });

    // Email notification to manager (async, non-blocking)
    const dept = employee.departmentId
      ? await prisma.department.findUnique({
          where: { id: employee.departmentId },
          include: { manager: true },
        })
      : null;

    if (dept?.manager) {
      email.notifyManager({
        orgId: ctx.orgId,
        managerEmail: dept.manager.email,
        managerName: dept.manager.displayName,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        eventType: "CLOCK_IN",
        date: new Date().toISOString().split("T")[0],
      }).catch(() => {});
    }

    return { ok: true, data: event };
  },
  { permission: "attendance.clock_in", methods: ["POST"] }
);
