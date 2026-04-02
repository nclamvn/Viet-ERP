// src/services/payroll-calculation.service.ts
// Payroll Calculation Service - Orchestrates payroll calculation

import { db } from "@/lib/db";
import type {
  Prisma,
  PayrollComponentCategory,
  PayrollItemType,
  BankCode,
} from ".prisma/hrm-ai-client";
import {
  calculatePayroll,
  calculatePayrollBatch,
  type PayrollInput,
  type PayrollResult,
  type PayrollTotals,
} from "@/lib/payroll";
import { payrollConfigService } from "./payroll-config.service";
import { payrollPeriodService } from "./payroll-period.service";

export interface CalculationOptions {
  employeeIds?: string[]; // If not provided, calculate for all active employees
  recalculate?: boolean; // If true, delete existing and recalculate
}

export interface CalculationResult {
  periodId: string;
  success: boolean;
  calculated: number;
  failed: number;
  errors: Array<{ employeeId: string; error: string }>;
  totals: PayrollTotals;
}

export const payrollCalculationService = {
  // ═══════════════════════════════════════════════════════════════
  // Main Calculation
  // ═══════════════════════════════════════════════════════════════

  /**
   * Calculate payroll for a period
   */
  async calculatePeriod(
    tenantId: string,
    periodId: string,
    options: CalculationOptions = {},
  ): Promise<CalculationResult> {
    const { employeeIds, recalculate = false } = options;

    // Get period
    const period = await db.payrollPeriod.findFirst({
      where: { id: periodId, tenantId },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    if (period.isLocked) {
      throw new Error("Kỳ lương đã khóa, không thể tính toán");
    }

    // Update status to CALCULATING
    await payrollPeriodService.updateStatus(tenantId, periodId, "CALCULATING");

    try {
      // Get config for period
      const config = await payrollConfigService.getConfigForDate(
        tenantId,
        period.periodStart,
      );

      // Delete existing payrolls if recalculate (within transaction for safety)
      if (recalculate) {
        await db.$transaction(async (tx) => {
          await tx.payrollItem.deleteMany({
            where: { payroll: { periodId } },
          });
          await tx.payroll.deleteMany({
            where: { tenantId, periodId },
          });
        });
      }

      // Get employees to calculate
      const employees = await this.getEmployeesForCalculation(
        tenantId,
        period.year,
        period.month,
        employeeIds,
      );

      // Prepare inputs
      const inputs: PayrollInput[] = [];
      const errors: Array<{ employeeId: string; error: string }> = [];

      for (const emp of employees) {
        try {
          const input = await this.prepareEmployeeInput(
            tenantId,
            emp,
            period.year,
            period.month,
            config,
          );
          inputs.push(input);
        } catch (error) {
          errors.push({
            employeeId: emp.id,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Calculate batch
      const { results, totals } = calculatePayrollBatch(inputs);

      // Save results
      for (const result of results) {
        await this.savePayrollResult(tenantId, periodId, result);
      }

      // Update period totals and status
      await payrollPeriodService.updateTotals(periodId, {
        totalEmployees: results.length,
        totalGross: totals.totalGross,
        totalDeductions: totals.totalDeductions,
        totalNet: totals.totalNet,
        totalEmployerCost: totals.totalInsuranceEmployer,
      });

      await payrollPeriodService.updateStatus(tenantId, periodId, "SIMULATED");

      return {
        periodId,
        success: true,
        calculated: results.length,
        failed: errors.length,
        errors,
        totals,
      };
    } catch (error) {
      // Reset status on error
      await payrollPeriodService.updateStatus(tenantId, periodId, "DRAFT");
      throw error;
    }
  },

  /**
   * Calculate for single employee
   */
  async calculateEmployee(
    tenantId: string,
    periodId: string,
    employeeId: string,
  ): Promise<PayrollResult> {
    const period = await db.payrollPeriod.findFirst({
      where: { id: periodId, tenantId },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    const config = await payrollConfigService.getConfigForDate(
      tenantId,
      period.periodStart,
    );

    const employee = await db.employee.findFirst({
      where: { id: employeeId, tenantId },
      include: {
        department: { select: { name: true } },
        position: { select: { name: true } },
        contracts: {
          where: { status: "ACTIVE" },
          orderBy: { startDate: "desc" },
          take: 1,
        },
        dependents: {
          where: {
            isActive: true,
            taxDeductionFrom: { lte: period.periodEnd },
            OR: [
              { taxDeductionTo: null },
              { taxDeductionTo: { gte: period.periodStart } },
            ],
          },
        },
      },
    });

    if (!employee) {
      throw new Error("Nhân viên không tồn tại");
    }

    const input = await this.prepareEmployeeInput(
      tenantId,
      employee,
      period.year,
      period.month,
      config,
    );

    const result = calculatePayroll(input);

    // Delete existing and save new (within transaction for atomicity)
    await db.$transaction(async (tx) => {
      await tx.payrollItem.deleteMany({
        where: { payroll: { periodId, employeeId } },
      });
      await tx.payroll.deleteMany({
        where: { tenantId, periodId, employeeId },
      });
    });

    await this.savePayrollResult(tenantId, periodId, result);

    return result;
  },

  // ═══════════════════════════════════════════════════════════════
  // Simulation (Preview)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Simulate calculation without saving
   */
  async simulateCalculation(
    tenantId: string,
    year: number,
    month: number,
    employeeIds?: string[],
  ): Promise<{ results: PayrollResult[]; totals: PayrollTotals }> {
    const periodDate = new Date(year, month - 1, 1);
    const config = await payrollConfigService.getConfigForDate(
      tenantId,
      periodDate,
    );

    const employees = await this.getEmployeesForCalculation(
      tenantId,
      year,
      month,
      employeeIds,
    );

    const inputs: PayrollInput[] = [];

    for (const emp of employees) {
      try {
        const input = await this.prepareEmployeeInput(
          tenantId,
          emp,
          year,
          month,
          config,
        );
        inputs.push(input);
      } catch {
        // Skip employees with errors in simulation
        continue;
      }
    }

    return calculatePayrollBatch(inputs);
  },

  // ═══════════════════════════════════════════════════════════════
  // Helper Methods
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get employees eligible for payroll calculation
   */
  async getEmployeesForCalculation(
    tenantId: string,
    year: number,
    month: number,
    employeeIds?: string[],
  ) {
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0);

    const where: Prisma.EmployeeWhereInput = {
      tenantId,
      status: { in: ["ACTIVE", "PROBATION"] },
      hireDate: { lte: periodEnd },
      OR: [
        { resignationDate: null },
        { resignationDate: { gte: periodStart } },
      ],
      ...(employeeIds &&
        employeeIds.length > 0 && {
          id: { in: employeeIds },
        }),
    };

    return db.employee.findMany({
      where,
      include: {
        department: { select: { name: true } },
        position: { select: { name: true } },
        contracts: {
          where: { status: "ACTIVE" },
          orderBy: { startDate: "desc" },
          take: 1,
        },
        dependents: {
          where: {
            isActive: true,
            taxDeductionFrom: { lte: periodEnd },
            OR: [
              { taxDeductionTo: null },
              { taxDeductionTo: { gte: periodStart } },
            ],
          },
        },
      },
      orderBy: { employeeCode: "asc" },
    });
  },

  /**
   * Prepare input for single employee
   */
  async prepareEmployeeInput(
    tenantId: string,
    employee: Prisma.EmployeeGetPayload<{
      include: {
        department: { select: { name: true } };
        position: { select: { name: true } };
        contracts: true;
        dependents: true;
      };
    }>,
    year: number,
    month: number,
    config: Awaited<ReturnType<typeof payrollConfigService.getConfigForDate>>,
  ): Promise<PayrollInput> {
    // Get active contract
    const contract = employee.contracts[0];
    if (!contract) {
      throw new Error(
        `Nhân viên ${employee.employeeCode} không có hợp đồng hiệu lực`,
      );
    }

    // Get attendance summary
    const attendanceSummary = await db.attendanceSummary.findFirst({
      where: {
        tenantId,
        employeeId: employee.id,
        year,
        month,
      },
    });

    // Get approved OT for the month
    const otRequests = await db.overtimeRequest.findMany({
      where: {
        tenantId,
        employeeId: employee.id,
        status: "APPROVED",
        date: {
          gte: new Date(year, month - 1, 1),
          lte: new Date(year, month, 0),
        },
      },
    });

    // Calculate OT hours by type
    let otHoursWeekday = 0;
    let otHoursWeekend = 0;
    let otHoursHoliday = 0;
    let otHoursNight = 0;

    for (const ot of otRequests) {
      const hours = Number(ot.actualHours || ot.plannedHours);
      switch (ot.dayType) {
        case "NORMAL":
          otHoursWeekday += hours;
          break;
        case "WEEKEND":
          otHoursWeekend += hours;
          break;
        case "HOLIDAY":
          otHoursHoliday += hours;
          break;
      }
      if (ot.isNightShift) {
        otHoursNight += hours;
      }
    }

    // Get adjustments for the month
    const adjustments = await db.payrollAdjustment.findMany({
      where: {
        tenantId,
        employeeId: employee.id,
        year,
        month,
        status: "APPROVED",
      },
    });

    // Convert adjustments to allowances/deductions
    const allowances = adjustments
      .filter((a) => a.itemType === "EARNING")
      .map((a) => ({
        code: `ADJ_${a.id.substring(0, 8)}`,
        name: a.name,
        amount: Number(a.amount),
        isTaxable: a.isTaxable,
        isInsuranceable: false,
      }));

    const deductions = adjustments
      .filter((a) => a.itemType === "DEDUCTION")
      .map((a) => ({
        code: `ADJ_${a.id.substring(0, 8)}`,
        name: a.name,
        amount: Number(a.amount),
      }));

    // Add contract allowances
    const contractAllowances = contract.allowances as Array<{
      name: string;
      amount: number;
      taxable: boolean;
    }> | null;

    if (contractAllowances && Array.isArray(contractAllowances)) {
      for (const allowance of contractAllowances) {
        allowances.push({
          code: `CONTRACT_${allowance.name.replace(/\s+/g, "_").toUpperCase()}`,
          name: allowance.name,
          amount: allowance.amount,
          isTaxable: allowance.taxable ?? true,
          isInsuranceable: false,
        });
      }
    }

    const baseSalary = Number(contract.baseSalary);
    const insuranceSalary = Number(
      contract.insuranceSalary || contract.baseSalary,
    );

    // Validate salary values to prevent negative payroll calculations
    if (baseSalary < 0 || !Number.isFinite(baseSalary)) {
      throw new Error(
        `Nhân viên ${employee.employeeCode} có lương cơ bản không hợp lệ (${baseSalary})`,
      );
    }
    if (insuranceSalary < 0 || !Number.isFinite(insuranceSalary)) {
      throw new Error(
        `Nhân viên ${employee.employeeCode} có lương đóng BH không hợp lệ (${insuranceSalary})`,
      );
    }

    return {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: employee.fullName,
      departmentName: employee.department?.name,
      positionName: employee.position?.name,

      baseSalary,
      insuranceSalary,

      workDays: attendanceSummary
        ? Number(attendanceSummary.actualWorkDays)
        : Number(config.standardWorkDays || 22),
      standardDays: Number(config.standardWorkDays || 22),

      otHoursWeekday: attendanceSummary
        ? Number(attendanceSummary.otWeekdayHours)
        : otHoursWeekday,
      otHoursWeekend: attendanceSummary
        ? Number(attendanceSummary.otWeekendHours)
        : otHoursWeekend,
      otHoursHoliday: attendanceSummary
        ? Number(attendanceSummary.otHolidayHours)
        : otHoursHoliday,
      otHoursNight: attendanceSummary
        ? Number(attendanceSummary.otNightHours)
        : otHoursNight,

      dependentCount: employee.dependents.length,

      allowances,
      deductions,

      bankAccount: employee.bankAccount || undefined,
      bankName: employee.bankName || undefined,
      bankCode: undefined, // Will be detected from bank name

      config: {
        bhxhEmployeeRate: Number(config.bhxhEmployeeRate),
        bhxhEmployerRate: Number(config.bhxhEmployerRate),
        bhytEmployeeRate: Number(config.bhytEmployeeRate),
        bhytEmployerRate: Number(config.bhytEmployerRate),
        bhtnEmployeeRate: Number(config.bhtnEmployeeRate),
        bhtnEmployerRate: Number(config.bhtnEmployerRate),
        insuranceSalaryCap: Number(config.insuranceSalaryCap),
        personalDeduction: Number(config.personalDeduction),
        dependentDeduction: Number(config.dependentDeduction),
        otWeekdayRate: Number(config.otWeekdayRate),
        otWeekendRate: Number(config.otWeekendRate),
        otHolidayRate: Number(config.otHolidayRate),
        otNightBonus: Number(config.otNightBonus),
        standardWorkDays: Number(config.standardWorkDays),
        standardWorkHours: Number(config.standardWorkHours),
      },
    };
  },

  /**
   * Save payroll calculation result
   */
  async savePayrollResult(
    tenantId: string,
    periodId: string,
    result: PayrollResult,
  ) {
    // Create payroll record
    const payroll = await db.payroll.create({
      data: {
        tenantId,
        periodId,
        employeeId: result.employeeId,
        employeeCode: result.employeeCode,
        employeeName: result.employeeName,
        departmentName: result.departmentName,
        positionName: result.positionName,
        baseSalary: result.baseSalary,
        insuranceSalary: result.insuranceSalary,
        workDays: result.workDays,
        standardDays: result.standardDays,
        otHoursWeekday: result.otHoursWeekday,
        otHoursWeekend: result.otHoursWeekend,
        otHoursHoliday: result.otHoursHoliday,
        otHoursNight: result.otHoursNight,
        grossSalary: result.grossSalary,
        bhxhEmployee: result.bhxhEmployee,
        bhytEmployee: result.bhytEmployee,
        bhtnEmployee: result.bhtnEmployee,
        totalInsuranceEmployee: result.totalInsuranceEmployee,
        taxableIncome: result.taxableIncome,
        personalDeduction: result.personalDeduction,
        dependentDeduction: result.dependentDeduction,
        dependentCount: result.dependentCount,
        assessableIncome: result.assessableIncome,
        pit: result.pitAmount,
        otherDeductions: result.otherDeductions.total,
        totalDeductions: result.totalDeductions,
        netSalary: result.netSalary,
        bhxhEmployer: result.bhxhEmployer,
        bhytEmployer: result.bhytEmployer,
        bhtnEmployer: result.bhtnEmployer,
        totalEmployerCost: result.totalEmployerCost,
        bankAccount: result.bankAccount,
        bankName: result.bankName,
        bankCode: (result.bankCode as BankCode) || null,
        status: "SIMULATED",
      },
    });

    // Create payroll items
    const items = result.allItems.map((item) => ({
      payrollId: payroll.id,
      name: item.name,
      code: item.code,
      category: item.category as PayrollComponentCategory,
      itemType: item.itemType as PayrollItemType,
      amount: item.amount,
      quantity: item.quantity,
      rate: item.rate,
      multiplier: item.multiplier,
      isTaxable: item.isTaxable,
      isInsuranceable: item.isInsuranceable,
      sortOrder: item.sortOrder,
    }));

    await db.payrollItem.createMany({
      data: items,
    });

    return payroll;
  },
};
