# Self-Submission Requirement

## Problem

Currently, admins can fill in timesheets and submit on behalf of any employee. For most employees, the employee themselves should be the one to hit "Submit" — confirming they've reviewed and agree with the attendance data. Only a subset of high-ranking employees should allow admins to handle the full flow.

## Solution

Add a `requireSelfSubmit` boolean field (default `true`) to the Employee model. When `true`, admins can still fill in the calendar but cannot submit on behalf — the employee must submit themselves. A notification email button lets the admin tell the employee their sheet is ready for review.

## Design

### 1. Database

Add to `Employee` model in Prisma schema:

```prisma
requireSelfSubmit Boolean @default(true)
```

- Default `true`: most employees must self-submit
- Set to `false` for high-ranking employees where admin handles everything

**Migration**: The column is added as `NOT NULL DEFAULT true`. Existing employee rows will be backfilled to `true` automatically. After migration, manually set specific high-ranking employees to `false` as needed.

### 2. Validation Schemas

Add `requireSelfSubmit` (optional boolean) to:
- `CreateEmployeeSchema` in `packages/shared/src/schemas/employee.ts`
- `UpdateEmployeeSchema` in `packages/shared/src/schemas/employee.ts`
- `EmployeeResponseSchema` in `packages/shared/src/schemas/employee.ts`

Add a new `NotifySubmitRequestSchema`:
```typescript
z.object({ month: z.number().int().min(1).max(12), year: z.number().int().min(2020) })
```

### 3. Backend — Guard submit-for endpoint

In `POST /monthly-reports/submit-for` (`apps/api/src/routes/monthly-reports.ts`):
- Before submitting, look up the target employee
- If `employee.requireSelfSubmit === true`, return 403: `"This employee must submit their own report"`
- If `false`, proceed as normal

### 4. Backend — New notify endpoint

`POST /monthly-reports/notify-submit`

- Requires `reports.review` permission (admin/manager only)
- Accepts `employeeId`, `month`, and `year` in the request body
- Looks up the employee and their email
- Sends an email using the existing `email` service with:
  - Subject: `[Attendance] Your attendance sheet is ready for review`
  - Body: "Your manager has filled out your attendance for [month/year]. Please review and submit."
  - CTA button linking to `/calendar?month=X&year=Y` so the employee lands on the correct period
- Returns 200 on success
- Frontend disables the button after sending to prevent spam

### 5. Frontend — Employee Registration Form

In `EmployeesAdmin.tsx`:
- Add a dropdown field: Label "Need to Approve Hours Themselves", Options: Yes (`true`) / No (`false`), Default: Yes
- Update `FormState` type, `emptyForm`, `buildPayload`, and `openEdit` to include `requireSelfSubmit`

### 6. Frontend — Create Report Page

In `CreateReportPage.tsx`, when the selected employee has `requireSelfSubmit: true`:
- Hide the Submit button (applies to both initial submit and resubmit after REJECTED status)
- Show info message: "This employee must submit their own report"
- Show a "Notify Employee" button next to the message
- On click, calls `POST /monthly-reports/notify-submit`
- Shows success toast on completion; button disables after send

When `requireSelfSubmit: false`:
- Current behavior unchanged (admin can fill + submit)

### 7. API Response — Include field

- The `GET /employees/:id` endpoint returns the raw Prisma object, so it picks up the field automatically
- The `GET /monthly-reports/team-status` response must explicitly include `requireSelfSubmit` in each employee item, since that response is manually assembled

## Files to modify

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `requireSelfSubmit` field to Employee |
| `packages/shared/src/schemas/employee.ts` | Add to Create/Update/Response Zod schemas, add `NotifySubmitRequestSchema` |
| `apps/api/src/routes/monthly-reports.ts` | Guard `submit-for`, add notify endpoint, include field in `team-status` |
| `apps/api/src/services/email.ts` | Add `notifySubmitRequired` email method |
| `apps/web/src/app/routes/admin/employees/EmployeesAdmin.tsx` | Add form field, update FormState/buildPayload/openEdit |
| `apps/web/src/app/routes/manager/create-report/CreateReportPage.tsx` | Conditional submit/notify UI |

## Out of scope

- No changes to the employee's own calendar submission flow
- No changes to the manager approval/rejection flow
- No changes to existing permissions model
