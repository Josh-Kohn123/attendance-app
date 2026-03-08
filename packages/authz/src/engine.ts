import {
  type Role,
  type Permission,
  type ScopeType,
  ROLE_PERMISSIONS,
} from "@orbs/shared";

// ─── Types ──────────────────────────────────────────────────────────

export interface AuthzContext {
  userId: string;
  orgId: string;
  roles: Role[];
  scopes: Array<{ scopeType: ScopeType; scopeId: string }>;
}

export interface ScopeCheck {
  scopeType: ScopeType;
  scopeId: string;
}

// ─── RBAC: Permission check ─────────────────────────────────────────

/**
 * Check if the user's roles grant a specific permission.
 */
export function hasPermission(ctx: AuthzContext, permission: Permission): boolean {
  return ctx.roles.some((role) => {
    const perms = ROLE_PERMISSIONS[role];
    return perms && (perms as readonly string[]).includes(permission);
  });
}

// ─── ABAC: Scope check ─────────────────────────────────────────────

/**
 * Check if the user has access to a specific resource scope.
 * Admins with org-level scope can access everything in their org.
 * Managers with department scope can access employees in that department.
 */
export function canAccessResource(ctx: AuthzContext, check: ScopeCheck): boolean {
  // Admin role with no specific scope constraint = org-wide access
  if (ctx.roles.includes("admin")) {
    return true;
  }

  // Check if user has a matching scope
  return ctx.scopes.some((scope) => {
    // Org scope grants access to everything in that org
    if (scope.scopeType === "org") return true;

    // Direct match
    if (scope.scopeType === check.scopeType && scope.scopeId === check.scopeId) {
      return true;
    }

    return false;
  });
}

// ─── Combined authorization ─────────────────────────────────────────

/**
 * Full authorization check: permission + scope.
 */
export function authorize(
  ctx: AuthzContext,
  permission: Permission,
  scope?: ScopeCheck
): { allowed: boolean; reason?: string } {
  if (!hasPermission(ctx, permission)) {
    return {
      allowed: false,
      reason: `Missing permission: ${permission}`,
    };
  }

  if (scope && !canAccessResource(ctx, scope)) {
    return {
      allowed: false,
      reason: `Access denied to ${scope.scopeType}:${scope.scopeId}`,
    };
  }

  return { allowed: true };
}
