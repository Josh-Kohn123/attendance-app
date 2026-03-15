import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { attendanceRoutes } from "./routes/attendance.js";
import { reportRoutes } from "./routes/reports.js";
import { adminRoutes } from "./routes/admin.js";
import { employeeRoutes } from "./routes/employees.js";
import { leaveRoutes } from "./routes/leave.js";
import { monthlyReportRoutes } from "./routes/monthly-reports.js";
import { healthRoutes } from "./routes/health.js";
import { calendarDigestRoutes } from "./routes/calendar-digest.js";

const envToLogger: Record<string, any> = {
  development: {
    transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss Z" } },
  },
  production: true,
  test: false,
};

async function buildApp() {
  const app = Fastify({
    logger: envToLogger[process.env.NODE_ENV ?? "development"] ?? true,
  });

  // ─── Global plugins ───────────────────────────────────────────
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });

  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? "dev-secret-change-me",
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? "8h" },
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    // Skip rate limiting entirely in development so OAuth redirects never get blocked
    skip: (_request, _key) => process.env.NODE_ENV !== "production",
    keyGenerator: (request) => {
      // Rate-limit by IP in production
      return request.ip;
    },
  });

  // ─── Auth plugin (extracts user context) ──────────────────────
  await app.register(authPlugin);

  // ─── Routes ───────────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(attendanceRoutes, { prefix: "/attendance" });
  await app.register(reportRoutes, { prefix: "/reports" });
  await app.register(adminRoutes, { prefix: "/admin" });
  await app.register(employeeRoutes, { prefix: "/employees" });
  await app.register(leaveRoutes, { prefix: "/leave" });
  await app.register(monthlyReportRoutes, { prefix: "/monthly-reports" });
  await app.register(calendarDigestRoutes, { prefix: "/calendar-digest" });

  return app;
}

async function start() {
  const app = await buildApp();
  const port = parseInt(process.env.API_PORT ?? "3001", 10);
  const host = process.env.API_HOST ?? "0.0.0.0";

  try {
    await app.listen({ port, host });
    app.log.info(`🚀 API server running at http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

export { buildApp };
