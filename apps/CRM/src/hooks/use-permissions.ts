"use client";

import { useAuth } from "./use-auth";
import type { UserRole } from ".prisma/crm-client";

const ROLE_HIERARCHY: Record<string, number> = {
  ADMIN: 4,
  MANAGER: 3,
  MEMBER: 2,
  VIEWER: 1,
};

export function usePermissions() {
  const { user, isLoading } = useAuth();
  const role = (user?.role || "VIEWER") as UserRole;

  const isAtLeast = (requiredRole: UserRole): boolean => {
    return (ROLE_HIERARCHY[role] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
  };

  return {
    role,
    isLoading,
    isAdmin: role === "ADMIN",
    isManagerOrAbove: isAtLeast("MANAGER"),
    canCreate: isAtLeast("MEMBER"),
    canEditOwn: isAtLeast("MEMBER"),
    canEditAny: isAtLeast("MANAGER"),
    canDeleteOwn: isAtLeast("MEMBER"),
    canDeleteAny: isAtLeast("MANAGER"),
    canManageTeam: role === "ADMIN",
    canManageSettings: role === "ADMIN",
    canViewApiDocs: isAtLeast("MANAGER"),
    canManageCampaigns: isAtLeast("MANAGER"),
    canManagePortal: isAtLeast("MANAGER"),
    canExport: isAtLeast("MEMBER"),
    isAtLeast,
    /** Check if user is the owner or has manager+ role */
    canEditRecord: (ownerId: string) => {
      if (!user) return false;
      return user.id === ownerId || isAtLeast("MANAGER");
    },
    canDeleteRecord: (ownerId: string) => {
      if (!user) return false;
      return user.id === ownerId || isAtLeast("MANAGER");
    },
    userId: user?.id || null,
  };
}
