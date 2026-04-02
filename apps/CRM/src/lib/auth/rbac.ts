import { NextResponse } from "next/server";
import { getCurrentUser, AuthError } from "./get-current-user";
import type { User, UserRole } from ".prisma/crm-client";

// ── Role Hierarchy ──────────────────────────────────────────────────
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  ADMIN: 4,
  MANAGER: 3,
  MEMBER: 2,
  VIEWER: 1,
};

export function isRoleAtLeast(
  userRole: UserRole,
  requiredRole: UserRole,
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

// ── Permission checks ───────────────────────────────────────────────
export type Action =
  | "create"
  | "edit_own"
  | "edit_any"
  | "delete_own"
  | "delete_any"
  | "view_all"
  | "manage_team"
  | "manage_settings"
  | "manage_campaigns"
  | "manage_portal"
  | "export";

export function canAccess(user: User, action: Action): boolean {
  const role = user.role as UserRole;
  switch (action) {
    case "view_all":
      return isRoleAtLeast(role, "MANAGER");
    case "create":
    case "edit_own":
    case "delete_own":
    case "export":
      return isRoleAtLeast(role, "MEMBER");
    case "edit_any":
    case "delete_any":
    case "manage_campaigns":
    case "manage_portal":
      return isRoleAtLeast(role, "MANAGER");
    case "manage_team":
    case "manage_settings":
      return role === "ADMIN";
    default:
      return false;
  }
}

// ── 403 Response ────────────────────────────────────────────────────
export function forbiddenResponse(requiredRole?: string) {
  return NextResponse.json(
    {
      error: "Forbidden",
      message: "Bạn không có quyền thực hiện thao tác này",
      ...(requiredRole && { requiredRole }),
    },
    { status: 403 },
  );
}

// ── API Helpers ─────────────────────────────────────────────────────

/**
 * Get current user and require specific roles.
 * Returns user if authorized, or a 403/401 NextResponse.
 */
export async function requireRole(
  allowedRoles: UserRole[],
): Promise<User | NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!allowedRoles.includes(user.role as UserRole)) {
      return forbiddenResponse(allowedRoles[0]);
    }
    return user;
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Check if user is the resource owner OR has one of the allowed roles.
 * Used for edit/delete operations.
 */
export async function requireOwnerOrRole(
  resourceOwnerId: string,
  allowedRoles: UserRole[],
): Promise<User | NextResponse> {
  try {
    const user = await getCurrentUser();
    // Owner can always access their own resource
    if (user.id === resourceOwnerId) return user;
    // Otherwise need one of the allowed roles
    if (!allowedRoles.includes(user.role as UserRole)) {
      return forbiddenResponse();
    }
    return user;
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Type guard: check if the result is a NextResponse (error) or a User (success).
 */
export function isErrorResponse(
  result: User | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}
