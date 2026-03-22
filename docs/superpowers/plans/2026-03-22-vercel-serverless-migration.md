# Vercel Serverless Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Fastify API to Vercel serverless functions and deploy frontend + API on Vercel.

**Architecture:** Root-level `api/` directory with individual serverless functions. Shared `lib/` for auth, middleware, and response utilities. Frontend (`apps/web`) served as static Vite build via Vercel CDN. Services (email, audit, google-calendar) adapted to work without Fastify types.

**Tech Stack:** Vercel Serverless Functions (Node.js runtime), `@vercel/node`, `jsonwebtoken`, Prisma, existing packages (shared, authz, db).

**Note on testing:** This is a migration of existing working code. Testing is done via `vercel dev` (local serverless emulation) rather than TDD, since the business logic is unchanged.

---

### Task 1: Install dependencies and create vercel.json

**Files:**
- Modify: `package.json` (root)
- Create: `vercel.json`
- Create: `tsconfig.api.json` (for serverless functions)

- [ ] **Step 1: Install @vercel/node and jsonwebtoken**

```bash
npm install @vercel/node jsonwebtoken
npm install -D @types/jsonwebtoken
```

- [ ] **Step 2: Create vercel.json**

Create `vercel.json` at project root:

```json
{
  "buildCommand": "npm run build -w packages/shared && npm run build -w packages/authz && npm run db:generate && npm run build -w apps/web",
  "outputDirectory": "apps/web/dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,POST,PATCH,DELETE,OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Content-Type,Authorization" },
        { "key": "Access-Control-Allow-Credentials", "value": "true" }
      ]
    }
  ],
  "functions": {
    "api/**/*.ts": {
      "maxDuration": 60
    }
  }
}
```

- [ ] **Step 3: Create tsconfig.api.json for serverless functions**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "./dist-api",
    "rootDir": ".",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": false
  },
  "include": ["api/**/*.ts", "lib/**/*.ts"],
  "references": [
    { "path": "./packages/shared" },
    { "path": "./packages/authz" },
    { "path": "./packages/db" }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add vercel.json tsconfig.api.json package.json package-lock.json
git commit -m "chore: add Vercel config and serverless dependencies"
```

---

### Task 2: Create shared lib layer (auth, middleware, response)

**Files:**
- Create: `lib/auth.ts`
- Create: `lib/middleware.ts`
- Create: `lib/response.ts`
- Create: `lib/audit.ts` (adapted from `apps/api/src/services/audit.ts`)

- [ ] **Step 1: Create lib/auth.ts**

JWT verification and user context loading. Replaces Fastify's `@fastify/jwt` and `plugins/auth.ts`.

```typescript
import jwt from "jsonwebtoken";
import { prisma } from "@orbs/db";
import type { AuthzContext } from "@orbs/authz";
import type { Role, ScopeType } from "@orbs/shared";

export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  roles: Role[];
  authzContext: AuthzContext;
}

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

export function signJwt(payload: { sub: string; orgId: string; email: string; roles: string[] }): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  });
}

