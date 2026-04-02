// src/services/salary-component.service.ts
// Salary Component Service

import { db } from "@/lib/db";
import type {
  Prisma,
  PayrollComponentCategory,
  PayrollItemType,
} from ".prisma/hrm-ai-client";
import type { PaginatedResponse } from "@/types";
import { DEFAULT_SALARY_COMPONENTS } from "@/lib/payroll/constants";

export interface SalaryComponentFilters {
  search?: string;
  category?: PayrollComponentCategory;
  itemType?: PayrollItemType;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export const salaryComponentService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Find all salary components with filters
   */
  async findAll(
    tenantId: string,
    filters: SalaryComponentFilters = {},
  ): Promise<PaginatedResponse<Prisma.SalaryComponentGetPayload<object>>> {
    const {
      search,
      category,
      itemType,
      isActive,
      page = 1,
      pageSize = 50,
    } = filters;

    const where: Prisma.SalaryComponentWhereInput = {
      tenantId,
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
        ],
      }),
      ...(category && { category }),
      ...(itemType && { itemType }),
      ...(isActive !== undefined && { isActive }),
    };

    const [data, total] = await Promise.all([
      db.salaryComponent.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.salaryComponent.count({ where }),
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
   * Find by ID
   */
  async findById(tenantId: string, id: string) {
    return db.salaryComponent.findFirst({
      where: { id, tenantId },
    });
  },

  /**
   * Find by code
   */
  async findByCode(tenantId: string, code: string) {
    return db.salaryComponent.findFirst({
      where: { tenantId, code },
    });
  },

  /**
   * Get all active components
   */
  async getActiveComponents(tenantId: string) {
    return db.salaryComponent.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  },

  /**
   * Get components by type
   */
  async getByType(tenantId: string, itemType: PayrollItemType) {
    return db.salaryComponent.findMany({
      where: { tenantId, itemType, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  },

  /**
   * Get components by category
   */
  async getByCategory(tenantId: string, category: PayrollComponentCategory) {
    return db.salaryComponent.findMany({
      where: { tenantId, category, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  },

  /**
   * Create new component
   */
  async create(
    tenantId: string,
    data: Omit<Prisma.SalaryComponentCreateInput, "tenant">,
  ) {
    // Check for duplicate code
    const existing = await this.findByCode(tenantId, data.code as string);
    if (existing) {
      throw new Error(`Mã thành phần lương "${data.code}" đã tồn tại`);
    }

    return db.salaryComponent.create({
      data: {
        ...data,
        tenant: { connect: { id: tenantId } },
      },
    });
  },

  /**
   * Update component
   */
  async update(
    tenantId: string,
    id: string,
    data: Omit<Prisma.SalaryComponentUpdateInput, "tenant">,
  ) {
    const component = await db.salaryComponent.findFirst({
      where: { id, tenantId },
    });

    if (!component) {
      throw new Error("Thành phần lương không tồn tại");
    }

    if (component.isSystem) {
      // Only allow updating certain fields for system components
      const allowedFields = [
        "isActive",
        "defaultAmount",
        "description",
        "sortOrder",
      ];
      const updateData: Prisma.SalaryComponentUpdateInput = {};
      for (const field of allowedFields) {
        if (field in data) {
          (updateData as Record<string, unknown>)[field] = (
            data as Record<string, unknown>
          )[field];
        }
      }
      return db.salaryComponent.update({
        where: { id },
        data: updateData,
      });
    }

    // Check for duplicate code if code is being changed
    if (data.code && data.code !== component.code) {
      const existing = await this.findByCode(tenantId, data.code as string);
      if (existing) {
        throw new Error(`Mã thành phần lương "${data.code}" đã tồn tại`);
      }
    }

    return db.salaryComponent.update({
      where: { id },
      data,
    });
  },

  /**
   * Delete component
   */
  async delete(tenantId: string, id: string) {
    const component = await db.salaryComponent.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: { payrollItems: true },
        },
      },
    });

    if (!component) {
      throw new Error("Thành phần lương không tồn tại");
    }

    if (component.isSystem) {
      throw new Error("Không thể xóa thành phần lương hệ thống");
    }

    if (component._count.payrollItems > 0) {
      throw new Error(
        "Không thể xóa thành phần lương đã được sử dụng trong bảng lương",
      );
    }

    return db.salaryComponent.delete({
      where: { id },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Seed Default Components
  // ═══════════════════════════════════════════════════════════════

  /**
   * Seed default salary components for tenant
   */
  async seedDefaultComponents(tenantId: string) {
    const existing = await db.salaryComponent.count({
      where: { tenantId },
    });

    if (existing > 0) {
      return { created: 0, message: "Đã có thành phần lương" };
    }

    const components = DEFAULT_SALARY_COMPONENTS.map((comp) => ({
      tenantId,
      code: comp.code,
      name: comp.name,
      category: comp.category as PayrollComponentCategory,
      itemType: comp.itemType as PayrollItemType,
      isTaxable: comp.isTaxable,
      isInsuranceable: comp.isInsuranceable,
      isSystem: comp.isSystem,
      sortOrder: comp.sortOrder,
      isActive: true,
    }));

    await db.salaryComponent.createMany({
      data: components,
    });

    return {
      created: components.length,
      message: `Đã tạo ${components.length} thành phần lương`,
    };
  },

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get earnings components
   */
  async getEarnings(tenantId: string) {
    return this.getByType(tenantId, "EARNING");
  },

  /**
   * Get deduction components
   */
  async getDeductions(tenantId: string) {
    return this.getByType(tenantId, "DEDUCTION");
  },

  /**
   * Get employer cost components
   */
  async getEmployerCosts(tenantId: string) {
    return this.getByType(tenantId, "EMPLOYER_COST");
  },
};
