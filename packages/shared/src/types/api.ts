// ─── API response wrappers ──────────────────────────────────────────

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Pagination ─────────────────────────────────────────────────────

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Date range filter ──────────────────────────────────────────────

export interface DateRangeFilter {
  from: string; // ISO date string
  to: string;   // ISO date string
}

// ─── JWT payload ────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;          // user ID
  orgId: string;
  email: string;
  roles: string[];
  iat: number;
  exp: number;
}
