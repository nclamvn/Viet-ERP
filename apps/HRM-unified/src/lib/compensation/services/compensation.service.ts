// @ts-nocheck - Prisma models not yet in schema (Phase 6)
// compensation-planning/services/compensation.service.ts

/**
 * LAC VIET HR - Compensation Planning Service
 * Business logic for compensation management
 */

import { PrismaClient, Prisma } from ".prisma/hrm-unified-client";
import {
  CompensationCycle,
  CompensationCycleStatus,
  CompensationAdjustment,
  AdjustmentType,
  ApprovalStatus,
  BudgetPoolAllocation,
  MeritMatrix,
  MeritMatrixCell,
  SalaryGrade,
  TotalRewardsStatement,
  CompensationAnalytics,
  CompensationBenchmark,
  CompaRatioCategory,
  CreateCompensationCycleDto,
  CreateAdjustmentDto,
  ApproveAdjustmentDto,
  AdjustmentFilters,
  BulkAdjustmentDto,
} from "../types/compensation.types";

export class CompensationService {
  constructor(private prisma: PrismaClient) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // COMPENSATION CYCLE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  async createCompensationCycle(
    data: CreateCompensationCycleDto,
    createdBy: string,
  ): Promise<CompensationCycle> {
    // Validate no active cycle for same fiscal year and type
    const existingCycle = await this.prisma.compensationCycle.findFirst({
      where: {
        fiscalYear: data.fiscalYear,
        cycleType: data.cycleType,
        status: { notIn: ["CLOSED", "DRAFT"] },
      },
    });

    if (existingCycle) {
      throw new Error(
        `An active ${data.cycleType} cycle already exists for fiscal year ${data.fiscalYear}`,
      );
    }

    // Get eligible employees
    const eligibleEmployees = await this.getEligibleEmployees(
      data.eligibilityCriteria,
    );

    const cycle = await this.prisma.compensationCycle.create({
      data: {
        name: data.name,
        description: data.description,
        fiscalYear: data.fiscalYear,
        cycleType: data.cycleType,
        startDate: data.startDate,
        endDate: data.endDate,
        effectiveDate: data.effectiveDate,
        status: CompensationCycleStatus.DRAFT,
        totalBudget: data.totalBudget,
        currency: data.currency,
        eligibilityCriteria:
          data.eligibilityCriteria as unknown as Prisma.JsonObject,
        participantCount: eligibleEmployees.length,
        eligibleEmployeeIds: eligibleEmployees.map((e) => e.id),
        planningStartDate: data.timeline.planningStartDate,
        planningEndDate: data.timeline.planningEndDate,
        managerReviewStartDate: data.timeline.managerReviewStartDate,
        managerReviewEndDate: data.timeline.managerReviewEndDate,
        approvalStartDate: data.timeline.approvalStartDate,
        approvalEndDate: data.timeline.approvalEndDate,
        createdBy,
      },
    });

    // Initialize budget pools by department
    await this.initializeBudgetPools(cycle.id, data.totalBudget);

    return cycle as unknown as CompensationCycle;
  }

  async updateCycleStatus(
    cycleId: string,
    newStatus: CompensationCycleStatus,
  ): Promise<CompensationCycle> {
    const cycle = await this.prisma.compensationCycle.findUnique({
      where: { id: cycleId },
    });

    if (!cycle) {
      throw new Error("Compensation cycle not found");
    }

    // Validate status transition
    this.validateStatusTransition(
      cycle.status as CompensationCycleStatus,
      newStatus,
    );

    const updated = await this.prisma.compensationCycle.update({
      where: { id: cycleId },
      data: { status: newStatus },
    });

    // Trigger notifications based on status change
    await this.sendStatusChangeNotifications(cycleId, newStatus);

    return updated as unknown as CompensationCycle;
  }

  private validateStatusTransition(
    current: CompensationCycleStatus,
    next: CompensationCycleStatus,
  ): void {
    const validTransitions: Record<
      CompensationCycleStatus,
      CompensationCycleStatus[]
    > = {
      [CompensationCycleStatus.DRAFT]: [CompensationCycleStatus.PLANNING],
      [CompensationCycleStatus.PLANNING]: [
        CompensationCycleStatus.REVIEW,
        CompensationCycleStatus.DRAFT,
      ],
      [CompensationCycleStatus.REVIEW]: [
        CompensationCycleStatus.APPROVAL,
        CompensationCycleStatus.PLANNING,
      ],
      [CompensationCycleStatus.APPROVAL]: [
        CompensationCycleStatus.APPROVED,
        CompensationCycleStatus.REVIEW,
      ],
      [CompensationCycleStatus.APPROVED]: [CompensationCycleStatus.IMPLEMENTED],
      [CompensationCycleStatus.IMPLEMENTED]: [CompensationCycleStatus.CLOSED],
      [CompensationCycleStatus.CLOSED]: [],
    };

    if (!validTransitions[current].includes(next)) {
      throw new Error(`Invalid status transition from ${current} to ${next}`);
    }
  }

  async getCompensationCycle(
    cycleId: string,
  ): Promise<CompensationCycle | null> {
    return this.prisma.compensationCycle.findUnique({
      where: { id: cycleId },
      include: {
        budgetPoolAllocations: true,
        meritMatrix: {
          include: { cells: true },
        },
      },
    }) as unknown as CompensationCycle;
  }

  async listCompensationCycles(
    filters: { fiscalYear?: number; status?: CompensationCycleStatus },
    page: number = 1,
    limit: number = 20,
  ) {
    const where: Prisma.CompensationCycleWhereInput = {};

    if (filters.fiscalYear) where.fiscalYear = filters.fiscalYear;
    if (filters.status) where.status = filters.status;

    const [cycles, total] = await Promise.all([
      this.prisma.compensationCycle.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.compensationCycle.count({ where }),
    ]);

    return {
      data: cycles,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // BUDGET MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  private async initializeBudgetPools(
    cycleId: string,
    totalBudget: number,
  ): Promise<void> {
    // Get departments and their headcount
    const departments = await this.prisma.department.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: { employees: { where: { status: "ACTIVE" } } },
        },
      },
    });

    const totalEmployees = departments.reduce(
      (sum, d) => sum + d._count.employees,
      0,
    );

    // Allocate budget proportionally by headcount
    const pools = departments.map((dept) => ({
      cycleId,
      departmentId: dept.id,
      allocatedBudget: Math.round(
        (dept._count.employees / totalEmployees) * totalBudget,
      ),
      usedBudget: 0,
      remainingBudget: Math.round(
        (dept._count.employees / totalEmployees) * totalBudget,
      ),
      distributionMethod: "PERFORMANCE_BASED",
      meritPoolPercentage: 70,
      promotionPoolPercentage: 15,
      adjustmentPoolPercentage: 10,
      bonusPoolPercentage: 5,
      budgetOwnerId: dept.managerId || "",
    }));

    await this.prisma.budgetPoolAllocation.createMany({ data: pools });
  }

  async updateBudgetAllocation(
    cycleId: string,
    departmentId: string,
    data: Partial<BudgetPoolAllocation>,
  ): Promise<BudgetPoolAllocation> {
    const pool = await this.prisma.budgetPoolAllocation.findFirst({
      where: { cycleId, departmentId },
    });

    if (!pool) {
      throw new Error("Budget pool not found");
    }

    return this.prisma.budgetPoolAllocation.update({
      where: { id: pool.id },
      data: {
        ...data,
        remainingBudget:
          (data.allocatedBudget || pool.allocatedBudget) - pool.usedBudget,
      },
    }) as unknown as BudgetPoolAllocation;
  }

  async getBudgetSummary(cycleId: string) {
    const pools = await this.prisma.budgetPoolAllocation.findMany({
      where: { cycleId },
      include: {
        department: true,
      },
    });

    const cycle = await this.prisma.compensationCycle.findUnique({
      where: { id: cycleId },
    });

    return {
      totalBudget: cycle?.totalBudget || 0,
      allocatedBudget: pools.reduce((sum, p) => sum + p.allocatedBudget, 0),
      usedBudget: pools.reduce((sum, p) => sum + p.usedBudget, 0),
      remainingBudget: pools.reduce((sum, p) => sum + p.remainingBudget, 0),
      byDepartment: pools.map((p) => ({
        departmentId: p.departmentId,
        departmentName: p.department?.name,
        allocated: p.allocatedBudget,
        used: p.usedBudget,
        remaining: p.remainingBudget,
        utilization:
          p.allocatedBudget > 0 ? (p.usedBudget / p.allocatedBudget) * 100 : 0,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MERIT MATRIX
  // ═══════════════════════════════════════════════════════════════════════════════

  async createMeritMatrix(
    cycleId: string,
    data: Partial<MeritMatrix>,
  ): Promise<MeritMatrix> {
    const matrix = await this.prisma.meritMatrix.create({
      data: {
        cycleId,
        name: data.name || "Merit Increase Matrix",
        description: data.description,
        performanceRatings: data.performanceRatings || [
          "1",
          "2",
          "3",
          "4",
          "5",
        ],
        compaRatioRanges: data.compaRatioRanges as unknown as Prisma.JsonArray,
        defaultIncreasePercentage: data.defaultIncreasePercentage || 3,
        maxIncreasePercentage: data.maxIncreasePercentage || 10,
        minIncreasePercentage: data.minIncreasePercentage || 0,
        isActive: true,
      },
    });

    // Generate default cells if not provided
    if (!data.cells) {
      await this.generateDefaultMatrixCells(
        matrix.id,
        data.performanceRatings || ["1", "2", "3", "4", "5"],
      );
    }

    return matrix as unknown as MeritMatrix;
  }

  private async generateDefaultMatrixCells(
    matrixId: string,
    performanceRatings: string[],
  ): Promise<void> {
    // Default merit matrix: Higher performance + lower compa-ratio = higher increase
    const compaRatioRanges = [
      { id: "below", label: "Below Range", min: 0, max: 80 },
      { id: "lower", label: "Lower Quartile", min: 80, max: 95 },
      { id: "mid", label: "Mid Range", min: 95, max: 105 },
      { id: "upper", label: "Upper Quartile", min: 105, max: 120 },
      { id: "above", label: "Above Range", min: 120, max: 999 },
    ];

    // Merit percentages: [performance rating index][compa ratio index]
    const meritTable = [
      // Perf 1 (Exceeds)
      [8, 7, 6, 4, 2],
      // Perf 2 (Meets+)
      [7, 6, 5, 3, 1],
      // Perf 3 (Meets)
      [5, 4, 3, 2, 0],
      // Perf 4 (Developing)
      [3, 2, 2, 1, 0],
      // Perf 5 (Needs Improvement)
      [0, 0, 0, 0, 0],
    ];

    const cells: Prisma.MeritMatrixCellCreateManyInput[] = [];

    performanceRatings.forEach((rating, perfIndex) => {
      compaRatioRanges.forEach((range, rangeIndex) => {
        const target = meritTable[perfIndex]?.[rangeIndex] || 0;
        cells.push({
          matrixId,
          performanceRating: rating,
          compaRatioRangeId: range.id,
          targetIncreasePercentage: target,
          minIncreasePercentage: Math.max(0, target - 1),
          maxIncreasePercentage: target + 2,
        });
      });
    });

    await this.prisma.meritMatrixCell.createMany({ data: cells });
  }

  async getRecommendedIncrease(
    matrixId: string,
    performanceRating: string,
    compaRatio: number,
  ): Promise<MeritMatrixCell | null> {
    const matrix = await this.prisma.meritMatrix.findUnique({
      where: { id: matrixId },
    });

    if (!matrix) return null;

    // Determine compa-ratio range
    const ranges = matrix.compaRatioRanges as unknown as Array<{
      id: string;
      min: number;
      max: number;
    }>;
    const range = ranges.find((r) => compaRatio >= r.min && compaRatio < r.max);

    if (!range) return null;

    return this.prisma.meritMatrixCell.findFirst({
      where: {
        matrixId,
        performanceRating,
        compaRatioRangeId: range.id,
      },
    }) as unknown as MeritMatrixCell;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // COMPENSATION ADJUSTMENTS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createAdjustment(
    data: CreateAdjustmentDto,
    proposedBy: string,
  ): Promise<CompensationAdjustment> {
    // Get employee current compensation
    const employee = await this.prisma.employee.findUnique({
      where: { id: data.employeeId },
      include: {
        currentPosition: true,
        salaryGrade: true,
        compensationHistory: {
          orderBy: { effectiveDate: "desc" },
          take: 1,
        },
      },
    });

    if (!employee) {
      throw new Error("Employee not found");
    }

    const currentSalary =
      employee.compensationHistory[0]?.baseSalary || employee.baseSalary || 0;
    const gradeRange = employee.salaryGrade;

    // Calculate compa-ratio
    const currentCompaRatio = gradeRange?.midpointSalary
      ? (currentSalary / gradeRange.midpointSalary) * 100
      : 100;

    // Calculate new salary
    let newBaseSalary = currentSalary;
    let increaseAmount = data.proposedIncreaseAmount || 0;
    let increasePercentage = data.proposedIncreasePercentage || 0;

    if (data.proposedIncreasePercentage) {
      increaseAmount = Math.round(
        currentSalary * (data.proposedIncreasePercentage / 100),
      );
      newBaseSalary = currentSalary + increaseAmount;
    } else if (data.proposedIncreaseAmount) {
      increasePercentage =
        currentSalary > 0
          ? (data.proposedIncreaseAmount / currentSalary) * 100
          : 0;
      newBaseSalary = currentSalary + data.proposedIncreaseAmount;
    }

    // Get matrix recommendation if merit increase
    let matrixRecommended: number | undefined;
    if (data.adjustmentType === AdjustmentType.MERIT_INCREASE) {
      const cycle = await this.prisma.compensationCycle.findUnique({
        where: { id: data.cycleId },
        include: { meritMatrix: true },
      });

      if (cycle?.meritMatrix) {
        const cell = await this.getRecommendedIncrease(
          cycle.meritMatrix.id,
          employee.performanceRating?.toString() || "3",
          currentCompaRatio,
        );
        matrixRecommended = cell?.targetIncreasePercentage;
      }
    }

    // Calculate new compa-ratio
    const newGrade = data.proposedSalaryGradeId
      ? await this.prisma.salaryGrade.findUnique({
          where: { id: data.proposedSalaryGradeId },
        })
      : gradeRange;

    const newCompaRatio = newGrade?.midpointSalary
      ? (newBaseSalary / newGrade.midpointSalary) * 100
      : currentCompaRatio;

    const adjustment = await this.prisma.compensationAdjustment.create({
      data: {
        cycleId: data.cycleId,
        employeeId: data.employeeId,
        currentBaseSalary: currentSalary,
        currentTotalCash: currentSalary, // Simplified
        currentCompaRatio,
        currentSalaryGradeId: employee.salaryGradeId || "",
        adjustmentType: data.adjustmentType,
        proposedBaseSalary: newBaseSalary,
        proposedIncreaseAmount: increaseAmount,
        proposedIncreasePercentage: increasePercentage,
        proposedSalaryGradeId: data.proposedSalaryGradeId,
        bonusAmount: data.bonusAmount,
        bonusType: data.bonusType,
        newBaseSalary,
        newTotalCash: newBaseSalary,
        newCompaRatio,
        totalAdjustmentCost: increaseAmount + (data.bonusAmount || 0),
        justification: data.justification,
        performanceRating: employee.performanceRating?.toString(),
        matrixRecommendedPercentage: matrixRecommended,
        matrixVariancePercentage: matrixRecommended
          ? increasePercentage - matrixRecommended
          : undefined,
        status: ApprovalStatus.PENDING,
        effectiveDate: data.effectiveDate,
        proposedBy,
        proposedAt: new Date(),
        managerId: employee.managerId || "",
      },
    });

    // Update budget usage
    await this.updateBudgetUsage(
      data.cycleId,
      employee.departmentId || "",
      adjustment.totalAdjustmentCost,
    );

    return adjustment as unknown as CompensationAdjustment;
  }

  async createBulkAdjustments(
    data: BulkAdjustmentDto,
    proposedBy: string,
  ): Promise<CompensationAdjustment[]> {
    const adjustments: CompensationAdjustment[] = [];

    for (const adj of data.adjustments) {
      const adjustment = await this.createAdjustment(adj, proposedBy);
      adjustments.push(adjustment);
    }

    return adjustments;
  }

  async approveAdjustment(
    data: ApproveAdjustmentDto,
    approverId: string,
  ): Promise<CompensationAdjustment> {
    const adjustment = await this.prisma.compensationAdjustment.findUnique({
      where: { id: data.adjustmentId },
    });

    if (!adjustment) {
      throw new Error("Adjustment not found");
    }

    let newStatus: ApprovalStatus;
    switch (data.action) {
      case "APPROVE":
        newStatus = ApprovalStatus.APPROVED;
        break;
      case "REJECT":
        newStatus = ApprovalStatus.REJECTED;
        break;
      case "REQUEST_REVISION":
        newStatus = ApprovalStatus.REVISION_REQUIRED;
        break;
      default:
        throw new Error("Invalid action");
    }

    // Create approval history entry
    const historyEntry = {
      approverId,
      approverName: "", // Would be looked up
      approverRole: "", // Would be determined
      action: data.action,
      previousStatus: adjustment.status,
      newStatus,
      comments: data.comments,
      timestamp: new Date(),
    };

    const updated = await this.prisma.compensationAdjustment.update({
      where: { id: data.adjustmentId },
      data: {
        status: newStatus,
        managerApprovalStatus: newStatus,
        managerApprovalDate: new Date(),
        managerComments: data.comments,
        approvalHistory: {
          push: historyEntry,
        },
        // Apply modifications if approved with changes
        ...(data.modifiedAmount && {
          proposedIncreaseAmount: data.modifiedAmount,
          newBaseSalary: adjustment.currentBaseSalary + data.modifiedAmount,
          totalAdjustmentCost:
            data.modifiedAmount + (adjustment.bonusAmount || 0),
        }),
        ...(data.modifiedPercentage && {
          proposedIncreasePercentage: data.modifiedPercentage,
        }),
      },
    });

    // If approved, update budget
    if (newStatus === ApprovalStatus.APPROVED) {
      await this.finalizeAdjustment(updated.id);
    }

    return updated as unknown as CompensationAdjustment;
  }

  async bulkApproveAdjustments(
    adjustmentIds: string[],
    approverId: string,
    comments?: string,
  ): Promise<number> {
    let approvedCount = 0;

    for (const id of adjustmentIds) {
      await this.approveAdjustment(
        {
          adjustmentId: id,
          action: "APPROVE",
          comments,
        },
        approverId,
      );
      approvedCount++;
    }

    return approvedCount;
  }

  private async finalizeAdjustment(adjustmentId: string): Promise<void> {
    const adjustment = await this.prisma.compensationAdjustment.findUnique({
      where: { id: adjustmentId },
    });

    if (!adjustment) return;

    // Create compensation history record
    await this.prisma.compensationHistory.create({
      data: {
        employeeId: adjustment.employeeId,
        baseSalary: adjustment.newBaseSalary,
        effectiveDate: adjustment.effectiveDate,
        adjustmentType: adjustment.adjustmentType,
        adjustmentAmount: adjustment.proposedIncreaseAmount || 0,
        adjustmentPercentage: adjustment.proposedIncreasePercentage || 0,
        reason: adjustment.justification,
        approvedBy: "", // Would be the approver
        compensationAdjustmentId: adjustmentId,
      },
    });

    // Update employee's current salary (when effective)
    if (adjustment.effectiveDate <= new Date()) {
      await this.prisma.employee.update({
        where: { id: adjustment.employeeId },
        data: {
          baseSalary: adjustment.newBaseSalary,
          salaryGradeId: adjustment.proposedSalaryGradeId || undefined,
        },
      });
    }
  }

  async listAdjustments(
    filters: AdjustmentFilters,
    page: number = 1,
    limit: number = 50,
  ) {
    const where: Prisma.CompensationAdjustmentWhereInput = {
      cycleId: filters.cycleId,
    };

    if (filters.status) where.status = filters.status;
    if (filters.adjustmentType) where.adjustmentType = filters.adjustmentType;
    if (filters.managerId) where.managerId = filters.managerId;

    if (filters.departmentId) {
      where.employee = { departmentId: filters.departmentId };
    }

    if (filters.employeeSearch) {
      where.employee = {
        ...where.employee,
        OR: [
          {
            firstName: {
              contains: filters.employeeSearch,
              mode: "insensitive",
            },
          },
          {
            lastName: { contains: filters.employeeSearch, mode: "insensitive" },
          },
          {
            employeeCode: {
              contains: filters.employeeSearch,
              mode: "insensitive",
            },
          },
        ],
      };
    }

    const [adjustments, total] = await Promise.all([
      this.prisma.compensationAdjustment.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              departmentId: true,
              department: { select: { name: true } },
              currentPosition: { select: { title: true } },
            },
          },
        },
        orderBy: { proposedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.compensationAdjustment.count({ where }),
    ]);

    return {
      data: adjustments,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SALARY STRUCTURE
  // ═══════════════════════════════════════════════════════════════════════════════

  async createSalaryGrade(data: Partial<SalaryGrade>): Promise<SalaryGrade> {
    const rangeSpread = data.minimumSalary
      ? ((data.maximumSalary! - data.minimumSalary) / data.minimumSalary) * 100
      : 0;

    return this.prisma.salaryGrade.create({
      data: {
        code: data.code!,
        name: data.name!,
        level: data.level!,
        description: data.description,
        minimumSalary: data.minimumSalary!,
        midpointSalary: data.midpointSalary!,
        maximumSalary: data.maximumSalary!,
        currency: data.currency || "VND",
        rangeSpread,
        rangePenetration: 0,
        jobFamilyIds: data.jobFamilyIds || [],
        effectiveDate: data.effectiveDate || new Date(),
        isActive: true,
      },
    }) as unknown as SalaryGrade;
  }

  async updateSalaryGrade(
    gradeId: string,
    data: Partial<SalaryGrade>,
  ): Promise<SalaryGrade> {
    return this.prisma.salaryGrade.update({
      where: { id: gradeId },
      data: {
        ...data,
        rangeSpread:
          data.minimumSalary && data.maximumSalary
            ? ((data.maximumSalary - data.minimumSalary) / data.minimumSalary) *
              100
            : undefined,
      },
    }) as unknown as SalaryGrade;
  }

  async listSalaryGrades(
    includeInactive: boolean = false,
  ): Promise<SalaryGrade[]> {
    return this.prisma.salaryGrade.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { level: "asc" },
    }) as unknown as SalaryGrade[];
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TOTAL REWARDS
  // ═══════════════════════════════════════════════════════════════════════════════

  async generateTotalRewardsStatement(
    employeeId: string,
    year: number,
  ): Promise<TotalRewardsStatement> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        compensationHistory: {
          where: {
            effectiveDate: {
              gte: new Date(year, 0, 1),
              lte: new Date(year, 11, 31),
            },
          },
        },
        benefits: true,
      },
    });

    if (!employee) {
      throw new Error("Employee not found");
    }

    // Calculate various components
    const baseSalary = employee.baseSalary || 0;
    const targetBonus = baseSalary * 0.1; // Example: 10% target bonus
    const actualBonus = 0; // Would be calculated from bonus records

    // Benefits valuation (simplified)
    const healthInsuranceValue = 12000000; // 12M VND/year example
    const retirementContribution = baseSalary * 0.08; // 8% company contribution
    const ptoValue = (baseSalary / 12 / 22) * 15; // 15 days PTO value

    const totalCash = baseSalary + actualBonus;
    const totalDirect = totalCash;
    const totalBenefits =
      healthInsuranceValue + retirementContribution + ptoValue;
    const totalRewards = totalDirect + totalBenefits;

    const statement = await this.prisma.totalRewardsStatement.create({
      data: {
        employeeId,
        statementYear: year,
        baseSalary,
        targetBonus,
        actualBonus,
        stockValue: 0,
        unvestedStockValue: 0,
        stockOptionsValue: 0,
        healthInsuranceValue,
        lifeInsuranceValue: 0,
        retirementContribution,
        ptoValue,
        otherBenefitsValue: 0,
        perksValue: 0,
        totalCashCompensation: totalCash,
        totalDirectCompensation: totalDirect,
        totalRewardsValue: totalRewards,
        compensationBreakdown: [
          {
            category: "Base Compensation",
            label: "Base Salary",
            value: baseSalary,
            percentage: (baseSalary / totalRewards) * 100,
          },
          {
            category: "Variable Pay",
            label: "Bonus",
            value: actualBonus,
            percentage: (actualBonus / totalRewards) * 100,
          },
          {
            category: "Benefits",
            label: "Health Insurance",
            value: healthInsuranceValue,
            percentage: (healthInsuranceValue / totalRewards) * 100,
          },
          {
            category: "Benefits",
            label: "Retirement",
            value: retirementContribution,
            percentage: (retirementContribution / totalRewards) * 100,
          },
          {
            category: "Benefits",
            label: "PTO Value",
            value: ptoValue,
            percentage: (ptoValue / totalRewards) * 100,
          },
        ] as unknown as Prisma.JsonArray,
      },
    });

    return statement as unknown as TotalRewardsStatement;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════════

  async getCompensationAnalytics(
    cycleId?: string,
  ): Promise<CompensationAnalytics> {
    const where = cycleId ? { cycleId } : {};

    // Get adjustments
    const adjustments = await this.prisma.compensationAdjustment.findMany({
      where,
      include: {
        employee: {
          include: {
            department: true,
            salaryGrade: true,
          },
        },
      },
    });

    // Budget summary
    let budgetSummary = {
      totalBudget: 0,
      allocatedBudget: 0,
      usedBudget: 0,
      remainingBudget: 0,
      utilizationPercentage: 0,
    };

    if (cycleId) {
      const summary = await this.getBudgetSummary(cycleId);
      budgetSummary = {
        totalBudget: summary.totalBudget,
        allocatedBudget: summary.allocatedBudget,
        usedBudget: summary.usedBudget,
        remainingBudget: summary.remainingBudget,
        utilizationPercentage:
          summary.allocatedBudget > 0
            ? (summary.usedBudget / summary.allocatedBudget) * 100
            : 0,
      };
    }

    // Adjustment summary
    const approvedAdjustments = adjustments.filter(
      (a) => a.status === "APPROVED",
    );
    const totalIncrease = approvedAdjustments.reduce(
      (sum, a) => sum + (a.proposedIncreaseAmount || 0),
      0,
    );
    const percentages = approvedAdjustments
      .map((a) => a.proposedIncreasePercentage || 0)
      .sort((a, b) => a - b);

    const adjustmentSummary = {
      totalEmployees: adjustments.length,
      employeesWithAdjustments: approvedAdjustments.length,
      averageIncreasePercentage:
        approvedAdjustments.length > 0
          ? percentages.reduce((a, b) => a + b, 0) / percentages.length
          : 0,
      medianIncreasePercentage:
        percentages.length > 0
          ? percentages[Math.floor(percentages.length / 2)]
          : 0,
      totalIncreaseAmount: totalIncrease,
      byType: Object.values(AdjustmentType).map((type) => ({
        type,
        count: adjustments.filter((a) => a.adjustmentType === type).length,
        totalAmount: adjustments
          .filter((a) => a.adjustmentType === type)
          .reduce((sum, a) => sum + (a.proposedIncreaseAmount || 0), 0),
        averagePercentage: 0, // Would calculate
      })),
    };

    // Compa-ratio analysis
    const compaRatios = adjustments.map((a) => a.currentCompaRatio);
    const avgCompaRatio =
      compaRatios.length > 0
        ? compaRatios.reduce((a, b) => a + b, 0) / compaRatios.length
        : 0;

    const compaRatioAnalysis = {
      averageCompaRatio: avgCompaRatio,
      medianCompaRatio:
        compaRatios.sort((a, b) => a - b)[Math.floor(compaRatios.length / 2)] ||
        0,
      compaRatioDistribution: [
        {
          category: CompaRatioCategory.BELOW_RANGE,
          count: compaRatios.filter((r) => r < 80).length,
          percentage: 0,
        },
        {
          category: CompaRatioCategory.LOWER_QUARTILE,
          count: compaRatios.filter((r) => r >= 80 && r < 95).length,
          percentage: 0,
        },
        {
          category: CompaRatioCategory.MID_RANGE,
          count: compaRatios.filter((r) => r >= 95 && r <= 105).length,
          percentage: 0,
        },
        {
          category: CompaRatioCategory.UPPER_QUARTILE,
          count: compaRatios.filter((r) => r > 105 && r <= 120).length,
          percentage: 0,
        },
        {
          category: CompaRatioCategory.ABOVE_RANGE,
          count: compaRatios.filter((r) => r > 120).length,
          percentage: 0,
        },
      ].map((item) => ({
        ...item,
        percentage:
          compaRatios.length > 0 ? (item.count / compaRatios.length) * 100 : 0,
      })),
    };

    return {
      cycleId,
      asOfDate: new Date(),
      budgetSummary,
      adjustmentSummary,
      distributionAnalysis: {
        byDepartment: [],
        byGrade: [],
        byPerformance: [],
        byTenure: [],
      },
      compaRatioAnalysis,
      equityAnalysis: {
        departmentVariance: 0,
        gradeCompliance: 0,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════

  private async getEligibleEmployees(criteria: any): Promise<{ id: string }[]> {
    const where: Prisma.EmployeeWhereInput = {
      status: { in: criteria.employmentStatuses || ["ACTIVE"] },
      employmentType: { in: criteria.employmentTypes || ["FULL_TIME"] },
    };

    if (criteria.hireDateBefore) {
      where.hireDate = { lte: criteria.hireDateBefore };
    }

    if (criteria.minTenureMonths) {
      const minHireDate = new Date();
      minHireDate.setMonth(minHireDate.getMonth() - criteria.minTenureMonths);
      where.hireDate = { ...where.hireDate, lte: minHireDate };
    }

    if (criteria.excludedDepartmentIds?.length) {
      where.departmentId = { notIn: criteria.excludedDepartmentIds };
    }

    if (criteria.excludedEmployeeIds?.length) {
      where.id = { notIn: criteria.excludedEmployeeIds };
    }

    return this.prisma.employee.findMany({
      where,
      select: { id: true },
    });
  }

  private async updateBudgetUsage(
    cycleId: string,
    departmentId: string,
    amount: number,
  ): Promise<void> {
    const pool = await this.prisma.budgetPoolAllocation.findFirst({
      where: { cycleId, departmentId },
    });

    if (pool) {
      await this.prisma.budgetPoolAllocation.update({
        where: { id: pool.id },
        data: {
          usedBudget: { increment: amount },
          remainingBudget: { decrement: amount },
        },
      });
    }
  }

  private async sendStatusChangeNotifications(
    cycleId: string,
    status: CompensationCycleStatus,
  ): Promise<void> {
    // Would implement notification logic based on status
  }
}

export default CompensationService;
