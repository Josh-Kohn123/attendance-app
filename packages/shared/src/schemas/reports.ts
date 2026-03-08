import { z } from "zod";

export const ExportRequestSchema = z.object({
  format: z.enum(["EXCEL", "PDF"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departmentId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  employeeIds: z.array(z.string().uuid()).optional(),
  includeChangeLog: z.boolean().default(false),
});

export const ReportLockSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
  siteId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});

export const ReportSignSchema = z.object({
  reportLockId: z.string().uuid(),
  signatureData: z.string().optional(), // base64 signature image
});

export const ExportResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]),
  format: z.enum(["EXCEL", "PDF"]),
  downloadUrl: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type ReportLock = z.infer<typeof ReportLockSchema>;
export type ReportSign = z.infer<typeof ReportSignSchema>;
export type ExportResponse = z.infer<typeof ExportResponseSchema>;

// ─── Monthly Report Submission & Approval ───────────────────────

export const MONTHLY_REPORT_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
] as const;

export type MonthlyReportStatus = (typeof MONTHLY_REPORT_STATUSES)[number];

export const MonthlyReportSubmitSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
});

export const MonthlyReportRejectSchema = z.object({
  comment: z.string().min(1).max(500),
});

export const MonthlyReportQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).optional(),
  status: z.enum(["SUBMITTED", "APPROVED", "REJECTED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type MonthlyReportSubmit = z.infer<typeof MonthlyReportSubmitSchema>;
export type MonthlyReportReject = z.infer<typeof MonthlyReportRejectSchema>;
export type MonthlyReportQuery = z.infer<typeof MonthlyReportQuerySchema>;
