// src/lib/workflow/approver-resolver.ts
// Workflow Approver Resolver

import { db } from "@/lib/db";
import type { ApproverType } from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface WorkflowStepConfig {
  approverType: ApproverType;
  specificUserId?: string | null;
  specificRole?: string | null;
}

export interface ApproverResult {
  approverId: string;
  delegatedFromId?: string;
}

// ═══════════════════════════════════════════════════════════════
// Main Resolver
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve the approver for a workflow step
 * Checks for delegation and returns the actual approver
 */
export async function resolveApprover(
  tenantId: string,
  step: WorkflowStepConfig,
  requesterId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context: Record<string, unknown> = {},
): Promise<ApproverResult> {
  let approverId: string | null = null;

  switch (step.approverType) {
    case "SPECIFIC_USER":
      approverId = step.specificUserId || null;
      break;

    case "DIRECT_MANAGER":
      approverId = await getDirectManager(requesterId);
      break;

    case "DEPARTMENT_HEAD":
      approverId = await getDepartmentHead(requesterId);
      break;

    case "HR_MANAGER":
      approverId = await getHRManager(tenantId);
      break;

    case "ROLE_BASED":
      if (step.specificRole) {
        approverId = await getUserByRole(tenantId, step.specificRole);
      }
      break;
  }

  // Fallback to HR Manager if no approver found
  if (!approverId) {
    approverId = await getHRManager(tenantId);
  }

  if (!approverId) {
    throw new Error("Không thể xác định người duyệt");
  }

  // Check for active delegation
  const delegation = await getActiveDelegation(tenantId, approverId);

  if (delegation) {
    return {
      approverId: delegation.delegateId,
      delegatedFromId: approverId,
    };
  }

  return { approverId };
}

// ═══════════════════════════════════════════════════════════════
// Approver Lookup Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Get direct manager of a user
 */
async function getDirectManager(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      employee: {
        include: {
          directManager: {
            include: {
              user: true,
            },
          },
        },
      },
    },
  });

  return user?.employee?.directManager?.user?.id || null;
}

/**
 * Get department head of a user's department
 */
async function getDepartmentHead(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      employee: {
        include: {
          department: {
            include: {
              manager: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return user?.employee?.department?.manager?.user?.id || null;
}

/**
 * Get HR Manager for a tenant
 */
async function getHRManager(tenantId: string): Promise<string | null> {
  const user = await db.user.findFirst({
    where: {
      tenantId,
      role: "HR_MANAGER",
      isActive: true,
    },
  });

  return user?.id || null;
}

/**
 * Get a user by role
 */
async function getUserByRole(
  tenantId: string,
  role: string,
): Promise<string | null> {
  const user = await db.user.findFirst({
    where: {
      tenantId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      role: role as any,
      isActive: true,
    },
  });

  return user?.id || null;
}

/**
 * Check for active delegation
 */
async function getActiveDelegation(
  tenantId: string,
  userId: string,
): Promise<{ delegateId: string } | null> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const delegation = await db.delegation.findFirst({
    where: {
      tenantId,
      delegatorId: userId,
      isActive: true,
      startDate: { lte: today },
      endDate: { gte: today },
    },
    select: {
      delegateId: true,
    },
  });

  return delegation;
}

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Get all potential approvers for a step (for preview)
 */
export async function getApproverPreview(
  tenantId: string,
  step: WorkflowStepConfig,
  requesterId: string,
): Promise<{ id: string; name: string; email: string }[]> {
  const approvers: { id: string; name: string; email: string }[] = [];

  try {
    const result = await resolveApprover(tenantId, step, requesterId);
    const user = await db.user.findUnique({
      where: { id: result.approverId },
      select: { id: true, name: true, email: true },
    });

    if (user) {
      approvers.push(user);
    }

    // If delegated, also show original approver
    if (result.delegatedFromId) {
      const originalUser = await db.user.findUnique({
        where: { id: result.delegatedFromId },
        select: { id: true, name: true, email: true },
      });

      if (originalUser) {
        approvers.push({
          ...originalUser,
          name: `${originalUser.name} (ủy quyền)`,
        });
      }
    }
  } catch {
    // Ignore errors in preview
  }

  return approvers;
}
