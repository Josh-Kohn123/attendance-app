import { z } from "zod";

export const ApprovalActionSchema = z.object({
  comment: z.string().max(500).optional(),
});

export const ApprovalResponseSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeName: z.string(),
  eventType: z.string(),
  date: z.string(),
  reason: z.string().nullable(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  reviewComment: z.string().nullable(),
  createdAt: z.string(),
});

export const ApprovalQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;
export type ApprovalQuery = z.infer<typeof ApprovalQuerySchema>;
