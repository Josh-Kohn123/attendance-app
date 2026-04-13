import type { FastifyInstance } from "fastify";
import { prisma } from "@orbs/db";
import { requirePermission } from "@orbs/authz";
import { ExportRequestSchema, ReportLockSchema, ReportSignSchema } from "@orbs/shared";
import { email } from "../services/email.js";
import { auditLog } from "../services/audit.js";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";

// Hebrew day names (0=Sun ... 6=Sat)
const HEBREW_DAYS = ["יום א", "יום ב", "יום ג", "יום ד", "יום ה", "יום ו", "יום ש"];

// Status label mapping for the Event column
const STATUS_EVENT_LABEL: Record<string, string> = {
  PRESENT: "Present",
  SICK: "Sick",
  CHILD_SICK: "Child Sick",
  VACATION: "Vacation",
  RESERVES: "Military service",
  HALF_DAY: "Half Day Off",
  WORK_FROM_HOME: "Work From Home",
  PUBLIC_HOLIDAY: "Public Holiday - Paid",
  HOLIDAY_EVE: "Eve of Public Holiday - Half Day off - Paid",
  CHOICE_DAY: "Choice Day (יום בחירה)",
  ADVANCED_STUDY: "Advanced Study",
  DAY_OFF: "Day Off",
};

/**
 * Compute adjusted work hours for an employee based on employment percentage.
 * Full day = 8 hours, rounded to nearest 15 minutes.
 * Returns { entry: "HH:MM", exit: "HH:MM", totalHours: "HH:MM" } or null for non-work statuses.
 */
function getAdjustedHours(employmentPercentage: number, hasDaysOff: boolean, isHalfDay: boolean) {
  const baseMinutes = isHalfDay ? 240 : 480; // 4 or 8 hours
  let minutes = baseMinutes;

  // Only adjust proportionally if < 100% AND no specific days off configured
  if (employmentPercentage < 100 && !hasDaysOff) {
    minutes = Math.round((baseMinutes * employmentPercentage) / 100 / 15) * 15;
  }

  const startHour = 10;
  const startMin = 0;
  const endTotalMin = startHour * 60 + startMin + minutes;
  const endH = Math.floor(endTotalMin / 60);
  const endM = endTotalMin % 60;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return {
    entry: `${String(startHour).padStart(2, "0")}:${String(startMin).padStart(2, "0")} *`,
    exit: `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")} *`,
    totalHours: `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`,
    minutes,
  };
}

