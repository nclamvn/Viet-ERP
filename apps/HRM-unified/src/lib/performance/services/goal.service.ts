// src/lib/performance/services/goal.service.ts
// Goal Service - OKR and Goal Management

import { db } from "@/lib/db";
import {
  GoalType,
  GoalStatus,
  GoalPriority,
  Prisma,
} from ".prisma/hrm-unified-client";

// Types
export interface CreateGoalInput {
  title: string;
  description?: string;
  goalType: GoalType;
  category?: string;
  ownerId?: string;
  departmentId?: string;
  parentGoalId?: string;
  startDate: Date;
  endDate: Date;
  targetValue?: number;
  unit?: string;
  weight?: number;
  priority?: GoalPriority;
  reviewCycleId?: string;
}

export interface CreateKeyResultInput {
  title: string;
  description?: string;
  targetValue: number;
  unit?: string;
  weight?: number;
  dueDate?: Date;
  order?: number;
}

export interface UpdateProgressInput {
  currentValue?: number;
  progress?: number;
  notes?: string;
}

export interface GoalFilters {
  goalType?: GoalType[];
  status?: GoalStatus[];
  priority?: GoalPriority[];
  ownerId?: string;
  departmentId?: string;
  reviewCycleId?: string;
  parentGoalId?: string;
  search?: string;
}

export class GoalService {
  constructor(private tenantId: string) {}

  // ===== GOALS =====

  /**
   * Create a goal
   */
  async create(createdById: string, input: CreateGoalInput) {
    // Validate parent goal if specified
    if (input.parentGoalId) {
      const parentGoal = await db.goal.findFirst({
        where: { id: input.parentGoalId, tenantId: this.tenantId },
      });

      if (!parentGoal) {
        throw new Error("Parent goal not found");
      }
    }

    return db.goal.create({
      data: {
        tenantId: this.tenantId,
        title: input.title,
        description: input.description,
        goalType: input.goalType,
        category: input.category,
        ownerId: input.ownerId,
        departmentId: input.departmentId,
        parentGoalId: input.parentGoalId,
        startDate: input.startDate,
        endDate: input.endDate,
        targetValue: input.targetValue,
        unit: input.unit,
        weight: input.weight ?? 100,
        priority: input.priority ?? GoalPriority.MEDIUM,
        reviewCycleId: input.reviewCycleId,
        createdById,
        status: GoalStatus.DRAFT,
      },
      include: {
        owner: { select: { id: true, fullName: true } },
        department: { select: { id: true, name: true } },
        parentGoal: { select: { id: true, title: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Get goal by ID
   */
  async getById(id: string) {
    const goal = await db.goal.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        owner: { select: { id: true, fullName: true } },
        department: { select: { id: true, name: true } },
        parentGoal: { select: { id: true, title: true } },
        childGoals: {
          select: { id: true, title: true, progress: true, status: true },
          orderBy: { createdAt: "asc" },
        },
        keyResults: {
          orderBy: { order: "asc" },
        },
        createdBy: { select: { id: true, name: true } },
        updates: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            updatedBy: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!goal) {
      throw new Error("Goal not found");
    }

    return goal;
  }

  /**
   * List goals
   */
  async list(
    filters: GoalFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.GoalWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.goalType?.length) {
      where.goalType = { in: filters.goalType };
    }

    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    if (filters.priority?.length) {
      where.priority = { in: filters.priority };
    }

    if (filters.ownerId) {
      where.ownerId = filters.ownerId;
    }

    if (filters.departmentId) {
      where.departmentId = filters.departmentId;
    }

    if (filters.reviewCycleId) {
      where.reviewCycleId = filters.reviewCycleId;
    }

    if (filters.parentGoalId) {
      where.parentGoalId = filters.parentGoalId;
    }

    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const [goals, total] = await Promise.all([
      db.goal.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip,
        take: pageSize,
        include: {
          owner: { select: { id: true, fullName: true } },
          department: { select: { id: true, name: true } },
          _count: { select: { keyResults: true, childGoals: true } },
        },
      }),
      db.goal.count({ where }),
    ]);

    return {
      data: goals,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get goals hierarchy for an employee
   */
  async getEmployeeGoals(employeeId: string, reviewCycleId?: string) {
    const where: Prisma.GoalWhereInput = {
      tenantId: this.tenantId,
      ownerId: employeeId,
      status: { not: GoalStatus.CANCELLED },
    };

    if (reviewCycleId) {
      where.reviewCycleId = reviewCycleId;
    }

    return db.goal.findMany({
      where,
      orderBy: [{ priority: "desc" }, { startDate: "asc" }],
      include: {
        keyResults: { orderBy: { order: "asc" } },
        parentGoal: { select: { id: true, title: true, goalType: true } },
      },
    });
  }

  /**
   * Get department goals
   */
  async getDepartmentGoals(departmentId: string, reviewCycleId?: string) {
    const where: Prisma.GoalWhereInput = {
      tenantId: this.tenantId,
      departmentId,
      goalType: GoalType.DEPARTMENT,
      status: { not: GoalStatus.CANCELLED },
    };

    if (reviewCycleId) {
      where.reviewCycleId = reviewCycleId;
    }

    return db.goal.findMany({
      where,
      orderBy: { priority: "desc" },
      include: {
        childGoals: {
          include: {
            owner: { select: { id: true, fullName: true } },
          },
        },
        keyResults: { orderBy: { order: "asc" } },
      },
    });
  }

  /**
   * Update goal
   */
  async update(id: string, input: Partial<CreateGoalInput>) {
    const goal = await db.goal.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!goal) {
      throw new Error("Goal not found");
    }

    return db.goal.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        goalType: input.goalType,
        category: input.category,
        ownerId: input.ownerId,
        departmentId: input.departmentId,
        parentGoalId: input.parentGoalId,
        startDate: input.startDate,
        endDate: input.endDate,
        targetValue: input.targetValue,
        unit: input.unit,
        weight: input.weight,
        priority: input.priority,
      },
    });
  }

