import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";
import { requirePermission } from "@orbs/authz";
import { ExportRequestSchema, ReportLockSchema, ReportSignSchema } from "@orbs/shared";
import { email } from "../services/email.js";
import { auditLog } from "../services/audit.js";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export async function reportRoutes(app: FastifyInstance) {
  /**
   * GET /reports/team — Team attendance summary
   */
  app.get(
    "/team",
    { preHandler: [requirePermission("reports.view_team")] },
    async (request, reply) => {
      const { from, to } = request.query as { from: string; to: string };
      if (!from || !to) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "from and to required" } });
      }

      const ctx = request.authzContext!;
      const scopedDeptIds = ctx.scopes.filter((s) => s.scopeType === "department").map((s) => s.scopeId);
      const empWhere: any = { orgId: request.currentOrgId! };
      if (!ctx.roles.includes("admin") && scopedDeptIds.length > 0) {
        empWhere.departmentId = { in: scopedDeptIds };
      }

      const employees = await prisma.employee.findMany({
        where: empWhere,
        include: { department: true, site: true },
      });

      const empIds = employees.map((e) => e.id);
      const events = await prisma.attendanceEvent.findMany({
        where: {
          orgId: request.currentOrgId!,
          employeeId: { in: empIds },
          eventType: "CLOCK_IN",
          serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
        },
      });

      // Group by employee and status (stored in notes field)
      const eventsByEmployee = new Map<string, { total: number; present: number; sick: number; vacation: number; reserves: number; halfDay: number }>();
      for (const event of events) {
        const existing = eventsByEmployee.get(event.employeeId) ?? { total: 0, present: 0, sick: 0, vacation: 0, reserves: 0, halfDay: 0 };
        const status = ((event.notes as string) ?? "PRESENT").toUpperCase();
        existing.total += 1;
        if (status === "SICK") existing.sick += 1;
        else if (status === "VACATION") existing.vacation += 1;
        else if (status === "RESERVES") existing.reserves += 1;
        else if (status === "HALF_DAY") existing.halfDay += 1;
        else existing.present += 1; // PRESENT or anything unrecognised
        eventsByEmployee.set(event.employeeId, existing);
      }

      const summary = employees.map((emp) => {
        const counts = eventsByEmployee.get(emp.id) ?? { total: 0, present: 0, sick: 0, vacation: 0, reserves: 0, halfDay: 0 };
        return {
          employeeId: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          department: emp.department?.name ?? "N/A",
          site: emp.site.name,
          totalDays: counts.total,
          present: counts.present,
          sick: counts.sick,
          vacation: counts.vacation,
          reserves: counts.reserves,
          halfDay: counts.halfDay,
        };
      });

      return { ok: true, data: summary };
    }
  );

  /**
   * GET /reports/company — Company-wide summary (admin only)
   */
  app.get(
    "/company",
    { preHandler: [requirePermission("reports.view_all")] },
    async (request, reply) => {
      const { from, to } = request.query as { from: string; to: string };
      if (!from || !to) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "from and to required" } });
      }

      const departments = await prisma.department.findMany({
        where: { orgId: request.currentOrgId! },
        include: { employees: { where: { isActive: true } } },
      });

      const allEmpIds = departments.flatMap((d) => d.employees.map((e) => e.id));
      const events = await prisma.attendanceEvent.findMany({
        where: {
          orgId: request.currentOrgId!,
          employeeId: { in: allEmpIds },
          eventType: "CLOCK_IN",
          serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
        },
      });

      const eventsByEmp = new Map<string, number>();
      for (const e of events) {
        eventsByEmp.set(e.employeeId, (eventsByEmp.get(e.employeeId) ?? 0) + 1);
      }

      const summary = departments.map((dept) => ({
        departmentId: dept.id,
        departmentName: dept.name,
        employeeCount: dept.employees.length,
        totalAttendanceDays: dept.employees.reduce((sum, emp) => sum + (eventsByEmp.get(emp.id) ?? 0), 0),
      }));

      return { ok: true, data: summary };
    }
  );

  /**
   * GET /reports/download?format=EXCEL|PDF&from=YYYY-MM-DD&to=YYYY-MM-DD
   * Generates and streams the file directly as a browser download.
   */
  app.get(
    "/download",
    { preHandler: [requirePermission("reports.export")] },
    async (request, reply) => {
      const { format, from, to } = request.query as { format?: string; from?: string; to?: string };
      if (!format || !from || !to) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "format, from, and to required" } });
      }

      const ctx = request.authzContext!;
      const empWhere: any = { orgId: request.currentOrgId! };
      if (!ctx.roles.includes("admin")) {
        const scopedDeptIds = ctx.scopes.filter((s: any) => s.scopeType === "department").map((s: any) => s.scopeId);
        if (scopedDeptIds.length > 0) empWhere.departmentId = { in: scopedDeptIds };
      }

      const employees = await prisma.employee.findMany({
        where: empWhere,
        include: { department: true, site: true },
        orderBy: { lastName: "asc" },
      });

      const empIds = employees.map((e: any) => e.id);
      const events = await prisma.attendanceEvent.findMany({
        where: {
          orgId: request.currentOrgId!,
          employeeId: { in: empIds },
          eventType: "CLOCK_IN",
          serverTimestamp: { gte: new Date(from), lte: new Date(`${to}T23:59:59Z`) },
        },
      });

      // Group by employee + status
      const eventsByEmp = new Map<string, { total: number; present: number; sick: number; vacation: number; reserves: number; halfDay: number }>();
      for (const ev of events) {
        const counts = eventsByEmp.get(ev.employeeId) ?? { total: 0, present: 0, sick: 0, vacation: 0, reserves: 0, halfDay: 0 };
        const status = ((ev.notes as string) ?? "PRESENT").toUpperCase();
        counts.total += 1;
        if (status === "SICK") counts.sick += 1;
        else if (status === "VACATION") counts.vacation += 1;
        else if (status === "RESERVES") counts.reserves += 1;
        else if (status === "HALF_DAY") counts.halfDay += 1;
        else counts.present += 1;
        eventsByEmp.set(ev.employeeId, counts);
      }

      // Fetch monthly report status for each employee for this period's month/year
      const fromDate = new Date(from);
      const reportMonth = fromDate.getMonth() + 1; // 1-indexed
      const reportYear = fromDate.getFullYear();
      const monthlyReports = await prisma.monthlyReport.findMany({
        where: {
          orgId: request.currentOrgId!,
          employeeId: { in: empIds },
          month: reportMonth,
          year: reportYear,
        },
      });
      const reportStatusByEmpId = new Map(monthlyReports.map((r: any) => [r.employeeId, r.status as string]));

      const rows = employees.map((emp: any) => {
        const c = eventsByEmp.get(emp.id) ?? { total: 0, present: 0, sick: 0, vacation: 0, reserves: 0, halfDay: 0 };
        const rawStatus = reportStatusByEmpId.get(emp.id) ?? "DRAFT";
        const reportStatusLabel: Record<string, string> = { DRAFT: "Pending Submission", SUBMITTED: "Submitted", APPROVED: "Approved", REJECTED: "Rejected" };
        return {
          name: `${emp.firstName} ${emp.lastName}`,
          department: emp.department?.name ?? "N/A",
          reportStatus: reportStatusLabel[rawStatus] ?? rawStatus,
          total: c.total, present: c.present, sick: c.sick, vacation: c.vacation, reserves: c.reserves, halfDay: c.halfDay,
        };
      });

      const period = `${from} to ${to}`;

      await auditLog(request, "REPORT_EXPORTED", "report_download", null as any, null, { format, from, to });

      if (format.toUpperCase() === "EXCEL") {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Attendance Report");

        // Title row
        ws.mergeCells("A1:I1");
        const titleCell = ws.getCell("A1");
        titleCell.value = `Attendance Report — ${period}`;
        titleCell.font = { size: 14, bold: true };
        titleCell.alignment = { horizontal: "center" };

        // Headers: Employee | Department | Report Status | Total | Present | Sick | Vacation | Reserves | Half Day
        const headerRow = ws.addRow(["Employee", "Department", "Report Status", "Total", "Present", "Sick", "Vacation", "Reserves", "Half Day"]);
        headerRow.font = { bold: true };
        headerRow.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } };
          cell.border = { bottom: { style: "thin" } };
        });

        for (const row of rows) {
          const dataRow = ws.addRow([row.name, row.department, row.reportStatus, row.total, row.present, row.sick, row.vacation, row.reserves, row.halfDay]);
          // Color-code the Report Status cell (column 3)
          const statusCell = dataRow.getCell(3);
          const statusColors: Record<string, string> = {
            "Approved": "FFD1FAE5",
            "Submitted": "FFDBEAFE",
            "Rejected": "FFFEE2E2",
            "Pending Submission": "FFF3F4F6",
          };
          const statusColor = statusColors[row.reportStatus] ?? "FFF3F4F6";
          statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: statusColor } };
        }

        // Auto-width columns
        ws.columns.forEach((col) => {
          let maxLen = 10;
          col.eachCell?.({ includeEmpty: true }, (cell) => {
            const len = String(cell.value ?? "").length;
            if (len > maxLen) maxLen = len;
          });
          col.width = Math.min(maxLen + 2, 40);
        });

        const buf = await wb.xlsx.writeBuffer();

        return reply
          .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .header("Content-Disposition", `attachment; filename="attendance-report-${from}-to-${to}.xlsx"`)
          .send(Buffer.from(buf as ArrayBuffer));
      }

      if (format.toUpperCase() === "PDF") {
        return new Promise<void>((resolve, reject) => {
          const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
          const chunks: Buffer[] = [];
          doc.on("data", (chunk: Buffer) => chunks.push(chunk));
          doc.on("end", () => {
            const buf = Buffer.concat(chunks);
            reply
              .header("Content-Type", "application/pdf")
              .header("Content-Disposition", `attachment; filename="attendance-report-${from}-to-${to}.pdf"`)
              .send(buf);
            resolve();
          });
          doc.on("error", reject);

          // Title
          doc.fontSize(16).text(`Attendance Report`, { align: "center" });
          doc.fontSize(10).text(`Period: ${period}`, { align: "center" });
          doc.moveDown(1);

          // Table header: Employee | Department | Report Status | Total | Present | Sick | Vacation | Reserves | Half Day
          const cols = ["Employee", "Department", "Report Status", "Total", "Present", "Sick", "Vacation", "Reserves", "Half Day"];
          const colWidths = [140, 110, 90, 45, 45, 45, 55, 55, 50];
          const startX = 40;
          let y = doc.y;

          doc.fontSize(8).font("Helvetica-Bold");
          let x = startX;
          for (let i = 0; i < cols.length; i++) {
            doc.text(cols[i], x, y, { width: colWidths[i], align: "left" });
            x += colWidths[i] + 6;
          }
          y += 16;
          doc.moveTo(startX, y).lineTo(startX + 690, y).stroke();
          y += 6;

          // Table rows
          doc.font("Helvetica").fontSize(8);
          for (const row of rows) {
            if (y > 540) {
              doc.addPage();
              y = 40;
            }
            const values = [row.name, row.department, row.reportStatus, String(row.total), String(row.present), String(row.sick), String(row.vacation), String(row.reserves), String(row.halfDay)];
            x = startX;
            for (let i = 0; i < values.length; i++) {
              doc.text(values[i], x, y, { width: colWidths[i], align: "left" });
              x += colWidths[i] + 6;
            }
            y += 14;
          }

          doc.end();
        });
      }

      return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "format must be EXCEL or PDF" } });
    }
  );

  /**
   * POST /reports/lock — Lock a report for a given month
   */
  app.post(
    "/lock",
    { preHandler: [requirePermission("reports.lock")] },
    async (request, reply) => {
      const parsed = ReportLockSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const lock = await prisma.reportLock.create({
        data: {
          orgId: request.currentOrgId!,
          month: parsed.data.month,
          year: parsed.data.year,
          siteId: parsed.data.siteId,
          departmentId: parsed.data.departmentId,
          lockedById: request.currentUserId!,
        },
      });

      await auditLog(request, "REPORT_LOCKED", "report_lock", lock.id);

      const user = await prisma.user.findUnique({ where: { id: request.currentUserId! } });
      email.notifyReportAction({
        orgId: request.currentOrgId!,
        recipientEmail: user?.email ?? "",
        action: "locked",
        period: `${parsed.data.month}/${parsed.data.year}`,
        actorName: user?.displayName ?? "Unknown",
      }).catch(() => {});

      return { ok: true, data: lock };
    }
  );

  /**
   * POST /reports/sign — Sign a locked report
   */
  app.post(
    "/sign",
    { preHandler: [requirePermission("reports.sign")] },
    async (request, reply) => {
      const parsed = ReportSignSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: parsed.error.message } });
      }

      const lock = await prisma.reportLock.findUnique({ where: { id: parsed.data.reportLockId } });
      if (!lock || lock.orgId !== request.currentOrgId!) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Report lock not found" } });
      }

      const signature = await prisma.reportSignature.create({
        data: {
          reportLockId: lock.id,
          signedById: request.currentUserId!,
          signatureData: parsed.data.signatureData,
        },
      });

      await auditLog(request, "REPORT_SIGNED", "report_signature", signature.id);

      return { ok: true, data: signature };
    }
  );
}
