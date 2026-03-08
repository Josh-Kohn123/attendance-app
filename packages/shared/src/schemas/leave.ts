import { z } from "zod";

export const LEAVE_TYPES = [
  "VACATION",
  "SICK",
  "PERSONAL",
  "MATERNITY",
  "PATERNITY",
  "BEREAVEMENT",
  "MILITARY",
  "OTHER",
] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LeaveRequestSchema = z.object({
  type: z.enum(LEAVE_TYPES),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(500).optional(),
  requestId: z.string().uuid(),
});

export const LeaveResponseSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeName: z.string(),
  type: z.enum(LEAVE_TYPES),
  startDate: z.string(),
  endDate: z.string(),
  totalDays: z.number(),
  reason: z.string().nullable(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;
export type LeaveResponse = z.infer<typeof LeaveResponseSchema>;
