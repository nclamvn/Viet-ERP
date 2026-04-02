// src/services/leave-policy.service.ts
// Leave Policy Service

import { db } from "@/lib/db";
import type { LeaveType, Prisma } from ".prisma/hrm-unified-client";
import type { PaginatedResponse } from "@/types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface LeavePolicyFilters {
  leaveType?: LeaveType;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateLeavePolicyInput {
  name: string;
  code: string;
  leaveType: LeaveType;
  daysPerYear: number;
  maxCarryOver?: number;
  carryOverExpireMonths?: number;
  minDaysPerRequest?: number;
  maxDaysPerRequest?: number | null;
  advanceNoticeDays?: number;
  allowHalfDay?: boolean;
  allowNegativeBalance?: boolean;
  probationEligible?: boolean;
  minTenureMonths?: number;
  isPaid?: boolean;
  description?: string;
}

// ═══════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════

export const leavePolicyService = {
  /**
   * Get all leave policies with pagination
   */
  async getAll(
    tenantId: string,
    filters: LeavePolicyFilters = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<PaginatedResponse<any>> {
    const { leaveType, isActive = true, page = 1, pageSize = 50 } = filters;
    const skip = (page - 1) * pageSize;

    const where: Prisma.LeavePolicyWhereInput = {
      tenantId,
      ...(leaveType && { leaveType }),
      ...(isActive !== undefined && { isActive }),
    };

    const [data, total] = await Promise.all([
      db.leavePolicy.findMany({
        where,
        orderBy: [{ leaveType: "asc" }, { name: "asc" }],
        skip,
        take: pageSize,
      }),
      db.leavePolicy.count({ where }),
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
   * Get a single policy by ID
   */
  async getById(tenantId: string, id: string) {
    return db.leavePolicy.findFirst({
      where: { id, tenantId },
    });
  },

  /**
   * Get policy by code
   */
  async getByCode(tenantId: string, code: string) {
    return db.leavePolicy.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
  },

  /**
   * Create a new leave policy
   */
  async create(tenantId: string, data: CreateLeavePolicyInput) {
    // Check for duplicate code
    const existing = await this.getByCode(tenantId, data.code);
    if (existing) {
      throw new Error("Mã chính sách đã tồn tại");
    }

    return db.leavePolicy.create({
      data: {
        tenantId,
        name: data.name,
        code: data.code,
        leaveType: data.leaveType,
        daysPerYear: data.daysPerYear,
        maxCarryOver: data.maxCarryOver ?? 0,
        carryOverExpireMonths: data.carryOverExpireMonths ?? 3,
        minDaysPerRequest: data.minDaysPerRequest ?? 0.5,
        maxDaysPerRequest: data.maxDaysPerRequest ?? null,
        advanceNoticeDays: data.advanceNoticeDays ?? 0,
        allowHalfDay: data.allowHalfDay ?? true,
        allowNegativeBalance: data.allowNegativeBalance ?? false,
        probationEligible: data.probationEligible ?? false,
        minTenureMonths: data.minTenureMonths ?? 0,
        isPaid: data.isPaid ?? true,
        description: data.description,
        isActive: true,
      },
    });
  },

  /**
   * Update a leave policy
   */
  async update(
    tenantId: string,
    id: string,
    data: Partial<CreateLeavePolicyInput>,
  ) {
    const policy = await this.getById(tenantId, id);
    if (!policy) {
      throw new Error("Chính sách không tồn tại");
    }

    // If changing code, check for duplicates
    if (data.code && data.code !== policy.code) {
      const existing = await this.getByCode(tenantId, data.code);
      if (existing) {
        throw new Error("Mã chính sách đã tồn tại");
      }
    }

    return db.leavePolicy.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.code && { code: data.code }),
        ...(data.leaveType && { leaveType: data.leaveType }),
        ...(data.daysPerYear !== undefined && {
          daysPerYear: data.daysPerYear,
        }),
        ...(data.maxCarryOver !== undefined && {
          maxCarryOver: data.maxCarryOver,
        }),
        ...(data.carryOverExpireMonths !== undefined && {
          carryOverExpireMonths: data.carryOverExpireMonths,
        }),
        ...(data.minDaysPerRequest !== undefined && {
          minDaysPerRequest: data.minDaysPerRequest,
        }),
        ...(data.maxDaysPerRequest !== undefined && {
          maxDaysPerRequest: data.maxDaysPerRequest,
        }),
        ...(data.advanceNoticeDays !== undefined && {
          advanceNoticeDays: data.advanceNoticeDays,
        }),
        ...(data.allowHalfDay !== undefined && {
          allowHalfDay: data.allowHalfDay,
        }),
        ...(data.allowNegativeBalance !== undefined && {
          allowNegativeBalance: data.allowNegativeBalance,
        }),
        ...(data.probationEligible !== undefined && {
          probationEligible: data.probationEligible,
        }),
        ...(data.minTenureMonths !== undefined && {
          minTenureMonths: data.minTenureMonths,
        }),
        ...(data.isPaid !== undefined && { isPaid: data.isPaid }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
      },
    });
  },

  /**
   * Delete (soft) a leave policy
   */
  async delete(tenantId: string, id: string) {
    const policy = await this.getById(tenantId, id);
    if (!policy) {
      throw new Error("Chính sách không tồn tại");
    }

    // Check if policy is in use
    const balanceCount = await db.leaveBalance.count({
      where: { policyId: id },
    });

    if (balanceCount > 0) {
      // Soft delete - just deactivate
      return db.leavePolicy.update({
        where: { id },
        data: { isActive: false },
      });
    }

    return db.leavePolicy.delete({
      where: { id },
    });
  },

  /**
   * Get active policies for employee
   */
  async getForEmployee(tenantId: string, employeeId: string) {
    const employee = await db.employee.findFirst({
      where: { id: employeeId, tenantId },
    });

    if (!employee) return [];

    const policies = await db.leavePolicy.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      orderBy: { leaveType: "asc" },
    });

    // Filter by eligibility (tenure, probation)
    const now = new Date();
    const tenureMonths = Math.floor(
      (now.getTime() - new Date(employee.hireDate).getTime()) /
        (1000 * 60 * 60 * 24 * 30),
    );
    const isProbation = employee.status === "PROBATION";

    return policies.filter((policy) => {
      if (!policy.probationEligible && isProbation) return false;
      if (policy.minTenureMonths > tenureMonths) return false;
      return true;
    });
  },
};
