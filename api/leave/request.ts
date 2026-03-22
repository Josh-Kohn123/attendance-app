import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { LeaveRequestSchema } from "@orbs/shared";
import { email } from "../../apps/api/src/services/email.js";

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const parsed = LeaveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
    }

    const employee = await prisma.employee.findFirst({
      where: { userId: ctx.userId, orgId: ctx.orgId },
      include: { department: { include: { manager: true } } },
    });
    if (!employee) {
      return res.status(404).json({ ok: false, error: { code: "NO_EMPLOYEE", message: "No employee record" } });
    }

    // Idempotency
    const existing = await prisma.leaveRequest.findUnique({ where: { requestId: parsed.data.requestId } });
    if (existing) return res.status(200).json({ ok: true, data: existing });

    // Calculate total days — Israeli work week: Sun(0)–Thu(4); skip Fri(5) and Sat(6)
    const start = new Date(parsed.data.startDate);
    const end = new Date(parsed.data.endDate);
    let totalDays = 0;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      if (day !== 5 && day !== 6) totalDays++; // skip Friday and Saturday
      current.setDate(current.getDate() + 1);
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        orgId: ctx.orgId,
        employeeId: employee.id,
        type: parsed.data.type,
        startDate: start,
        endDate: end,
        totalDays,
        reason: parsed.data.reason,
        requestId: parsed.data.requestId,
      },
    });

    // Notify manager via email
    if (employee.department?.manager) {
      email.notifyManager({
        orgId: ctx.orgId,
        managerEmail: employee.department.manager.email,
        managerName: employee.department.manager.displayName,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        eventType: `LEAVE_${parsed.data.type}`,
        date: `${parsed.data.startDate} to ${parsed.data.endDate}`,
        details: parsed.data.reason,
      }).catch(() => {});
    }

    return res.status(201).json({ ok: true, data: leave });
  },
  { permission: "leave.request", methods: ["POST"] }
);
