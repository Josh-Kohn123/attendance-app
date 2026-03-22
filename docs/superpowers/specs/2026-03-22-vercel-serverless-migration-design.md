# Vercel Serverless Migration Design

## Overview

Migrate the orbs-attendance monorepo from a Fastify long-running server to Vercel serverless functions. The Vite/React frontend (`apps/web`) deploys as static files on Vercel CDN. The Fastify API (`apps/api`) is replaced by ~48 individual serverless function files in a root-level `api/` directory. The worker (`apps/worker`) is dropped — its functionality is no longer needed.

## Architecture

```
orbs-attendance/
├── api/                          # Vercel serverless functions (~48 files)
│   ├── auth/                     # OAuth + profile (3 files)
│   ├── attendance/               # Clock-in, calendar entries (9 files)
│   ├── reports/                  # Summaries, exports, locking (6 files)
│   ├── admin/                    # Policies, holidays, departments (10 files)
│   ├── employees/                # CRUD + role management (4 files)
│   ├── leave/                    # Leave requests + approvals (5 files)
│   ├── monthly-reports/          # Submission, review, approval (8 files)
│   ├── calendar-digest/          # Google Calendar integration (3 files)
│   └── health.ts, health/db.ts  # Health checks (2 files)
├── lib/                          # Shared serverless utilities
│   ├── auth.ts                   # JWT verification + user context loading
│   ├── middleware.ts             # withAuth() and withPublic() wrappers
│   └── response.ts              # Standard response helpers
├── apps/web/                     # UNCHANGED: Vite React frontend
├── apps/api/                     # PRESERVED: original Fastify code (reference only)
├── packages/                     # UNCHANGED: db, shared, authz
└── vercel.json                   # Routing, headers, build config
```

## Shared Middleware Layer (`lib/`)

### `lib/auth.ts`
- Verifies JWT using `jsonwebtoken` (replaces `@fastify/jwt`)
- Loads user roles and scopes from database (same logic as `plugins/auth.ts`)
- Returns `AuthContext`: `{ userId, orgId, email, roles, scopes }`

### `lib/middleware.ts`
- `withAuth(handler, options)` — wraps a handler with:
  - CORS preflight handling (OPTIONS)
  - HTTP method filtering (returns 405 for wrong methods)
  - JWT verification via `lib/auth.ts`
  - Permission checking via `@orbs/authz`
  - Error handling (try/catch → standard error response)
- `withPublic(handler, options)` — same but skips auth (for health, OAuth redirect, public policies)

### `lib/response.ts`
- Standard JSON response helpers: `ok(res, data)`, `error(res, status, message)`

## Route File Pattern

Each serverless function is a thin handler:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAuth } from '../../lib/middleware';
import { prisma } from '@orbs/db';

export default withAuth(async (req: VercelRequest, res: VercelResponse, ctx) => {
  // Business logic extracted from existing Fastify route
  // ctx.userId, ctx.orgId, ctx.roles, ctx.scopes available
}, { permission: 'attendance.clock_in', methods: ['POST'] });
```

## Vercel Configuration (`vercel.json`)

- CORS headers for API routes
- Rewrites: all non-API paths → `apps/web` static build
- Build settings: output directory for Vite build
- Function configuration: memory, timeout

## Frontend Changes

**None.** The frontend already uses `API_BASE = "/api"` with relative paths. On Vercel, the `api/` directory serves at `/api/...` natively. The only change is removing the Vite dev proxy (not needed in production).

## What Gets Removed

- `apps/worker/` — auto-logout and daily attendance no longer needed
- `@fastify/cors`, `@fastify/jwt`, `@fastify/rate-limit`, `@fastify/cookie` — replaced by Vercel equivalents
- `apps/api/src/server.ts` `start()` / `listen()` — no longer a running server

## What Stays the Same

- All business logic (database queries, email sending, report generation)
- `packages/db` (Prisma client, singleton pattern)
- `packages/shared` (shared types)
- `packages/authz` (permission checking)
- `apps/web` (entire frontend)
- Google Calendar integration
- Excel/PDF generation
- JWT token format and claims

## Migration Strategy

1. Create shared `lib/` layer first (auth, middleware, response)
2. Migrate routes group by group (auth → health → attendance → ...)
3. Add `vercel.json` configuration
4. Test locally with `vercel dev`
5. Verify all endpoints work before deploying

## Local Testing

`vercel dev` simulates the serverless environment locally. It:
- Serves `apps/web` static files
- Runs serverless functions from `api/`
- Handles routing as configured in `vercel.json`

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Cold start latency | Prisma singleton pattern already in place; acceptable for attendance app |
| DB connection exhaustion | Monitor in production; add Prisma Accelerate if needed |
| Report export timeout | Pro plan gives 60s; sufficient for current data volumes |
| OAuth callback URL change | Update Google OAuth config to point to Vercel URL |
