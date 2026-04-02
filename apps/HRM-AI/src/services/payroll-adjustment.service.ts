// src/services/payroll-adjustment.service.ts
// Payroll Adjustment Service

import { db } from "@/lib/db";
import type {
  Prisma,
  PayrollStatus,
  PayrollComponentCategory,
  PayrollItemType,
} from ".prisma/hrm-ai-client";
import type { PaginatedResponse } from "@/types";

export interface PayrollAdjustmentFilters {
  employeeId?: string;
  year?: number;
  month?: number;
  status?: PayrollStatus;
  category?: PayrollComponentCategory;
  itemType?: PayrollItemType;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PayrollAdjustmentWithRelations {
  id: string;
  tenantId: string;
  employeeId: string;
  year: number;
  month: number;
  name: string;
  category: PayrollComponentCategory;
  itemType: PayrollItemType;
  amount: Prisma.Decimal;
  isTaxable: boolean;
  status: PayrollStatus;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  reason: string;
  attachmentUrl: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    department: { id: string; name: string } | null;
  };
  creator: {
    id: string;
    name: string;
    email: string;
  };
  approver: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export const payrollAdjustmentService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Find all adjustments with filters
   */
  async findAll(
    tenantId: string,
    filters: PayrollAdjustmentFilters = {},
  ): Promise<PaginatedResponse<PayrollAdjustmentWithRelations>> {
    const {
      employeeId,
      year,
      month,
      status,
      category,
      itemType,
      search,
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.PayrollAdjustmentWhereInput = {
      tenantId,
      ...(employeeId && { employeeId }),
      ...(year && { year }),
      ...(month && { month }),
      ...(status && { status }),
      ...(category && { category }),
      ...(itemType && { itemType }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { employee: { fullName: { contains: search, mode: "insensitive" } } },
          {
            employee: {
              employeeCode: { contains: search, mode: "insensitive" },
            },
          },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      db.payrollAdjustment.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              department: { select: { id: true, name: true } },
            },
          },
          creator: {
            select: { id: true, name: true, email: true },
          },
          approver: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.payrollAdjustment.count({ where }),
    ]);

