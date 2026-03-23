import { z } from "zod";

export const CreateOrgSchema = z.object({
  name: z.string().min(1).max(255),
  monthStartDay: z.number().int().min(1).max(28).default(1),
  timezone: z.string().default("Asia/Jerusalem"),
  autoLogoutTime: z.string().optional(), // HH:mm format
});

export const CreateSiteSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().optional(),
});

export const CreateDepartmentSchema = z.object({
  name: z.string().min(1).max(255),
  siteId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
});

export const UpdatePolicySchema = z.object({
  monthStartDay: z.number().int().min(1).max(28).optional(),
  autoLogoutTime: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  ),
  autoLogoutEnabled: z.boolean().optional(),
  reminderTime: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  ),
  reminderEnabled: z.boolean().optional(),
  timezone: z.string().optional(),
  calendarDigestAdminUserId: z.string().uuid().nullable().optional(),
});

export const CreateHolidaySchema = z.object({
  name: z.string().min(1).max(255),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recurring: z.boolean().default(false),
  halfDay: z.boolean().default(false),
});

export type CreateOrg = z.infer<typeof CreateOrgSchema>;
export type CreateSite = z.infer<typeof CreateSiteSchema>;
export type CreateDepartment = z.infer<typeof CreateDepartmentSchema>;
export type UpdatePolicy = z.infer<typeof UpdatePolicySchema>;
export type CreateHoliday = z.infer<typeof CreateHolidaySchema>;
