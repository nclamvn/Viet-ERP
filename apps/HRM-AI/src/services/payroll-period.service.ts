// src/services/payroll-period.service.ts
// Payroll Period Service

import { db } from "@/lib/db";
import type { Prisma, PayrollStatus } from ".prisma/hrm-ai-client";
import type { PaginatedResponse } from "@/types";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { vi } from "date-fns/locale";

export interface PayrollPeriodFilters {
  year?: number;
  month?: number;
  status?: PayrollStatus;
  page?: number;
  pageSize?: number;
}

export interface PayrollPeriodWithRelations {
  id: string;
  tenantId: string;
  name: string;
  year: number;
  month: number;
  periodStart: Date;
  periodEnd: Date;
  status: PayrollStatus;
  calculatedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  paidAt: Date | null;
  totalEmployees: number;
  totalGross: Prisma.Decimal;
  totalDeductions: Prisma.Decimal;
  totalNet: Prisma.Decimal;
  totalEmployerCost: Prisma.Decimal;
  isLocked: boolean;
  lockedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    payrolls: number;
    bankPayments: number;
  };
}

export const payrollPeriodService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Find all periods with filters
   */
  async findAll(
    tenantId: string,
    filters: PayrollPeriodFilters = {},
  ): Promise<PaginatedResponse<PayrollPeriodWithRelations>> {
    const { year, month, status, page = 1, pageSize = 12 } = filters;

    const where: Prisma.PayrollPeriodWhereInput = {
      tenantId,
      ...(year && { year }),
      ...(month && { month }),
      ...(status && { status }),
    };

    const [data, total] = await Promise.all([
      db.payrollPeriod.findMany({
        where,
        include: {
          _count: {
            select: {
              payrolls: true,
              bankPayments: true,
            },
          },
        },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.payrollPeriod.count({ where }),
    ]);

    return {
      data: data as unknown as PayrollPeriodWithRelations[],
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
    return db.payrollPeriod.findFirst({
      where: { id, tenantId },
      include: {
        approver: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: {
            payrolls: true,
            bankPayments: true,
          },
        },
      },
    });
  },

  /**
   * Find by year and month
   */
  async findByYearMonth(tenantId: string, year: number, month: number) {
    return db.payrollPeriod.findFirst({
      where: { tenantId, year, month },
      include: {
        _count: {
          select: {
            payrolls: true,
            bankPayments: true,
          },
        },
      },
    });
  },

  /**
   * Get current period
   */
  async getCurrentPeriod(tenantId: string) {
    const now = new Date();
    return this.findByYearMonth(
      tenantId,
      now.getFullYear(),
      now.getMonth() + 1,
    );
  },

  /**
   * Create new period
   */
  async create(tenantId: string, year: number, month: number, notes?: string) {
    // Check for existing period
    const existing = await this.findByYearMonth(tenantId, year, month);
    if (existing) {
      throw new Error(`Kỳ lương tháng ${month}/${year} đã tồn tại`);
    }

    const periodDate = new Date(year, month - 1, 1);
    const periodStart = startOfMonth(periodDate);
    const periodEnd = endOfMonth(periodDate);
    const name = format(periodDate, "'Tháng' MM/yyyy", { locale: vi });

    return db.payrollPeriod.create({
      data: {
        tenantId,
        name,
        year,
        month,
        periodStart,
        periodEnd,
        status: "DRAFT",
        notes,
      },
    });
  },

  /**
   * Update period
   */
  async update(
    tenantId: string,
    id: string,
    data: Prisma.PayrollPeriodUpdateInput,
  ) {
    const period = await db.payrollPeriod.findFirst({
      where: { id, tenantId },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    if (period.isLocked) {
      throw new Error("Kỳ lương đã khóa, không thể chỉnh sửa");
    }

    return db.payrollPeriod.update({
      where: { id },
      data,
    });
  },

  /**
   * Delete period
   */
  async delete(tenantId: string, id: string) {
    const period = await db.payrollPeriod.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: {
            payrolls: true,
            bankPayments: true,
          },
        },
      },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    if (period.isLocked) {
      throw new Error("Kỳ lương đã khóa, không thể xóa");
    }

    if (period._count.payrolls > 0) {
      throw new Error("Không thể xóa kỳ lương đã có dữ liệu");
    }

    return db.payrollPeriod.delete({
      where: { id },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Status Management
  // ═══════════════════════════════════════════════════════════════

  /**
   * Update status
   */
  async updateStatus(
    tenantId: string,
    id: string,
    status: PayrollStatus,
    userId?: string,
  ) {
    const period = await db.payrollPeriod.findFirst({
      where: { id, tenantId },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    const now = new Date();
    const updateData: Prisma.PayrollPeriodUpdateInput = { status };

    // Set timestamps based on status
    switch (status) {
      case "CALCULATING":
        break;
      case "SIMULATED":
        updateData.calculatedAt = now;
        break;
      case "PENDING_APPROVAL":
        break;
      case "APPROVED":
        updateData.approvedAt = now;
        if (userId) {
          updateData.approver = { connect: { id: userId } };
        }
        break;
      case "PAID":
        updateData.paidAt = now;
        updateData.isLocked = true;
        updateData.lockedAt = now;
        break;
      case "CANCELLED":
        break;
    }

    return db.payrollPeriod.update({
      where: { id },
      data: updateData,
    });
  },

  /**
   * Lock period
   */
  async lock(tenantId: string, id: string) {
    const period = await db.payrollPeriod.findFirst({
      where: { id, tenantId },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    return db.payrollPeriod.update({
      where: { id },
      data: {
        isLocked: true,
        lockedAt: new Date(),
      },
    });
  },

  /**
   * Unlock period (admin only)
   */
  async unlock(tenantId: string, id: string) {
    const period = await db.payrollPeriod.findFirst({
      where: { id, tenantId },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    return db.payrollPeriod.update({
      where: { id },
      data: {
        isLocked: false,
        lockedAt: null,
      },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Totals Update
  // ═══════════════════════════════════════════════════════════════

  /**
   * Update period totals after calculation
   */
  async updateTotals(
    id: string,
    totals: {
      totalEmployees: number;
      totalGross: number;
      totalDeductions: number;
      totalNet: number;
      totalEmployerCost: number;
    },
  ) {
    return db.payrollPeriod.update({
      where: { id },
      data: {
        totalEmployees: totals.totalEmployees,
        totalGross: totals.totalGross,
        totalDeductions: totals.totalDeductions,
        totalNet: totals.totalNet,
        totalEmployerCost: totals.totalEmployerCost,
      },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get years that have payroll data
   */
  async getYearsWithData(tenantId: string): Promise<number[]> {
    const result = await db.payrollPeriod.findMany({
      where: { tenantId },
      select: { year: true },
      distinct: ["year"],
      orderBy: { year: "desc" },
    });
    return result.map((r) => r.year);
  },

  /**
   * Get periods for year
   */
  async getPeriodsForYear(tenantId: string, year: number) {
    return db.payrollPeriod.findMany({
      where: { tenantId, year },
      include: {
        _count: {
          select: { payrolls: true },
        },
      },
      orderBy: { month: "asc" },
    });
  },

  /**
   * Create period if not exists
   */
  async getOrCreate(tenantId: string, year: number, month: number) {
    const existing = await this.findByYearMonth(tenantId, year, month);
    if (existing) {
      return existing;
    }
    return this.create(tenantId, year, month);
  },
};