export async function verifyAuth(authHeader: string | undefined): Promise<AuthContext | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as {
      sub: string;
      orgId: string;
      email: string;
      roles: string[];
    };

    const userScopes = await prisma.userScope.findMany({
      where: { userId: decoded.sub },
      select: { scopeType: true, scopeId: true },
    });

    const authzContext: AuthzContext = {
      userId: decoded.sub,
      orgId: decoded.orgId,
      roles: decoded.roles as Role[],
      scopes: userScopes.map((s) => ({
        scopeType: s.scopeType as ScopeType,
        scopeId: s.scopeId,
      })),
    };

    return {
      userId: decoded.sub,
      orgId: decoded.orgId,
      email: decoded.email,
      roles: decoded.roles as Role[],
      authzContext,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Create lib/middleware.ts**

The `withAuth()` and `withPublic()` wrappers that handle CORS, method filtering, auth, permissions, and error handling.

```typescript
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyAuth, type AuthContext } from "./auth";
import { hasPermission } from "@orbs/authz";
import type { Permission } from "@orbs/shared";

type Handler = (req: VercelRequest, res: VercelResponse, ctx: AuthContext) => Promise<any>;
type PublicHandler = (req: VercelRequest, res: VercelResponse, ctx: AuthContext | null) => Promise<any>;

interface AuthOptions {
  permission?: Permission;
  methods?: string[];
}

function handleCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function withAuth(handler: Handler, options: AuthOptions = {}) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (handleCors(req, res)) return;

    // Method check
    if (options.methods && !options.methods.includes(req.method!)) {
      return res.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: `${req.method} not allowed` } });
    }

    try {
      const ctx = await verifyAuth(req.headers.authorization);
      if (!ctx) {
        return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
      }

      // Permission check
      if (options.permission && !hasPermission(ctx.authzContext, options.permission)) {
        return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: `Missing permission: ${options.permission}` } });
      }

      const result = await handler(req, res, ctx);
      // If handler didn't send a response yet, send the result as JSON
      if (result !== undefined && !res.writableEnded) {
        res.status(200).json(result);
      }
    } catch (error) {
      console.error("[API Error]", error);
      if (!res.writableEnded) {
        res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
      }
    }
  };
}

export function withPublic(handler: PublicHandler, options: { methods?: string[] } = {}) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (handleCors(req, res)) return;

    if (options.methods && !options.methods.includes(req.method!)) {
      return res.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: `${req.method} not allowed` } });
    }

    try {
      // Try to load auth context but don't require it
      const ctx = await verifyAuth(req.headers.authorization);
      const result = await handler(req, res, ctx);
      if (result !== undefined && !res.writableEnded) {
        res.status(200).json(result);
      }
    } catch (error) {
      console.error("[API Error]", error);
      if (!res.writableEnded) {
        res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
      }
    }
  };
}
```

- [ ] **Step 3: Create lib/audit.ts**

Adapted from `apps/api/src/services/audit.ts` to use Vercel request types instead of Fastify.

```typescript
import { prisma } from "@orbs/db";
import type { VercelRequest } from "@vercel/node";
import type { AuditAction } from "@orbs/shared";
import type { AuthContext } from "./auth";

export async function auditLog(
  req: VercelRequest,
  ctx: AuthContext,
  action: AuditAction,
  targetType?: string | null,
  targetId?: string | null,
  before?: unknown,
  after?: unknown,
) {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        userId: ctx.userId,
        action,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        before: before ? JSON.parse(JSON.stringify(before)) : null,
        after: after ? JSON.parse(JSON.stringify(after)) : null,
        ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0] ?? req.socket?.remoteAddress ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to write audit log", error);
  }
}
```

- [ ] **Step 4: Create lib/response.ts**

Minimal response helpers.

```typescript
import type { VercelResponse } from "@vercel/node";

export function ok(res: VercelResponse, data?: any) {
  return res.status(200).json({ ok: true, data });
}

export function created(res: VercelResponse, data?: any) {
  return res.status(201).json({ ok: true, data });
}

export function error(res: VercelResponse, status: number, code: string, message: string) {
  return res.status(status).json({ ok: false, error: { code, message } });
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/
git commit -m "feat: add shared serverless middleware layer (auth, middleware, audit, response)"
```

---

### Task 3: Migrate health and auth routes

**Files:**
- Create: `api/health.ts`
- Create: `api/health/db.ts`
- Create: `api/auth/google.ts`
- Create: `api/auth/google/callback.ts`
- Create: `api/auth/me.ts`

- [ ] **Step 1: Create api/health.ts and api/health/db.ts**

Port from `apps/api/src/routes/health.ts`. These are public endpoints (no auth).

- [ ] **Step 2: Create api/auth/google.ts**

Port the Google OAuth redirect. Public endpoint. Uses `res.redirect()`.

- [ ] **Step 3: Create api/auth/google/callback.ts**

Port the OAuth callback. This is the most complex auth endpoint — exchanges code for tokens, finds user, signs JWT, redirects to frontend. Uses `signJwt()` from `lib/auth.ts` instead of `app.jwt.sign()`.

- [ ] **Step 4: Create api/auth/me.ts**

Port the `/auth/me` endpoint. Uses `withAuth()` wrapper.

- [ ] **Step 5: Commit**

```bash
git add api/health.ts api/health/ api/auth/
git commit -m "feat: migrate health and auth routes to serverless"
```

---

### Task 4: Migrate attendance routes

**Files:**
- Create: `api/attendance/clock-in.ts`
- Create: `api/attendance/calendar-entry.ts`
- Create: `api/attendance/calendar-bulk.ts`
- Create: `api/attendance/self.ts`
- Create: `api/attendance/team.ts`
- Create: `api/attendance/corrections.ts`
- Create: `api/attendance/employee/[employeeId].ts`
- Create: `api/attendance/employee/[employeeId]/calendar-entry.ts`
- Create: `api/attendance/employee/[employeeId]/calendar-bulk.ts`

- [ ] **Step 1: Create self-service attendance endpoints**

Port clock-in, calendar-entry (POST+DELETE in one file), calendar-bulk, self, team, corrections.

Key adaptation: `request.currentUserId` → `ctx.userId`, `request.currentOrgId` → `ctx.orgId`, `request.authzContext` → `ctx.authzContext`.

For `calendar-entry.ts`: handle both POST and DELETE using `req.method` switch.

- [ ] **Step 2: Create proxy attendance endpoints (admin/manager on behalf of employee)**

Port employee/[employeeId] routes. Extract the `canManageEmployee()` helper into the file or a shared util.

- [ ] **Step 3: Commit**

```bash
git add api/attendance/
git commit -m "feat: migrate attendance routes to serverless"
```

---

### Task 5: Migrate reports routes

**Files:**
- Create: `api/reports/team.ts`
- Create: `api/reports/company.ts`
- Create: `api/reports/download.ts`
- Create: `api/reports/lock.ts`
- Create: `api/reports/sign.ts`
- Create: `api/reports/send-manager-summaries.ts`

- [ ] **Step 1: Create simple report endpoints**

Port team, company, lock, sign, send-manager-summaries.

- [ ] **Step 2: Create reports/download.ts (Excel/PDF)**

Port the complex download endpoint. Key difference: instead of `reply.header().send(buffer)`, use `res.setHeader()` and `res.send()`.

For PDF streaming: collect chunks into buffer same as existing code, then `res.setHeader('Content-Type', 'application/pdf')` + `res.send(buffer)`.

- [ ] **Step 3: Commit**

```bash
git add api/reports/
git commit -m "feat: migrate reports routes to serverless"
```

---

### Task 6: Migrate admin routes

**Files:**
- Create: `api/admin/policies.ts` (GET + PATCH)
- Create: `api/admin/policies/public.ts` (GET)
- Create: `api/admin/holidays.ts` (GET + POST)
- Create: `api/admin/holidays/dates.ts` (GET)
- Create: `api/admin/departments.ts` (GET + POST)
- Create: `api/admin/sites.ts` (GET + POST)
- Create: `api/admin/audit-log.ts` (GET)
- Create: `api/admin/admin-users.ts` (GET)
- Create: `api/admin/roles/assign.ts` (POST)
- Create: `api/admin/roles/revoke.ts` (POST)

- [ ] **Step 1: Create all admin endpoints**

Straightforward CRUD ports. Multi-method files (policies, holidays, departments, sites) use `req.method` switch.

`holidays/dates.ts` needs auth but not admin permission — use `withAuth()` without a permission option.

`policies/public.ts` needs auth but no specific permission — use `withAuth()` without permission.

- [ ] **Step 2: Commit**

```bash
git add api/admin/
git commit -m "feat: migrate admin routes to serverless"
```

---

### Task 7: Migrate employee routes

**Files:**
- Create: `api/employees/index.ts` (GET + POST)
- Create: `api/employees/[id].ts` (GET + PATCH + DELETE)
- Create: `api/employees/[id]/role.ts` (PATCH)
- Create: `api/employees/[id]/reactivate.ts` (PATCH)

- [ ] **Step 1: Create all employee endpoints**

Port from `apps/api/src/routes/employees.ts`. Employee list (GET /) uses auth-based scoping.

For `[id].ts`: handle GET, PATCH, DELETE via `req.method` switch. Dynamic param accessed via `req.query.id` (Vercel puts catch-all/dynamic segments in query).

- [ ] **Step 2: Commit**

```bash
git add api/employees/
git commit -m "feat: migrate employee routes to serverless"
```

---

### Task 8: Migrate leave routes

**Files:**
- Create: `api/leave/request.ts` (POST)
- Create: `api/leave/self.ts` (GET)
- Create: `api/leave/team.ts` (GET)
- Create: `api/leave/[id]/approve.ts` (POST)
- Create: `api/leave/[id]/reject.ts` (POST)

- [ ] **Step 1: Create all leave endpoints**

Straightforward port. Uses email service for manager notifications.

- [ ] **Step 2: Commit**

```bash
git add api/leave/
git commit -m "feat: migrate leave routes to serverless"
```

---

### Task 9: Migrate monthly reports routes

**Files:**
- Create: `api/monthly-reports/status.ts` (GET)
- Create: `api/monthly-reports/team-status.ts` (GET)
- Create: `api/monthly-reports/submit.ts` (POST)
- Create: `api/monthly-reports/pending-reviews.ts` (GET)
- Create: `api/monthly-reports/[id]/approve.ts` (POST)
- Create: `api/monthly-reports/[id]/reject.ts` (POST)
- Create: `api/monthly-reports/status/[employeeId].ts` (GET)
- Create: `api/monthly-reports/submit-for.ts` (POST)
- Create: `api/monthly-reports/notify-submit.ts` (POST)

- [ ] **Step 1: Create all monthly report endpoints**

Port from `apps/api/src/routes/monthly-reports.ts`. Extract `canManageEmployee()` helper.

- [ ] **Step 2: Commit**

```bash
git add api/monthly-reports/
git commit -m "feat: migrate monthly-reports routes to serverless"
```

---

### Task 10: Migrate calendar digest routes

**Files:**
- Create: `api/calendar-digest/fetch.ts` (GET)
- Create: `api/calendar-digest/apply.ts` (POST)
- Create: `api/calendar-digest/[token].ts` (GET + POST)
- Create: `lib/calendar-digest-helpers.ts` (shared helpers)

- [ ] **Step 1: Create lib/calendar-digest-helpers.ts**

Extract `getWorkdaysInRange()`, `applyAttendanceIfAbsent()`, `applyAttendanceForced()` since they're used by multiple endpoints.

- [ ] **Step 2: Create JWT-authenticated endpoints (fetch, apply)**

Port fetch and apply endpoints. These use `withAuth()` with admin permission.

- [ ] **Step 3: Create token-authenticated endpoint ([token].ts)**

Port the legacy token-based endpoints. These are public (no JWT) — use `withPublic()`. Token validation is done by looking up the digest by token in the DB.

- [ ] **Step 4: Commit**

```bash
git add api/calendar-digest/ lib/calendar-digest-helpers.ts
git commit -m "feat: migrate calendar-digest routes to serverless"
```

---

### Task 11: Update Vite config and verify local dev

**Files:**
- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: Update Vite dev proxy for local non-Vercel development**

The existing proxy still works for local dev with `npm run dev`. No changes needed unless we want to use `vercel dev` exclusively. Keep both options working.

- [ ] **Step 2: Add .vercelignore**

```
apps/api/
apps/worker/
docs/
*.md
```

- [ ] **Step 3: Link project to Vercel and test with vercel dev**

```bash
vercel link
vercel dev
```

Verify:
- `GET /api/health` returns `{ status: "ok" }`
- `GET /api/health/db` returns `{ status: "ok", database: "connected" }`
- `GET /api/auth/google` redirects to Google OAuth
- All other authenticated endpoints return 401 without a token

- [ ] **Step 4: Commit**

```bash
git add .vercelignore
git commit -m "chore: add .vercelignore and verify local dev setup"
```

---

### Task 12: Final cleanup and testing

- [ ] **Step 1: Run full endpoint test via vercel dev**

Test each endpoint group by sending requests with valid JWT:
1. Auth flow (Google OAuth → callback → /me)
2. Attendance (clock-in, calendar entries, team view)
3. Reports (team, company, download Excel/PDF)
4. Admin (policies, holidays, departments, sites)
5. Employees (list, create, update, deactivate)
6. Leave (request, approve, reject)
7. Monthly reports (submit, review, approve/reject)
8. Calendar digest (fetch, apply, token-based)

- [ ] **Step 2: Commit final state**

```bash
git add -A
git commit -m "feat: complete Vercel serverless migration - all endpoints ported"
```