  /**
   * Activate goal
   */
  async activate(id: string) {
    return db.goal.update({
      where: { id },
      data: { status: GoalStatus.ACTIVE },
    });
  }

  /**
   * Complete goal
   */
  async complete(id: string, score?: number) {
    return db.goal.update({
      where: { id },
      data: {
        status: GoalStatus.COMPLETED,
        score,
        progress: 100,
      },
    });
  }

  /**
   * Cancel goal
   */
  async cancel(id: string) {
    return db.goal.update({
      where: { id },
      data: { status: GoalStatus.CANCELLED },
    });
  }

  /**
   * Put goal on hold
   */
  async hold(id: string) {
    return db.goal.update({
      where: { id },
      data: { status: GoalStatus.ON_HOLD },
    });
  }

  /**
   * Update goal progress
   */
  async updateProgress(id: string, userId: string, input: UpdateProgressInput) {
    const goal = await db.goal.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!goal) {
      throw new Error("Goal not found");
    }

    // Create update record
    await db.goalUpdate.create({
      data: {
        goalId: id,
        previousValue: goal.currentValue,
        newValue: input.currentValue,
        previousProgress: goal.progress,
        newProgress: input.progress,
        notes: input.notes,
        updatedById: userId,
      },
    });

    // Update goal
    return db.goal.update({
      where: { id },
      data: {
        currentValue: input.currentValue,
        progress: input.progress,
      },
    });
  }

  /**
   * Delete goal
   */
  async delete(id: string) {
    const goal = await db.goal.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { _count: { select: { childGoals: true } } },
    });

    if (!goal) {
      throw new Error("Goal not found");
    }

    if (goal._count.childGoals > 0) {
      throw new Error("Cannot delete goal with child goals");
    }

    if (goal.status === GoalStatus.ACTIVE) {
      throw new Error("Cannot delete active goal. Cancel it first.");
    }

    await db.goal.delete({ where: { id } });
    return { success: true };
  }

  // ===== KEY RESULTS =====

  /**
   * Add key result to goal
   */
  async addKeyResult(goalId: string, input: CreateKeyResultInput) {
    const goal = await db.goal.findFirst({
      where: { id: goalId, tenantId: this.tenantId },
    });

    if (!goal) {
      throw new Error("Goal not found");
    }

    // Get max order
    const lastKR = await db.keyResult.findFirst({
      where: { goalId },
      orderBy: { order: "desc" },
    });

    const order = input.order ?? (lastKR ? lastKR.order + 1 : 0);

    return db.keyResult.create({
      data: {
        goalId,
        title: input.title,
        description: input.description,
        targetValue: input.targetValue,
        unit: input.unit,
        weight: input.weight ?? 100,
        dueDate: input.dueDate,
        order,
      },
    });
  }

  /**
   * Update key result
   */
  async updateKeyResult(
    keyResultId: string,
    input: Partial<CreateKeyResultInput>,
  ) {
    return db.keyResult.update({
      where: { id: keyResultId },
      data: {
        title: input.title,
        description: input.description,
        targetValue: input.targetValue,
        unit: input.unit,
        weight: input.weight,
        dueDate: input.dueDate,
        order: input.order,
      },
    });
  }

  /**
   * Update key result progress
   */
  async updateKeyResultProgress(
    keyResultId: string,
    userId: string,
    currentValue: number,
    notes?: string,
  ) {
    const kr = await db.keyResult.findUnique({
      where: { id: keyResultId },
    });

    if (!kr) {
      throw new Error("Key result not found");
    }

    // Create update record
    await db.keyResultUpdate.create({
      data: {
        keyResultId,
        previousValue: kr.currentValue,
        newValue: currentValue,
        notes,
        updatedById: userId,
      },
    });

    // Calculate progress
    const targetValue = Number(kr.targetValue);
    const progress =
      targetValue > 0
        ? Math.min(100, Math.round((currentValue / targetValue) * 100))
        : 0;

    const completedAt = progress >= 100 ? new Date() : null;

    // Update key result
    const updated = await db.keyResult.update({
      where: { id: keyResultId },
      data: {
        currentValue,
        progress,
        completedAt,
      },
    });

    // Recalculate goal progress
    await this.recalculateGoalProgress(kr.goalId);

    return updated;
  }

  /**
   * Delete key result
   */
  async deleteKeyResult(keyResultId: string) {
    const kr = await db.keyResult.findUnique({
      where: { id: keyResultId },
    });

    if (!kr) {
      throw new Error("Key result not found");
    }

    await db.keyResult.delete({ where: { id: keyResultId } });

    // Recalculate goal progress
    await this.recalculateGoalProgress(kr.goalId);

    return { success: true };
  }

  /**
   * Recalculate goal progress from key results
   */
  private async recalculateGoalProgress(goalId: string) {
    const keyResults = await db.keyResult.findMany({
      where: { goalId },
    });

    if (keyResults.length === 0) {
      return;
    }

    // Weighted average progress
    const totalWeight = keyResults.reduce(
      (sum, kr) => sum + Number(kr.weight),
      0,
    );
    const weightedProgress = keyResults.reduce(
      (sum, kr) => sum + kr.progress * Number(kr.weight),
      0,
    );

    const progress =
      totalWeight > 0 ? Math.round(weightedProgress / totalWeight) : 0;

    await db.goal.update({
      where: { id: goalId },
      data: { progress },
    });
  }

  // ===== STATISTICS =====

  /**
   * Get goal statistics
   */
  async getStats(reviewCycleId?: string) {
    const where: Prisma.GoalWhereInput = {
      tenantId: this.tenantId,
    };

    if (reviewCycleId) {
      where.reviewCycleId = reviewCycleId;
    }

    const [total, byStatus, byType, avgProgress] = await Promise.all([
      db.goal.count({ where }),

      db.goal.groupBy({
        by: ["status"],
        where,
        _count: true,
      }),

      db.goal.groupBy({
        by: ["goalType"],
        where,
        _count: true,
      }),

      db.goal.aggregate({
        where: { ...where, status: GoalStatus.ACTIVE },
        _avg: { progress: true },
      }),
    ]);

    return {
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byType: byType.map((t) => ({ type: t.goalType, count: t._count })),
      averageProgress: avgProgress._avg.progress || 0,
    };
  }

  /**
   * Get goals needing attention (behind schedule)
   */
  async getAtRiskGoals() {
    const now = new Date();

    return db.goal.findMany({
      where: {
        tenantId: this.tenantId,
        status: GoalStatus.ACTIVE,
        endDate: { gt: now },
        progress: { lt: 50 }, // Less than 50% progress
      },
      orderBy: { endDate: "asc" },
      include: {
        owner: { select: { id: true, fullName: true } },
        department: { select: { id: true, name: true } },
      },
      take: 20,
    });
  }

  /**
   * Get goal alignment (cascade view)
   */
  async getGoalAlignment(reviewCycleId?: string) {
    const where: Prisma.GoalWhereInput = {
      tenantId: this.tenantId,
      parentGoalId: null, // Top-level goals only
      status: { not: GoalStatus.CANCELLED },
    };

    if (reviewCycleId) {
      where.reviewCycleId = reviewCycleId;
    }

    // Get company goals with full hierarchy
    const companyGoals = await db.goal.findMany({
      where: { ...where, goalType: GoalType.COMPANY },
      include: {
        childGoals: {
          where: { goalType: GoalType.DEPARTMENT },
          include: {
            department: { select: { id: true, name: true } },
            childGoals: {
              where: { goalType: GoalType.INDIVIDUAL },
              include: {
                owner: { select: { id: true, fullName: true } },
              },
            },
          },
        },
      },
    });

    return companyGoals;
  }
}

// Factory function
export function createGoalService(tenantId: string): GoalService {
  return new GoalService(tenantId);
}