/** Check if a date is an Israeli weekend (Fri=5, Sat=6) */
function isWeekend(d: dayjs.Dayjs): boolean {
  return d.day() === 5 || d.day() === 6;
}

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
      const eventsByEmployee = new Map<string, { total: number; present: number; sick: number; childSick: number; vacation: number; reserves: number; halfDay: number; workFromHome: number; publicHoliday: number; holidayEve: number; choiceDay: number; advancedStudy: number; dayOff: number }>();
      for (const event of events) {
        const existing = eventsByEmployee.get(event.employeeId) ?? { total: 0, present: 0, sick: 0, childSick: 0, vacation: 0, reserves: 0, halfDay: 0, workFromHome: 0, publicHoliday: 0, holidayEve: 0, choiceDay: 0, advancedStudy: 0, dayOff: 0 };
        const status = ((event.notes as string) ?? "PRESENT").toUpperCase();
        existing.total += 1;
        if (status === "SICK") existing.sick += 1;
        else if (status === "CHILD_SICK") existing.childSick += 1;
        else if (status === "VACATION") existing.vacation += 1;
        else if (status === "RESERVES") existing.reserves += 1;
        else if (status === "HALF_DAY") existing.halfDay += 1;
        else if (status === "WORK_FROM_HOME") existing.workFromHome += 1;
        else if (status === "PUBLIC_HOLIDAY") existing.publicHoliday += 1;
        else if (status === "HOLIDAY_EVE") existing.holidayEve += 1;
        else if (status === "CHOICE_DAY") existing.choiceDay += 1;
        else if (status === "ADVANCED_STUDY") existing.advancedStudy += 1;
        else if (status === "DAY_OFF") existing.dayOff += 1;
        else existing.present += 1; // PRESENT or anything unrecognised
        eventsByEmployee.set(event.employeeId, existing);
      }

      const summary = employees.map((emp) => {
        const counts = eventsByEmployee.get(emp.id) ?? { total: 0, present: 0, sick: 0, childSick: 0, vacation: 0, reserves: 0, halfDay: 0, workFromHome: 0, publicHoliday: 0, holidayEve: 0, choiceDay: 0, advancedStudy: 0, dayOff: 0 };
        return {
          employeeId: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          department: emp.department?.name ?? "N/A",
          site: emp.site.name,
          totalDays: counts.total,
          present: counts.present,
          sick: counts.sick,
          childSick: counts.childSick,
          vacation: counts.vacation,
          reserves: counts.reserves,
          halfDay: counts.halfDay,
          workFromHome: counts.workFromHome,
          publicHoliday: counts.publicHoliday,
          dayOff: counts.dayOff,
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
   *
   * Generates two reports in a single file:
   *   Sheet 1 / Section 1: "Admin Report" — day-by-day log per employee
   *   Sheet 2 / Section 2: "report" (Summary) — one row per employee with totals
   *
   * For EXCEL: single .xlsx workbook with two sheets.
   * For PDF:   single .pdf with both sections.
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
      const empWhere: any = { orgId: request.currentOrgId!, isActive: true };
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

      // Build a lookup: employeeId → date → status
      const eventsByEmpDate = new Map<string, Map<string, string>>();
      for (const ev of events) {
        if (!eventsByEmpDate.has(ev.employeeId)) eventsByEmpDate.set(ev.employeeId, new Map());
        const dateStr = dayjs(ev.serverTimestamp).format("YYYY-MM-DD");
        const status = ((ev.notes as string) ?? "PRESENT").toUpperCase();
        eventsByEmpDate.get(ev.employeeId)!.set(dateStr, status);
      }

      // Also build summary counts per employee
      const empSummary = new Map<string, { total: number; present: number; sick: number; childSick: number; vacation: number; reserves: number; halfDay: number; workFromHome: number; publicHoliday: number; holidayEve: number; choiceDay: number; advancedStudy: number; dayOff: number }>();
      for (const ev of events) {
        const c = empSummary.get(ev.employeeId) ?? { total: 0, present: 0, sick: 0, childSick: 0, vacation: 0, reserves: 0, halfDay: 0, workFromHome: 0, publicHoliday: 0, holidayEve: 0, choiceDay: 0, advancedStudy: 0, dayOff: 0 };
        const status = ((ev.notes as string) ?? "PRESENT").toUpperCase();
        c.total += 1;
        if (status === "SICK") c.sick += 1;
        else if (status === "CHILD_SICK") c.childSick += 1;
        else if (status === "VACATION") c.vacation += 1;
        else if (status === "RESERVES") c.reserves += 1;
        else if (status === "HALF_DAY") c.halfDay += 1;
        else if (status === "WORK_FROM_HOME") c.workFromHome += 1;
        else if (status === "PUBLIC_HOLIDAY") c.publicHoliday += 1;
        else if (status === "HOLIDAY_EVE") c.holidayEve += 1;
        else if (status === "CHOICE_DAY") c.choiceDay += 1;
        else if (status === "ADVANCED_STUDY") c.advancedStudy += 1;
        else if (status === "DAY_OFF") c.dayOff += 1;
        else c.present += 1;
        empSummary.set(ev.employeeId, c);
      }

      // Generate all dates in range
      const allDates: dayjs.Dayjs[] = [];
      let cursor = dayjs(from);
      const endDate = dayjs(to);
      while (cursor.isBefore(endDate) || cursor.isSame(endDate, "day")) {
        allDates.push(cursor);
        cursor = cursor.add(1, "day");
      }

      const period = `${from} to ${to}`;
      await auditLog(request, "REPORT_EXPORTED", "report_download", null as any, null, { format, from, to });

      if (format.toUpperCase() === "EXCEL") {
        const wb = new ExcelJS.Workbook();

        // ────────────────────────────────────────────────────
        // Sheet 1: Admin Report (day-by-day per employee)
        // ────────────────────────────────────────────────────
        const ws1 = wb.addWorksheet("Admin Report");

        const adminHeaders = ["שם העובד", "תאריך", "יום", "סוג", "כניסה", "יציאה", "סך שעות", "אירוע"];
        const headerRow1 = ws1.addRow(adminHeaders);
        headerRow1.font = { bold: true, name: "Arial" };
        headerRow1.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } };
          cell.border = { bottom: { style: "thin" } };
          cell.alignment = { horizontal: "center" };
        });

        for (const emp of employees) {
          const empName = `${emp.firstName} ${emp.lastName}`;
          const empDates = eventsByEmpDate.get(emp.id) ?? new Map();
          const hasDaysOff = ((emp as any).daysOff ?? []).length > 0;
          const pct = (emp as any).employmentPercentage ?? 100;

          for (const date of allDates) {
            const dateStr = date.format("YYYY-MM-DD");
            const dayOfWeek = date.day(); // 0=Sun
            const hebrewDay = HEBREW_DAYS[dayOfWeek];
            const weekend = isWeekend(date);
            const status = empDates.get(dateStr);

            const dayType = weekend ? "סופ\"ש" : "יום חול";

            let entry = "";
            let exit = "";
            let totalHours = "";
            let eventLabel = "";

            if (!weekend && status) {
              if (status === "PRESENT" || status === "WORK_FROM_HOME") {
                // WFH counts as a work day with hours shown, but event column notes it
                const h = getAdjustedHours(pct, hasDaysOff, false);
                entry = h.entry;
                exit = h.exit;
                totalHours = h.totalHours;
                if (status === "WORK_FROM_HOME") {
                  eventLabel = STATUS_EVENT_LABEL[status] ?? status;
                }
              } else if (status === "HALF_DAY" || status === "HOLIDAY_EVE") {
                const h = getAdjustedHours(pct, hasDaysOff, true);
                entry = h.entry;
                exit = h.exit;
                totalHours = h.totalHours;
                eventLabel = STATUS_EVENT_LABEL[status] ?? status;
              } else {
                // Sick, Vacation, Reserves, etc. — no hours, just the event label
                eventLabel = STATUS_EVENT_LABEL[status] ?? status;
              }
            }

            ws1.addRow([empName, date.format("DD/MM"), hebrewDay, dayType, entry, exit, totalHours, eventLabel]);
          }
        }

        // Auto-width columns for admin report
        ws1.columns.forEach((col) => {
          let maxLen = 8;
          col.eachCell?.({ includeEmpty: true }, (cell) => {
            const len = String(cell.value ?? "").length;
            if (len > maxLen) maxLen = len;
          });
          col.width = Math.min(maxLen + 2, 30);
        });

        // ────────────────────────────────────────────────────
        // Sheet 2: Summary Report (one row per employee)
        // ────────────────────────────────────────────────────
        const ws2 = wb.addWorksheet("report");

        const summaryHeaders = ["שם עובד", "תג עובד", "ימי דיווח", "Vacation", "Military service", "Child sick", "Choice Day", "Advanced Study", "Half Day Off", "Sick day"];
        const headerRow2 = ws2.addRow(summaryHeaders);
        headerRow2.font = { bold: true, name: "Arial" };
        headerRow2.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } };
          cell.border = { bottom: { style: "thin" } };
          cell.alignment = { horizontal: "center" };
        });

        let totalVacation = 0;
        let totalReserves = 0;
        let totalChildSick = 0;
        let totalChoiceDay = 0;
        let totalAdvancedStudy = 0;
        let totalHalfDay = 0;
        let totalSick = 0;

        for (const emp of employees) {
          const c = empSummary.get(emp.id) ?? { total: 0, present: 0, sick: 0, childSick: 0, vacation: 0, reserves: 0, halfDay: 0, workFromHome: 0, publicHoliday: 0, holidayEve: 0, choiceDay: 0, advancedStudy: 0, dayOff: 0 };
          const attendanceDays = c.total;

          totalVacation += c.vacation;
          totalReserves += c.reserves;
          totalChildSick += c.childSick;
          totalChoiceDay += c.choiceDay;
          totalAdvancedStudy += c.advancedStudy;
          totalHalfDay += c.halfDay;
          totalSick += c.sick;

          ws2.addRow([
            `${emp.lastName} ${emp.firstName}`,
            (emp as any).employeeNumber ?? "",
            attendanceDays,
            c.vacation > 0 ? String(c.vacation) + ".0" : "",
            c.reserves > 0 ? String(c.reserves) + ".0" : "",
            c.childSick > 0 ? String(c.childSick) + ".0" : "",
            c.choiceDay > 0 ? String(c.choiceDay) + ".0" : "",
            c.advancedStudy > 0 ? String(c.advancedStudy) + ".0" : "",
            c.halfDay > 0 ? String(c.halfDay) + ".0" : "",
            c.sick > 0 ? String(c.sick) + ".0" : "",
          ]);
        }

        // Totals row (no sum for שם עובד, תג עובד, ימי דיווח)
        const totalsRow = ws2.addRow(["", "", "", totalVacation, totalReserves, totalChildSick, totalChoiceDay, totalAdvancedStudy, totalHalfDay, totalSick]);
        totalsRow.font = { bold: true };

        // Auto-width columns for summary
        ws2.columns.forEach((col) => {
          let maxLen = 10;
          col.eachCell?.({ includeEmpty: true }, (cell) => {
            const len = String(cell.value ?? "").length;
            if (len > maxLen) maxLen = len;
          });
          col.width = Math.min(maxLen + 2, 30);
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

          // ──── Section 1: Admin Report (daily log) ────
          doc.fontSize(14).font("Helvetica-Bold").text("Admin Report", { align: "center" });
          doc.fontSize(9).font("Helvetica").text(`Period: ${period}`, { align: "center" });
          doc.moveDown(0.5);

          const adminCols = ["Employee", "Date", "Day", "Type", "Entry", "Exit", "Hours", "Event"];
          const adminWidths = [130, 50, 50, 60, 50, 50, 50, 120];
          const startX = 40;

          // Header
          let y = doc.y;
          doc.fontSize(7).font("Helvetica-Bold");
          let x = startX;
          for (let i = 0; i < adminCols.length; i++) {
            doc.text(adminCols[i], x, y, { width: adminWidths[i], align: "left" });
            x += adminWidths[i] + 4;
          }
          y += 12;
          doc.moveTo(startX, y).lineTo(startX + 650, y).stroke();
          y += 4;

          doc.font("Helvetica").fontSize(7);
          for (const emp of employees) {
            const empName = `${emp.firstName} ${emp.lastName}`;
            const empDates = eventsByEmpDate.get(emp.id) ?? new Map();
            const hasDaysOff = ((emp as any).daysOff ?? []).length > 0;
            const pct = (emp as any).employmentPercentage ?? 100;

            for (const date of allDates) {
              if (y > 540) { doc.addPage(); y = 40; }

              const dateStr = date.format("YYYY-MM-DD");
              const weekend = isWeekend(date);
              const status = empDates.get(dateStr);
              const dayType = weekend ? "Weekend" : "Workday";

              let entry = "", exit2 = "", hours = "", event = "";
              if (!weekend && status) {
                if (status === "PRESENT" || status === "WORK_FROM_HOME") {
                  const h = getAdjustedHours(pct, hasDaysOff, false);
                  entry = h.entry.replace(" *", ""); exit2 = h.exit.replace(" *", ""); hours = h.totalHours;
                  if (status === "WORK_FROM_HOME") event = STATUS_EVENT_LABEL[status] ?? status;
                } else if (status === "HALF_DAY" || status === "HOLIDAY_EVE") {
                  const h = getAdjustedHours(pct, hasDaysOff, true);
                  entry = h.entry.replace(" *", ""); exit2 = h.exit.replace(" *", ""); hours = h.totalHours;
                  event = STATUS_EVENT_LABEL[status] ?? status;
                } else {
                  event = STATUS_EVENT_LABEL[status] ?? status;
                }
              }

              const vals = [empName, date.format("DD/MM"), HEBREW_DAYS[date.day()], dayType, entry, exit2, hours, event];
              x = startX;
              for (let i = 0; i < vals.length; i++) {
                doc.text(vals[i], x, y, { width: adminWidths[i], align: "left" });
                x += adminWidths[i] + 4;
              }
              y += 10;
            }
          }

          // ──── Section 2: Summary Report ────
          doc.addPage();
          doc.fontSize(14).font("Helvetica-Bold").text("Summary Report", { align: "center" });
          doc.fontSize(9).font("Helvetica").text(`Period: ${period}`, { align: "center" });
          doc.moveDown(0.5);

          const sumCols = ["Employee", "Days", "Vacation", "Reserves", "Child Sick", "Choice Day", "Advanced Study", "Half Day Off", "Sick"];
          const sumWidths = [130, 40, 50, 50, 55, 55, 60, 60, 40];

          y = doc.y;
          doc.fontSize(8).font("Helvetica-Bold");
          x = startX;
          for (let i = 0; i < sumCols.length; i++) {
            doc.text(sumCols[i], x, y, { width: sumWidths[i], align: "left" });
            x += sumWidths[i] + 6;
          }
          y += 14;
          doc.moveTo(startX, y).lineTo(startX + 600, y).stroke();
          y += 4;

          doc.font("Helvetica").fontSize(8);
          let pdfTotalVacation = 0, pdfTotalReserves = 0, pdfTotalChildSick = 0, pdfTotalChoiceDay = 0, pdfTotalAdvancedStudy = 0, pdfTotalHalfDay = 0, pdfTotalSick = 0;
          for (const emp of employees) {
            if (y > 540) { doc.addPage(); y = 40; }
            const c = empSummary.get(emp.id) ?? { total: 0, present: 0, sick: 0, childSick: 0, vacation: 0, reserves: 0, halfDay: 0, workFromHome: 0, publicHoliday: 0, holidayEve: 0, choiceDay: 0, advancedStudy: 0, dayOff: 0 };
            pdfTotalVacation += c.vacation; pdfTotalReserves += c.reserves; pdfTotalChildSick += c.childSick;
            pdfTotalChoiceDay += c.choiceDay; pdfTotalAdvancedStudy += c.advancedStudy; pdfTotalHalfDay += c.halfDay; pdfTotalSick += c.sick;
            const vals = [`${emp.lastName} ${emp.firstName}`, String(c.total), String(c.vacation), String(c.reserves), String(c.childSick), String(c.choiceDay), String(c.advancedStudy), String(c.halfDay), String(c.sick)];
            x = startX;
            for (let i = 0; i < vals.length; i++) {
              doc.text(vals[i], x, y, { width: sumWidths[i], align: "left" });
              x += sumWidths[i] + 6;
            }
            y += 12;
          }

          // Totals row (no sum for Employee or Days)
          if (y > 540) { doc.addPage(); y = 40; }
          y += 4;
          doc.font("Helvetica-Bold").fontSize(8);
          const totalVals = ["", "", String(pdfTotalVacation), String(pdfTotalReserves), String(pdfTotalChildSick), String(pdfTotalChoiceDay), String(pdfTotalAdvancedStudy), String(pdfTotalHalfDay), String(pdfTotalSick)];
          x = startX;
          for (let i = 0; i < totalVals.length; i++) {
            doc.text(totalVals[i], x, y, { width: sumWidths[i], align: "left" });
            x += sumWidths[i] + 6;
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

  // ─── Send Manager Summaries ────────────────────────────────────────

  /**
   * POST /reports/send-manager-summaries
   * Sends attendance summary emails to all managers for a given period.
   * Body: { from, to, month, year }
   */
  app.post(
    "/send-manager-summaries",
    { preHandler: [requirePermission("admin.policies")] },
    async (request, reply) => {
      const { from, to, month, year } = request.body as {
        from: string;
        to: string;
        month: number;
        year: number;
      };

      if (!from || !to || !month || !year) {
        return reply.status(400).send({ ok: false, error: { code: "VALIDATION", message: "from, to, month, year required" } });
      }

      const org = await prisma.org.findUnique({ where: { id: request.currentOrgId! } });
      if (!org) {
        return reply.status(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Org not found" } });
      }

      // Find all managers (users with manager role)
      const managerRoles = await prisma.userRole.findMany({
        where: { role: "manager", user: { orgId: request.currentOrgId! } },
        include: { user: { select: { id: true, displayName: true, email: true } } },
      });

      const period = `${new Date(year, month - 1).toLocaleString("default", { month: "long" })} ${year}`;
      let sent = 0;

      for (const { user: manager } of managerRoles) {
        // Get this manager's direct reports
        const employees = await prisma.employee.findMany({
          where: { orgId: request.currentOrgId!, isActive: true, managerId: manager.id },
          include: { department: { select: { name: true } } },
          orderBy: { lastName: "asc" },
        });

        if (employees.length === 0) continue;

        // Get attendance data for each employee
        const empIds = employees.map((e) => e.id);

        const events = await prisma.attendanceEvent.findMany({
          where: {
            orgId: request.currentOrgId!,
            employeeId: { in: empIds },
            eventType: "CLOCK_IN",
            serverTimestamp: {
              gte: new Date(`${from}T00:00:00Z`),
              lte: new Date(`${to}T23:59:59Z`),
            },
          },
          select: { employeeId: true, notes: true },
        });

        // Get monthly report statuses
        const reports = await prisma.monthlyReport.findMany({
          where: {
            orgId: request.currentOrgId!,
            employeeId: { in: empIds },
            month,
            year,
          },
          select: { employeeId: true, status: true },
        });
        const reportMap = new Map(reports.map((r) => [r.employeeId, r.status]));

        // Tally per employee
        const empSummaries = employees.map((emp) => {
          const empEvents = events.filter((e) => e.employeeId === emp.id);
          const counts = { present: 0, sick: 0, childSick: 0, vacation: 0, reserves: 0, halfDay: 0, workFromHome: 0, publicHoliday: 0, holidayEve: 0, choiceDay: 0, advancedStudy: 0, dayOff: 0 };
          for (const ev of empEvents) {
            const status = ev.notes ?? "PRESENT";
            if (status === "PRESENT") counts.present++;
            else if (status === "SICK") counts.sick++;
            else if (status === "CHILD_SICK") counts.childSick++;
            else if (status === "VACATION") counts.vacation++;
            else if (status === "RESERVES") counts.reserves++;
            else if (status === "HALF_DAY") counts.halfDay++;
            else if (status === "WORK_FROM_HOME") counts.workFromHome++;
            else if (status === "PUBLIC_HOLIDAY") counts.publicHoliday++;
            else if (status === "HOLIDAY_EVE") counts.holidayEve++;
            else if (status === "CHOICE_DAY") counts.choiceDay++;
            else if (status === "ADVANCED_STUDY") counts.advancedStudy++;
            else if (status === "DAY_OFF") counts.dayOff++;
            else counts.present++;
          }
          return {
            name: `${emp.firstName} ${emp.lastName}`,
            department: emp.department?.name ?? "-",
            ...counts,
            reportStatus: reportMap.get(emp.id) ?? "DRAFT",
          };
        });

        await email.sendManagerSummary({
          managerEmail: manager.email,
          managerName: manager.displayName,
          orgName: org.name,
          period,
          employees: empSummaries,
        });
        sent++;
      }

      return { ok: true, data: { sent } };
    },
  );
}
