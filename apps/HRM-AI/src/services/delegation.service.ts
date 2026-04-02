// src/services/delegation.service.ts
// Delegation Service

import { db } from "@/lib/db";
import { Prisma } from ".prisma/hrm-ai-client";
import type { WorkflowType } from ".prisma/hrm-ai-client";
import type { PaginatedResponse } from "@/types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface DelegationFilters {
  delegatorId?: string;
  delegateId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateDelegationInput {
  delegatorId: string;
  delegateId: string;
  startDate: Date;
  endDate: Date;
  workflowTypes?: WorkflowType[];
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════

export const delegationService = {
  /**
   * Get all delegations with pagination
   */
  async getAll(
    tenantId: string,
    filters: DelegationFilters = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<PaginatedResponse<any>> {
    const {
      delegatorId,
      delegateId,
      isActive,
      page = 1,
      pageSize = 20,
    } = filters;
    const skip = (page - 1) * pageSize;

    const where: Prisma.DelegationWhereInput = {
      tenantId,
      ...(delegatorId && { delegatorId }),
      ...(delegateId && { delegateId }),
      ...(isActive !== undefined && { isActive }),
    };

    const [data, total] = await Promise.all([
      db.delegation.findMany({
        where,
        include: {
          delegator: {
            select: { id: true, name: true, email: true },
          },
          delegate: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.delegation.count({ where }),
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
   * Get delegations by delegator (user who delegates)
   */
  async getByDelegator(tenantId: string, delegatorId: string) {
    return db.delegation.findMany({
      where: { tenantId, delegatorId },
      include: {
        delegate: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { startDate: "desc" },
    });
  },

  /**
   * Get delegations received by a user
   */
  async getByDelegate(tenantId: string, delegateId: string) {
    return db.delegation.findMany({
      where: { tenantId, delegateId, isActive: true },
      include: {
        delegator: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { startDate: "desc" },
    });
  },

  /**
   * Get active delegation for a user
   */
  async getActiveDelegation(tenantId: string, userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return db.delegation.findFirst({
      where: {
        tenantId,
        delegatorId: userId,
        isActive: true,
        startDate: { lte: today },
        endDate: { gte: today },
      },
      include: {
        delegate: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  },

  /**
   * Get by ID
   */
  async getById(tenantId: string, id: string) {
    return db.delegation.findFirst({
      where: { id, tenantId },
      include: {
        delegator: {
          select: { id: true, name: true, email: true },
        },
        delegate: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  },

  /**
   * Create a new delegation
   */
  async create(tenantId: string, data: CreateDelegationInput) {
    // Validate delegator and delegate are different
    if (data.delegatorId === data.delegateId) {
      throw new Error("Không thể ủy quyền cho chính mình");
    }

    // Validate dates
    if (data.endDate < data.startDate) {
      throw new Error("Ngày kết thúc phải sau ngày bắt đầu");
    }

    // Check for overlapping delegations
    const existing = await db.delegation.findFirst({
      where: {
        tenantId,
        delegatorId: data.delegatorId,
        isActive: true,
        OR: [
          {
            AND: [
              { startDate: { lte: data.startDate } },
              { endDate: { gte: data.startDate } },
            ],
          },
          {
            AND: [
              { startDate: { lte: data.endDate } },
              { endDate: { gte: data.endDate } },
            ],
          },
          {
            AND: [
              { startDate: { gte: data.startDate } },
              { endDate: { lte: data.endDate } },
            ],
          },
        ],
      },
    });

    if (existing) {
      throw new Error("Đã có ủy quyền trong khoảng thời gian này");
    }

    // Create delegation
    const delegation = await db.delegation.create({
      data: {
        tenantId,
        delegatorId: data.delegatorId,
        delegateId: data.delegateId,
        startDate: data.startDate,
        endDate: data.endDate,
        workflowTypes: data.workflowTypes ?? Prisma.DbNull,
        reason: data.reason,
        isActive: true,
      },
      include: {
        delegator: {
          select: { id: true, name: true, email: true },
        },
        delegate: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Notify delegate
    await db.notification.create({
      data: {
        tenantId,
        userId: data.delegateId,
        type: "DELEGATION_ASSIGNED",
        title: "Được ủy quyền",
        message: `Bạn được ủy quyền duyệt thay từ ${delegation.delegator.name}`,
        referenceType: "DELEGATION",
        referenceId: delegation.id,
      },
    });

    return delegation;
  },

  /**
   * Update a delegation
   */
  async update(
    tenantId: string,
    id: string,
    data: Partial<Omit<CreateDelegationInput, "delegatorId">>,
  ) {
    const delegation = await this.getById(tenantId, id);
    if (!delegation) {
      throw new Error("Ủy quyền không tồn tại");
    }

    if (
      data.endDate &&
      data.endDate < (data.startDate || delegation.startDate)
    ) {
      throw new Error("Ngày kết thúc phải sau ngày bắt đầu");
    }

    return db.delegation.update({
      where: { id },
      data: {
        ...(data.delegateId && { delegateId: data.delegateId }),
        ...(data.startDate && { startDate: data.startDate }),
        ...(data.endDate && { endDate: data.endDate }),
        ...(data.workflowTypes !== undefined && {
          workflowTypes: data.workflowTypes || null,
        }),
        ...(data.reason !== undefined && { reason: data.reason }),
      },
    });
  },

  /**
   * Deactivate a delegation
   */
  async deactivate(tenantId: string, id: string) {
    const delegation = await this.getById(tenantId, id);
    if (!delegation) {
      throw new Error("Ủy quyền không tồn tại");
    }

    return db.delegation.update({
      where: { id },
      data: { isActive: false },
    });
  },

  /**
   * Delete a delegation
   */
  async delete(tenantId: string, id: string) {
    const delegation = await this.getById(tenantId, id);
    if (!delegation) {
      throw new Error("Ủy quyền không tồn tại");
    }

    return db.delegation.delete({
      where: { id },
    });
  },

  /**
   * Check if user has an active delegation that applies to a workflow type
   */
  async hasActiveDelegation(
    tenantId: string,
    userId: string,
    workflowType: WorkflowType,
  ): Promise<{ hasDelegate: boolean; delegateId?: string }> {
    const delegation = await this.getActiveDelegation(tenantId, userId);

    if (!delegation) {
      return { hasDelegate: false };
    }

    // If workflowTypes is null, delegation applies to all types
    if (!delegation.workflowTypes) {
      return { hasDelegate: true, delegateId: delegation.delegateId };
    }

    // Check if workflow type is in the list
    const types = delegation.workflowTypes as WorkflowType[];
    if (types.includes(workflowType)) {
      return { hasDelegate: true, delegateId: delegation.delegateId };
    }

    return { hasDelegate: false };
  },
};
