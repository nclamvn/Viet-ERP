// src/services/payroll.service.ts
// Payroll Service - Individual payroll records

import { db } from "@/lib/db";
import type {
  Prisma,
  PayrollStatus,
  BankCode,
} from ".prisma/hrm-unified-client";
import type { PaginatedResponse } from "@/types";

export interface PayrollFilters {
  periodId?: string;
  employeeId?: string;
  departmentId?: string;
  status?: PayrollStatus;
  isPaid?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PayrollWithRelations {
  id: string;
  tenantId: string;
  periodId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  departmentName: string | null;
  positionName: string | null;
  baseSalary: Prisma.Decimal;
  insuranceSalary: Prisma.Decimal;
  workDays: Prisma.Decimal;
  standardDays: number;
  otHoursWeekday: Prisma.Decimal;
  otHoursWeekend: Prisma.Decimal;
  otHoursHoliday: Prisma.Decimal;
  otHoursNight: Prisma.Decimal;
  grossSalary: Prisma.Decimal;
  bhxhEmployee: Prisma.Decimal;
  bhytEmployee: Prisma.Decimal;
  bhtnEmployee: Prisma.Decimal;
  totalInsuranceEmployee: Prisma.Decimal;
  taxableIncome: Prisma.Decimal;
  personalDeduction: Prisma.Decimal;
  dependentDeduction: Prisma.Decimal;
  dependentCount: number;
  assessableIncome: Prisma.Decimal;
  pit: Prisma.Decimal;
  otherDeductions: Prisma.Decimal;
  totalDeductions: Prisma.Decimal;
  netSalary: Prisma.Decimal;
  bhxhEmployer: Prisma.Decimal;
  bhytEmployer: Prisma.Decimal;
  bhtnEmployer: Prisma.Decimal;
  totalEmployerCost: Prisma.Decimal;
  bankAccount: string | null;
  bankName: string | null;
  bankCode: BankCode | null;
  status: PayrollStatus;
  isPaid: boolean;
  paidAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  period: {
    id: string;
    name: string;
    year: number;
    month: number;
  };
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    department: { id: string; name: string } | null;
    position: { id: string; name: string } | null;
  };
  items: Array<{
    id: string;
    code: string;
    name: string;
    category: string;
    itemType: string;
    amount: Prisma.Decimal;
    quantity: Prisma.Decimal | null;
    rate: Prisma.Decimal | null;
    multiplier: Prisma.Decimal | null;
  }>;
}

