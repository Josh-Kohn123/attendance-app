import { z } from "zod";
import { ROLES } from "../types/roles.js";

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"] as const;

export const CreateEmployeeSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  employeeNumber: z.string().optional(),
  phone: z.string().optional(),
  position: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  siteId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: z.enum(ROLES).default("employee"),
  employmentPercentage: z.number().int().min(10).max(100).multipleOf(10).default(100),
  daysOff: z.array(z.enum(WEEKDAYS)).default([]),
});

export const UpdateEmployeeSchema = CreateEmployeeSchema.partial().omit({ email: true });

export const EmployeeResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  employeeNumber: z.string().nullable(),
  phone: z.string().nullable(),
  position: z.string().nullable(),
  departmentId: z.string().uuid().nullable(),
  siteId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type CreateEmployee = z.infer<typeof CreateEmployeeSchema>;
export type UpdateEmployee = z.infer<typeof UpdateEmployeeSchema>;
export type EmployeeResponse = z.infer<typeof EmployeeResponseSchema>;
