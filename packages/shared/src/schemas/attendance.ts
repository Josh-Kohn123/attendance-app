import { z } from "zod";
import { EVENT_TYPES, EVENT_SOURCES, DAY_STATUSES } from "../types/events.js";

export const ClockInSchema = z.object({
  siteId: z.string().uuid(),
  source: z.enum(EVENT_SOURCES).default("MANUAL"),
  clientTimestamp: z.string().datetime().optional(),
  requestId: z.string().uuid(), // idempotency key
  notes: z.string().max(500).optional(),
});

export const CorrectionSchema = z.object({
  originalEventId: z.string().uuid(),
  correctedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(1).max(500),
  requestId: z.string().uuid(),
});

export const CalendarEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(DAY_STATUSES),
  siteId: z.string().uuid(),
  source: z.enum(EVENT_SOURCES).default("MANUAL"),
  requestId: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

/** Bulk calendar entries — same status applied to multiple dates at once. */
export const BulkCalendarEntrySchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(62),
  status: z.enum(DAY_STATUSES),
  siteId: z.string().uuid(),
  source: z.enum(EVENT_SOURCES).default("MANUAL"),
  notes: z.string().max(500).optional(),
});

export const AttendanceEventResponseSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  siteId: z.string().uuid(),
  eventType: z.enum(EVENT_TYPES),
  source: z.enum(EVENT_SOURCES),
  serverTimestamp: z.string(),
  clientTimestamp: z.string().nullable(),
  previousEventId: z.string().uuid().nullable(),
  createdByUserId: z.string().uuid(),
  notes: z.string().nullable(),
});

export const AttendanceQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ClockIn = z.infer<typeof ClockInSchema>;
export type Correction = z.infer<typeof CorrectionSchema>;
export type CalendarEntry = z.infer<typeof CalendarEntrySchema>;
export type AttendanceEventResponse = z.infer<typeof AttendanceEventResponseSchema>;
export type AttendanceQuery = z.infer<typeof AttendanceQuerySchema>;
