// src/services/approval.service.ts
// Approval Service

import { db } from "@/lib/db";
import type { ApprovalStatus, Prisma } from ".prisma/hrm-ai-client";
import type { PaginatedResponse } from "@/types";
import { processApproval } from "@/lib/workflow/engine";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ApprovalFilters {
  status?: ApprovalStatus;
  page?: number;
  pageSize?: number;
}

export interface ApprovalWithDetails {
  id: string;
  status: ApprovalStatus;
  comments: string | null;
  respondedAt: Date | null;
  dueAt: Date | null;
  isOverdue: boolean;
  createdAt: Date;
  step: {
    name: string;
    stepOrder: number;
  };
  approver: {
    id: string;
    name: string;
    email: string;
  };
  delegatedFrom: {
    id: string;
    name: string;
  } | null;
  instance: {
    id: string;
    referenceType: string;
    referenceId: string;
    status: string;
    requester: {
      id: string;
      name: string;
      email: string;
    };
  };
}

// ═══════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════

export const approvalService = {
  /**
   * Get pending approvals for a user
   */
  async getPending(userId: string): Promise<ApprovalWithDetails[]> {
    const approvals = await db.approvalStep.findMany({
      where: {
        approverId: userId,
        status: "PENDING",
      },
      include: {
        step: {
          select: { name: true, stepOrder: true },
        },
        approver: {
          select: { id: true, name: true, email: true },
        },
        delegatedFrom: {
          select: { id: true, name: true },
        },
        instance: {
          select: {
            id: true,
            referenceType: true,
            referenceId: true,
            status: true,
            requester: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return approvals.map((a) => ({
      id: a.id,
      status: a.status,
      comments: a.comments,
      respondedAt: a.respondedAt,
      dueAt: a.dueAt,
      isOverdue: a.isOverdue,
      createdAt: a.createdAt,
      step: a.step,
      approver: a.approver,
      delegatedFrom: a.delegatedFrom,
      instance: a.instance,
    }));
  },

  /**
   * Get approval history for a user
   */
  async getHistory(
    userId: string,
    filters: ApprovalFilters = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<PaginatedResponse<any>> {
    const { status, page = 1, pageSize = 20 } = filters;
    const skip = (page - 1) * pageSize;

    const where: Prisma.ApprovalStepWhereInput = {
      approverId: userId,
      status: status || { not: "PENDING" },
    };

    const [data, total] = await Promise.all([
      db.approvalStep.findMany({
        where,
        include: {
          step: {
            select: { name: true, stepOrder: true },
          },
          instance: {
            select: {
              id: true,
              referenceType: true,
              referenceId: true,
              status: true,
              requester: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        orderBy: { respondedAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.approvalStep.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  /**
   * Get approval by ID with full details
   */
  async getById(approvalId: string) {
    const approval = await db.approvalStep.findUnique({
      where: { id: approvalId },
      include: {
        step: true,
        approver: {
          select: { id: true, name: true, email: true },
        },
        delegatedFrom: {
          select: { id: true, name: true },
        },
        instance: {
          include: {
            definition: true,
            requester: {
              select: {
                id: true,
                name: true,
                email: true,
                employee: {
                  select: {
                    id: true,
                    employeeCode: true,
                    fullName: true,
                    phone: true,
                    department: { select: { name: true } },
                    position: { select: { name: true } },
                  },
                },
              },
            },
            approvalSteps: {
              include: {
                step: true,
                approver: { select: { id: true, name: true } },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    if (!approval) return null;

    // Get the actual request data based on reference type
    let requestData = null;
    if (approval.instance.referenceType === "LEAVE_REQUEST") {
      requestData = await db.leaveRequest.findUnique({
        where: { id: approval.instance.referenceId },
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              department: { select: { name: true } },
            },
          },
          policy: true,
        },
      });
    }

    return {
      ...approval,
      requestData,
    };
  },

  /**
   * Approve a request
   */
  async approve(approvalId: string, userId: string, comments?: string) {
    await processApproval(approvalId, userId, "APPROVED", comments);
    return this.getById(approvalId);
  },

  /**
   * Reject a request
   */
  async reject(approvalId: string, userId: string, comments?: string) {
    if (!comments) {
      throw new Error("Vui lòng nhập lý do từ chối");
    }
    await processApproval(approvalId, userId, "REJECTED", comments);
    return this.getById(approvalId);
  },

  /**
   * Get pending count for a user
   */
  async getPendingCount(userId: string): Promise<number> {
    return db.approvalStep.count({
      where: {
        approverId: userId,
        status: "PENDING",
      },
    });
  },

  /**
   * Get all approvals for a workflow instance
   */
  async getByInstance(instanceId: string) {
    return db.approvalStep.findMany({
      where: { instanceId },
      include: {
        step: true,
        approver: {
          select: { id: true, name: true, email: true },
        },
        delegatedFrom: {
          select: { id: true, name: true },
        },
      },
      orderBy: { step: { stepOrder: "asc" } },
    });
  },

  /**
   * Check overdue approvals and mark them
   */
  async markOverdueApprovals() {
    const now = new Date();

    await db.approvalStep.updateMany({
      where: {
        status: "PENDING",
        dueAt: { lt: now },
        isOverdue: false,
      },
      data: {
        isOverdue: true,
      },
    });
  },
};
