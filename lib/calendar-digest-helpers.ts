import { prisma } from "@orbs/db";
import dayjs from "dayjs";
import crypto from "crypto";

const WEEKEND_DAYS = new Set([5, 6]); // Friday, Saturday

export function getWorkdaysInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let current = dayjs(startDate);
  const end = dayjs(endDate);
  while (!current.isAfter(end)) {
    if (!WEEKEND_DAYS.has(current.day())) {
      dates.push(current.format("YYYY-MM-DD"));
    }
    current = current.add(1, "day");
  }
  return dates;
}

export async function applyAttendanceIfAbsent(
  orgId: string,
  employee: { id: string; siteId: string },
  dateStr: string,
  status: string,
  systemUserId: string,
): Promise<void> {
  const existing = await prisma.attendanceEvent.findFirst({
    where: {
      employeeId: employee.id,
      eventType: "CLOCK_IN",
      serverTimestamp: {
        gte: new Date(`${dateStr}T00:00:00Z`),
        lte: new Date(`${dateStr}T23:59:59Z`),
      },
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.attendanceEvent.create({
    data: {
      orgId,
      employeeId: employee.id,
      siteId: employee.siteId,
      eventType: "CLOCK_IN",
      source: "GOOGLE_CALENDAR",
      serverTimestamp: new Date(`${dateStr}T09:00:00Z`),
      createdByUserId: systemUserId,
      requestId: crypto.randomUUID(),
      notes: status,
    },
  });
}

export async function applyAttendanceForced(
  orgId: string,
  employee: { id: string; siteId: string },
  dateStr: string,
  status: string,
  systemUserId: string,
): Promise<boolean> {
  const existingCalendar = await prisma.attendanceEvent.findFirst({
    where: {
      employeeId: employee.id,
      eventType: "CLOCK_IN",
      source: "GOOGLE_CALENDAR",
      serverTimestamp: {
        gte: new Date(`${dateStr}T00:00:00Z`),
        lte: new Date(`${dateStr}T23:59:59Z`),
      },
    },
    select: { id: true, notes: true },
  });
  if (existingCalendar) {
    await prisma.attendanceEvent.update({
      where: { id: existingCalendar.id },
      data: { notes: status },
    });
    return true;
  }
  await prisma.attendanceEvent.create({
    data: {
      orgId,
      employeeId: employee.id,
      siteId: employee.siteId,
      eventType: "CLOCK_IN",
      source: "GOOGLE_CALENDAR",
      serverTimestamp: new Date(`${dateStr}T09:00:00Z`),
      createdByUserId: systemUserId,
      requestId: crypto.randomUUID(),
      notes: status,
    },
  });
  return true;
}