export const payrollService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Find all payrolls with filters
   */
  async findAll(
    tenantId: string,
    filters: PayrollFilters = {},
  ): Promise<PaginatedResponse<PayrollWithRelations>> {
    const {
      periodId,
      employeeId,
      departmentId,
      status,
      isPaid,
      search,
      page = 1,
      pageSize = 50,
    } = filters;

    const where: Prisma.PayrollWhereInput = {
      tenantId,
      ...(periodId && { periodId }),
      ...(employeeId && { employeeId }),
      ...(departmentId && {
        employee: { departmentId },
      }),
      ...(status && { status }),
      ...(isPaid !== undefined && { isPaid }),
      ...(search && {
        OR: [
          { employeeCode: { contains: search, mode: "insensitive" } },
          { employeeName: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      db.payroll.findMany({
        where,
        include: {
          period: {
            select: { id: true, name: true, year: true, month: true },
          },
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              department: { select: { id: true, name: true } },
              position: { select: { id: true, name: true } },
            },
          },
          items: {
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: [{ employeeName: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.payroll.count({ where }),
    ]);

    return {
      data: data as unknown as PayrollWithRelations[],
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
    return db.payroll.findFirst({
      where: { id, tenantId },
      include: {
        period: {
          select: {
            id: true,
            name: true,
            year: true,
            month: true,
            status: true,
          },
        },
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: { select: { id: true, name: true } },
            position: { select: { id: true, name: true } },
          },
        },
        items: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  },

  /**
   * Find by period and employee
   */
  async findByPeriodEmployee(
    tenantId: string,
    periodId: string,
    employeeId: string,
  ) {
    return db.payroll.findFirst({
      where: { tenantId, periodId, employeeId },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
      },
    });
  },

  /**
   * Get payrolls for period
   */
  async getByPeriod(tenantId: string, periodId: string) {
    return db.payroll.findMany({
      where: { tenantId, periodId },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: { select: { id: true, name: true } },
          },
        },
        items: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: { employeeName: "asc" },
    });
  },

  /**
   * Get payslip for employee
   */
  async getPayslip(tenantId: string, periodId: string, employeeId: string) {
    const payroll = await db.payroll.findFirst({
      where: { tenantId, periodId, employeeId },
      include: {
        period: true,
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: { select: { id: true, name: true } },
            position: { select: { id: true, name: true } },
            bankAccount: true,
            bankName: true,
          },
        },
        items: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!payroll) {
      throw new Error("Không tìm thấy phiếu lương");
    }

    // Group items by type
    const earnings = payroll.items.filter((i) => i.itemType === "EARNING");
    const deductions = payroll.items.filter((i) => i.itemType === "DEDUCTION");
    const employerCosts = payroll.items.filter(
      (i) => i.itemType === "EMPLOYER_COST",
    );

    return {
      ...payroll,
      earnings,
      deductions,
      employerCosts,
    };
  },

  /**
   * Create payroll record
   */
  async create(
    tenantId: string,
    data: Omit<Prisma.PayrollCreateInput, "tenant" | "period" | "employee"> & {
      periodId: string;
      employeeId: string;
    },
  ) {
    const { periodId, employeeId, ...rest } = data;

    // Check for existing
    const existing = await this.findByPeriodEmployee(
      tenantId,
      periodId,
      employeeId,
    );
    if (existing) {
      throw new Error("Đã có bảng lương cho nhân viên này trong kỳ lương");
    }

    return db.payroll.create({
      data: {
        ...rest,
        tenant: { connect: { id: tenantId } },
        period: { connect: { id: periodId } },
        employee: { connect: { id: employeeId } },
      },
    });
  },

  /**
   * Update payroll
   */
  async update(tenantId: string, id: string, data: Prisma.PayrollUpdateInput) {
    const payroll = await db.payroll.findFirst({
      where: { id, tenantId },
      include: { period: true },
    });

    if (!payroll) {
      throw new Error("Bảng lương không tồn tại");
    }

    if (payroll.period.isLocked) {
      throw new Error("Kỳ lương đã khóa, không thể chỉnh sửa");
    }

    return db.payroll.update({
      where: { id },
      data,
    });
  },

  /**
   * Delete payroll
   */
  async delete(tenantId: string, id: string) {
    const payroll = await db.payroll.findFirst({
      where: { id, tenantId },
      include: { period: true },
    });

    if (!payroll) {
      throw new Error("Bảng lương không tồn tại");
    }

    if (payroll.period.isLocked) {
      throw new Error("Kỳ lương đã khóa, không thể xóa");
    }

    // Delete items first (cascade should handle this, but being explicit)
    await db.payrollItem.deleteMany({
      where: { payrollId: id },
    });

    return db.payroll.delete({
      where: { id },
    });
  },

  /**
   * Delete all payrolls in a period
   */
  async deleteByPeriod(tenantId: string, periodId: string) {
    const period = await db.payrollPeriod.findFirst({
      where: { id: periodId, tenantId },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    if (period.isLocked) {
      throw new Error("Kỳ lương đã khóa, không thể xóa dữ liệu");
    }

    // Delete all items first
    await db.payrollItem.deleteMany({
      where: { payroll: { periodId } },
    });

    // Delete all payrolls
    return db.payroll.deleteMany({
      where: { tenantId, periodId },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Status Management
  // ═══════════════════════════════════════════════════════════════

  /**
   * Mark as paid
   */
  async markAsPaid(tenantId: string, id: string) {
    return db.payroll.update({
      where: { id },
      data: {
        isPaid: true,
        paidAt: new Date(),
        status: "PAID",
      },
    });
  },

  /**
   * Bulk mark as paid
   */
  async bulkMarkAsPaid(tenantId: string, ids: string[]) {
    return db.payroll.updateMany({
      where: {
        id: { in: ids },
        tenantId,
      },
      data: {
        isPaid: true,
        paidAt: new Date(),
        status: "PAID",
      },
    });
  },

  /**
   * Mark period payrolls as paid
   */
  async markPeriodAsPaid(tenantId: string, periodId: string) {
    return db.payroll.updateMany({
      where: { tenantId, periodId },
      data: {
        isPaid: true,
        paidAt: new Date(),
        status: "PAID",
      },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Statistics
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get period statistics
   */
  async getPeriodStats(tenantId: string, periodId: string) {
    const payrolls = await db.payroll.findMany({
      where: { tenantId, periodId },
    });

    return {
      totalEmployees: payrolls.length,
      totalGross: payrolls.reduce((sum, p) => sum + Number(p.grossSalary), 0),
      totalNet: payrolls.reduce((sum, p) => sum + Number(p.netSalary), 0),
      totalDeductions: payrolls.reduce(
        (sum, p) => sum + Number(p.totalDeductions),
        0,
      ),
      totalInsurance: payrolls.reduce(
        (sum, p) => sum + Number(p.totalInsuranceEmployee),
        0,
      ),
      totalPIT: payrolls.reduce((sum, p) => sum + Number(p.pit), 0),
      totalEmployerCost: payrolls.reduce(
        (sum, p) => sum + Number(p.totalEmployerCost),
        0,
      ),
      paidCount: payrolls.filter((p) => p.isPaid).length,
      unpaidCount: payrolls.filter((p) => !p.isPaid).length,
    };
  },

  /**
   * Get employee payroll history
   */
  async getEmployeeHistory(
    tenantId: string,
    employeeId: string,
    limit: number = 12,
  ) {
    return db.payroll.findMany({
      where: { tenantId, employeeId },
      include: {
        period: {
          select: { id: true, name: true, year: true, month: true },
        },
      },
      orderBy: [{ period: { year: "desc" } }, { period: { month: "desc" } }],
      take: limit,
    });
  },
};
