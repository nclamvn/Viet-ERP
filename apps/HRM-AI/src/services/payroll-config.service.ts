// src/services/payroll-config.service.ts
// Payroll Configuration Service

import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-ai-client";
import {
  PIT_BRACKETS,
  PIT_DEDUCTIONS,
  INSURANCE_RATES,
  INSURANCE_SALARY_CAP,
  OT_RATES,
  WORK_SETTINGS,
} from "@/lib/payroll/constants";

export const payrollConfigService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get current active config for tenant
   */
  async getCurrentConfig(tenantId: string) {
    const now = new Date();

    const config = await db.payrollConfig.findFirst({
      where: {
        tenantId,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });

    // If no config exists, return default values
    if (!config) {
      return this.getDefaultConfig();
    }

    return config;
  },

  /**
   * Get all configs for tenant
   */
  async findAll(tenantId: string) {
    return db.payrollConfig.findMany({
      where: { tenantId },
      orderBy: { effectiveFrom: "desc" },
    });
  },

  /**
   * Get config by ID
   */
  async findById(tenantId: string, id: string) {
    return db.payrollConfig.findFirst({
      where: { id, tenantId },
    });
  },

  /**
   * Create new config
   */
  async create(
    tenantId: string,
    data: Omit<Prisma.PayrollConfigCreateInput, "tenant">,
  ) {
    // Deactivate overlapping configs
    if (data.isActive) {
      await this.deactivateOverlapping(
        tenantId,
        data.effectiveFrom as Date,
        data.effectiveTo as Date | null,
      );
    }

    return db.payrollConfig.create({
      data: {
        ...data,
        tenant: { connect: { id: tenantId } },
      },
    });
  },

  /**
   * Update config
   */
  async update(
    tenantId: string,
    id: string,
    data: Omit<Prisma.PayrollConfigUpdateInput, "tenant">,
  ) {
    const config = await db.payrollConfig.findFirst({
      where: { id, tenantId },
    });

    if (!config) {
      throw new Error("Cấu hình không tồn tại");
    }

    return db.payrollConfig.update({
      where: { id },
      data,
    });
  },

  /**
   * Delete config
   */
  async delete(tenantId: string, id: string) {
    const config = await db.payrollConfig.findFirst({
      where: { id, tenantId },
    });

    if (!config) {
      throw new Error("Cấu hình không tồn tại");
    }

    return db.payrollConfig.delete({
      where: { id },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Helper Methods
  // ═══════════════════════════════════════════════════════════════

  /**
   * Deactivate overlapping configs when creating new active config
   */
  async deactivateOverlapping(
    tenantId: string,
    effectiveFrom: Date,
    effectiveTo: Date | null,
  ) {
    const where: Prisma.PayrollConfigWhereInput = {
      tenantId,
      isActive: true,
      OR: [
        // Config that starts during new config period
        {
          effectiveFrom: { gte: effectiveFrom },
          ...(effectiveTo && { effectiveFrom: { lte: effectiveTo } }),
        },
        // Config that ends during new config period
        {
          effectiveTo: { gte: effectiveFrom },
          ...(effectiveTo && { effectiveTo: { lte: effectiveTo } }),
        },
        // Config that spans the entire new config period
        {
          effectiveFrom: { lte: effectiveFrom },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: effectiveTo || effectiveFrom } },
          ],
        },
      ],
    };

    await db.payrollConfig.updateMany({
      where,
      data: { isActive: false },
    });
  },

  /**
   * Get default config values
   */
  getDefaultConfig() {
    return {
      // Insurance rates
      bhxhEmployeeRate: INSURANCE_RATES.BHXH.EMPLOYEE,
      bhxhEmployerRate: INSURANCE_RATES.BHXH.EMPLOYER,
      bhytEmployeeRate: INSURANCE_RATES.BHYT.EMPLOYEE,
      bhytEmployerRate: INSURANCE_RATES.BHYT.EMPLOYER,
      bhtnEmployeeRate: INSURANCE_RATES.BHTN.EMPLOYEE,
      bhtnEmployerRate: INSURANCE_RATES.BHTN.EMPLOYER,
      insuranceSalaryCap: INSURANCE_SALARY_CAP,

      // PIT deductions
      personalDeduction: PIT_DEDUCTIONS.PERSONAL,
      dependentDeduction: PIT_DEDUCTIONS.DEPENDENT,
      pitBrackets: PIT_BRACKETS,

      // OT rates
      otWeekdayRate: OT_RATES.WEEKDAY,
      otWeekendRate: OT_RATES.WEEKEND,
      otHolidayRate: OT_RATES.HOLIDAY,
      otNightBonus: OT_RATES.NIGHT_BONUS,

      // Work settings
      standardWorkDays: WORK_SETTINGS.STANDARD_WORK_DAYS,
      standardWorkHours: WORK_SETTINGS.STANDARD_WORK_HOURS,

      isActive: true,
    };
  },

  /**
   * Create default config for tenant
   */
  async createDefaultConfig(tenantId: string) {
    const defaults = this.getDefaultConfig();

    return this.create(tenantId, {
      effectiveFrom: new Date("2024-01-01"),
      effectiveTo: null,
      bhxhEmployeeRate: defaults.bhxhEmployeeRate,
      bhxhEmployerRate: defaults.bhxhEmployerRate,
      bhytEmployeeRate: defaults.bhytEmployeeRate,
      bhytEmployerRate: defaults.bhytEmployerRate,
      bhtnEmployeeRate: defaults.bhtnEmployeeRate,
      bhtnEmployerRate: defaults.bhtnEmployerRate,
      insuranceSalaryCap: defaults.insuranceSalaryCap,
      personalDeduction: defaults.personalDeduction,
      dependentDeduction: defaults.dependentDeduction,
      pitBrackets: defaults.pitBrackets as Prisma.InputJsonValue,
      otWeekdayRate: defaults.otWeekdayRate,
      otWeekendRate: defaults.otWeekendRate,
      otHolidayRate: defaults.otHolidayRate,
      otNightBonus: defaults.otNightBonus,
      standardWorkDays: defaults.standardWorkDays,
      standardWorkHours: defaults.standardWorkHours,
      isActive: true,
      notes: "Cấu hình mặc định theo quy định VN 2024-2026",
    });
  },

  /**
   * Get config for specific date
   */
  async getConfigForDate(tenantId: string, date: Date) {
    const config = await db.payrollConfig.findFirst({
      where: {
        tenantId,
        isActive: true,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });

    if (!config) {
      return this.getDefaultConfig();
    }

    return config;
  },
};