    return {
      data: data as unknown as PayrollAdjustmentWithRelations[],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  /**
   * Find by ID
   */
  async findById(tenantId: string, id: string) {
    return db.payrollAdjustment.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: { select: { id: true, name: true } },
            position: { select: { id: true, name: true } },
          },
        },
        creator: {
          select: { id: true, name: true, email: true },
        },
        approver: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  },

  /**
   * Get adjustments for period and employee
   */
  async getForPeriodEmployee(
    tenantId: string,
    year: number,
    month: number,
    employeeId: string,
  ) {
    return db.payrollAdjustment.findMany({
      where: {
        tenantId,
        year,
        month,
        employeeId,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Get pending adjustments for approval
   */
  async getPendingApprovals(tenantId: string) {
    return db.payrollAdjustment.findMany({
      where: {
        tenantId,
        status: "PENDING_APPROVAL",
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: { select: { name: true } },
          },
        },
        creator: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  },

  /**
   * Create new adjustment
   */
  async create(
    tenantId: string,
    userId: string,
    data: {
      employeeId: string;
      year: number;
      month: number;
      name: string;
      category: PayrollComponentCategory;
      itemType: PayrollItemType;
      amount: number;
      isTaxable?: boolean;
      reason: string;
      attachmentUrl?: string;
      notes?: string;
    },
  ) {
    // Check if period is locked
    const period = await db.payrollPeriod.findFirst({
      where: { tenantId, year: data.year, month: data.month },
    });

    if (period?.isLocked) {
      throw new Error("Kỳ lương đã khóa, không thể tạo điều chỉnh");
    }

    // Verify employee exists
    const employee = await db.employee.findFirst({
      where: { id: data.employeeId, tenantId },
    });

    if (!employee) {
      throw new Error("Nhân viên không tồn tại");
    }

    return db.payrollAdjustment.create({
      data: {
        tenantId,
        employeeId: data.employeeId,
        year: data.year,
        month: data.month,
        name: data.name,
        category: data.category,
        itemType: data.itemType,
        amount: data.amount,
        isTaxable: data.isTaxable ?? true,
        status: "PENDING_APPROVAL",
        createdBy: userId,
        reason: data.reason,
        attachmentUrl: data.attachmentUrl,
        notes: data.notes,
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
          },
        },
      },
    });
  },

  /**
   * Update adjustment
   */
  async update(
    tenantId: string,
    id: string,
    data: Prisma.PayrollAdjustmentUpdateInput,
  ) {
    const adjustment = await db.payrollAdjustment.findFirst({
      where: { id, tenantId },
    });

    if (!adjustment) {
      throw new Error("Điều chỉnh không tồn tại");
    }

    if (adjustment.status !== "PENDING_APPROVAL") {
      throw new Error("Chỉ có thể chỉnh sửa điều chỉnh đang chờ duyệt");
    }

    return db.payrollAdjustment.update({
      where: { id },
      data,
    });
  },

  /**
   * Delete adjustment
   */
  async delete(tenantId: string, id: string) {
    const adjustment = await db.payrollAdjustment.findFirst({
      where: { id, tenantId },
    });

    if (!adjustment) {
      throw new Error("Điều chỉnh không tồn tại");
    }

    if (adjustment.status !== "PENDING_APPROVAL") {
      throw new Error("Chỉ có thể xóa điều chỉnh đang chờ duyệt");
    }

    return db.payrollAdjustment.delete({
      where: { id },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Approval Workflow
  // ═══════════════════════════════════════════════════════════════

  /**
   * Approve adjustment
   */
  async approve(tenantId: string, id: string, approverId: string) {
    const adjustment = await db.payrollAdjustment.findFirst({
      where: { id, tenantId },
    });

    if (!adjustment) {
      throw new Error("Điều chỉnh không tồn tại");
    }

    if (adjustment.status !== "PENDING_APPROVAL") {
      throw new Error("Điều chỉnh không ở trạng thái chờ duyệt");
    }

    return db.payrollAdjustment.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: approverId,
        approvedAt: new Date(),
      },
    });
  },

  /**
   * Reject adjustment
   */
  async reject(
    tenantId: string,
    id: string,
    approverId: string,
    rejectionReason: string,
  ) {
    const adjustment = await db.payrollAdjustment.findFirst({
      where: { id, tenantId },
    });

    if (!adjustment) {
      throw new Error("Điều chỉnh không tồn tại");
    }

    if (adjustment.status !== "PENDING_APPROVAL") {
      throw new Error("Điều chỉnh không ở trạng thái chờ duyệt");
    }

    if (!rejectionReason) {
      throw new Error("Vui lòng nhập lý do từ chối");
    }

    return db.payrollAdjustment.update({
      where: { id },
      data: {
        status: "CANCELLED",
        approvedBy: approverId,
        approvedAt: new Date(),
        rejectionReason,
      },
    });
  },

  /**
   * Bulk approve adjustments
   */
  async bulkApprove(tenantId: string, ids: string[], approverId: string) {
    return db.payrollAdjustment.updateMany({
      where: {
        id: { in: ids },
        tenantId,
        status: "PENDING_APPROVAL",
      },
      data: {
        status: "APPROVED",
        approvedBy: approverId,
        approvedAt: new Date(),
      },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Statistics
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get adjustment summary for period
   */
  async getPeriodSummary(tenantId: string, year: number, month: number) {
    const adjustments = await db.payrollAdjustment.findMany({
      where: {
        tenantId,
        year,
        month,
      },
    });

    const approved = adjustments.filter((a) => a.status === "APPROVED");
    const pending = adjustments.filter((a) => a.status === "PENDING_APPROVAL");
    const rejected = adjustments.filter((a) => a.status === "CANCELLED");

    const earnings = approved.filter((a) => a.itemType === "EARNING");
    const deductions = approved.filter((a) => a.itemType === "DEDUCTION");

    return {
      total: adjustments.length,
      approved: approved.length,
      pending: pending.length,
      rejected: rejected.length,
      totalEarnings: earnings.reduce((sum, a) => sum + Number(a.amount), 0),
      totalDeductions: deductions.reduce((sum, a) => sum + Number(a.amount), 0),
    };
  },
};
