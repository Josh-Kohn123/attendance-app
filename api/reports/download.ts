import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withAuth } from "../../lib/middleware.js";
import { prisma } from "@orbs/db";
import { auditLog } from "../../lib/audit.js";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";

// Hebrew day names (0=Sun ... 6=Sat)
const HEBREW_DAYS = ["יום א", "יום ב", "יום ג", "יום ד", "יום ה", "יום ו", "יום ש"];

// Status label mapping for the Event column
const STATUS_EVENT_LABEL: Record<string, string> = {
  PRESENT: "In Office",
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
 */
function getAdjustedHours(employmentPercentage: number, hasDaysOff: boolean, isHalfDay: boolean) {
  const baseMinutes = isHalfDay ? 240 : 480; // 4 or 8 hours
  let minutes = baseMinutes;

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

export default withAuth(
  async (req: VercelRequest, res: VercelResponse, ctx) => {
    const { format, from, to } = req.query as { format?: string; from?: string; to?: string };
    if (!format || !from || !to) {
      return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "format, from, and to required" } });
    }

    const empWhere: any = { orgId: ctx.orgId, isActive: true };
    if (!ctx.roles.includes("admin")) {
      const scopedDeptIds = ctx.authzContext.scopes
        .filter((s: any) => s.scopeType === "department")
        .map((s: any) => s.scopeId);
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
        orgId: ctx.orgId,
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

    // Build summary counts per employee
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
    await auditLog(req, ctx, "REPORT_EXPORTED", "report_download", null, { format, from, to });

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
          const dayOfWeek = date.day();
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
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="attendance-report-${from}-to-${to}.xlsx"`);
      res.send(Buffer.from(buf as ArrayBuffer));
      return;
    }

    if (format.toUpperCase() === "PDF") {
      await new Promise<void>((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
        const chunks: Buffer[] = [];
        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => {
          const buf = Buffer.concat(chunks);
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="attendance-report-${from}-to-${to}.pdf"`);
          res.send(buf);
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
      return;
    }

    return res.status(400).json({ ok: false, error: { code: "VALIDATION", message: "format must be EXCEL or PDF" } });
  },
  { permission: "reports.export", methods: ["GET"] },
);
