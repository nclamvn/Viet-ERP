import { db } from "@/lib/db";
import {
  calculateGoalProgress,
  calculateGoalScore,
} from "@/lib/performance/scoring";
import type { Prisma } from ".prisma/hrm-ai-client";

export async function createGoal(
  tenantId: string,
  userId: string,
  data: {
    title: string;
    description?: string;
    goalType: "COMPANY" | "DEPARTMENT" | "TEAM" | "INDIVIDUAL";
    category?: string;
    ownerId?: string;
    departmentId?: string;
    parentGoalId?: string;
    startDate: Date;
    endDate: Date;
    targetValue?: number;
    unit?: string;
    weight?: number;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    reviewCycleId?: string;
    keyResults?: {
      title: string;
      description?: string;
      targetValue: number;
      unit?: string;
      weight?: number;
      dueDate?: Date;
      order?: number;
    }[];
  },
) {
  const goal = await db.goal.create({
    data: {
      tenantId,
      title: data.title,
      description: data.description,
      goalType: data.goalType,
      category: data.category,
      ownerId: data.ownerId,
      departmentId: data.departmentId,
      parentGoalId: data.parentGoalId,
      startDate: data.startDate,
      endDate: data.endDate,
      targetValue: data.targetValue,
      unit: data.unit,
      weight: data.weight ?? 100,
      priority: data.priority ?? "MEDIUM",
      reviewCycleId: data.reviewCycleId,
      createdById: userId,
      keyResults: data.keyResults
        ? {
            create: data.keyResults.map((kr, index) => ({
              title: kr.title,
              description: kr.description,
              targetValue: kr.targetValue,
              unit: kr.unit,
              weight: kr.weight ?? 100,
              dueDate: kr.dueDate,
              order: kr.order ?? index,
            })),
          }
        : undefined,
    },
    include: {
      owner: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      department: {
        select: { id: true, name: true },
      },
      parentGoal: {
        select: { id: true, title: true },
      },
      keyResults: {
        orderBy: { order: "asc" },
      },
      reviewCycle: {
        select: { id: true, name: true },
      },
    },
  });

  return goal;
}

export async function getGoals(
  tenantId: string,
  filters?: {
    goalType?: "COMPANY" | "DEPARTMENT" | "TEAM" | "INDIVIDUAL";
    status?: "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "ON_HOLD";
    ownerId?: string;
    departmentId?: string;
    reviewCycleId?: string;
    parentGoalId?: string | null;
    search?: string;
  },
  page = 1,
  limit = 20,
) {
  const where: Prisma.GoalWhereInput = {
    tenantId,
    ...(filters?.goalType && { goalType: filters.goalType }),
    ...(filters?.status && { status: filters.status }),
    ...(filters?.ownerId && { ownerId: filters.ownerId }),
    ...(filters?.departmentId && { departmentId: filters.departmentId }),
    ...(filters?.reviewCycleId && { reviewCycleId: filters.reviewCycleId }),
    ...(filters?.parentGoalId !== undefined && {
      parentGoalId: filters.parentGoalId,
    }),
    ...(filters?.search && {
      OR: [
        { title: { contains: filters.search, mode: "insensitive" as const } },
        {
          description: {
            contains: filters.search,
            mode: "insensitive" as const,
          },
        },
      ],
    }),
  };

  const [data, total] = await Promise.all([
    db.goal.findMany({
      where,
      include: {
        owner: {
          select: { id: true, fullName: true, employeeCode: true },
        },
        department: {
          select: { id: true, name: true },
        },
        keyResults: {
          orderBy: { order: "asc" },
        },
        _count: {
          select: { childGoals: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.goal.count({ where }),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getGoalById(id: string, tenantId: string) {
  return db.goal.findFirst({
    where: { id, tenantId },
    include: {
      owner: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      department: {
        select: { id: true, name: true },
      },
      parentGoal: {
        select: { id: true, title: true, goalType: true },
      },
      childGoals: {
        include: {
          owner: {
            select: { id: true, fullName: true, employeeCode: true },
          },
          keyResults: { orderBy: { order: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
      keyResults: {
        orderBy: { order: "asc" },
      },
      updates: {
        include: {
          updatedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      reviewCycle: {
        select: { id: true, name: true, year: true },
      },
    },
  });
}

export async function updateGoal(
  id: string,
  tenantId: string,
  data: {
    title?: string;
    description?: string;
    category?: string;
    ownerId?: string;
    departmentId?: string;
    parentGoalId?: string | null;
    startDate?: Date;
    endDate?: Date;
    targetValue?: number;
    unit?: string;
    weight?: number;
    status?: "DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "ON_HOLD";
    priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  },
) {
  return db.goal.update({
    where: { id },
    data: {
      ...data,
      // Ensure tenant match
      tenantId,
    },
    include: {
      owner: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      department: {
        select: { id: true, name: true },
      },
      keyResults: {
        orderBy: { order: "asc" },
      },
    },
  });
}

export async function updateGoalProgress(
  id: string,
  tenantId: string,
  userId: string,
  data: {
    currentValue: number;
    notes?: string;
  },
) {
  const goal = await db.goal.findFirst({
    where: { id, tenantId },
    select: { currentValue: true, targetValue: true, progress: true },
  });

  if (!goal) {
    throw new Error("Goal not found");
  }

  const targetValue = goal.targetValue ? Number(goal.targetValue) : 0;
  const previousValue = goal.currentValue ? Number(goal.currentValue) : 0;
  const previousProgress = goal.progress;

  const newProgress = calculateGoalProgress(data.currentValue, targetValue);
  const newScore = calculateGoalScore(newProgress);

  const [updatedGoal] = await db.$transaction([
    db.goal.update({
      where: { id },
      data: {
        currentValue: data.currentValue,
        progress: newProgress,
        score: newScore,
        ...(newProgress >= 100 && { status: "COMPLETED" }),
      },
      include: {
        owner: {
          select: { id: true, fullName: true, employeeCode: true },
        },
        keyResults: { orderBy: { order: "asc" } },
      },
    }),
    db.goalUpdate.create({
      data: {
        goalId: id,
        previousValue: previousValue,
        newValue: data.currentValue,
        previousProgress,
        newProgress,
        notes: data.notes,
        updatedById: userId,
      },
    }),
  ]);

  return updatedGoal;
}

export async function updateKeyResultProgress(
  keyResultId: string,
  tenantId: string,
  userId: string,
  data: {
    currentValue: number;
    notes?: string;
  },
) {
  const keyResult = await db.keyResult.findFirst({
    where: { id: keyResultId },
    include: {
      goal: {
        select: { id: true, tenantId: true, targetValue: true },
      },
    },
  });

  if (!keyResult || keyResult.goal.tenantId !== tenantId) {
    throw new Error("Key result not found");
  }

  const previousValue = Number(keyResult.currentValue);
  const targetValue = Number(keyResult.targetValue);
  const newProgress = calculateGoalProgress(data.currentValue, targetValue);

  const [updatedKR] = await db.$transaction([
    db.keyResult.update({
      where: { id: keyResultId },
      data: {
        currentValue: data.currentValue,
        progress: newProgress,
        ...(newProgress >= 100 && { completedAt: new Date() }),
      },
    }),
    db.keyResultUpdate.create({
      data: {
        keyResultId,
        previousValue,
        newValue: data.currentValue,
        notes: data.notes,
        updatedById: userId,
      },
    }),
  ]);

  // Recalculate parent goal progress from all key results
  const allKeyResults = await db.keyResult.findMany({
    where: { goalId: keyResult.goal.id },
  });

  const totalWeight = allKeyResults.reduce(
    (sum, kr) => sum + Number(kr.weight),
    0,
  );
  const weightedProgress = allKeyResults.reduce((sum, kr) => {
    const krId = kr.id === keyResultId ? newProgress : kr.progress;
    return sum + krId * Number(kr.weight);
  }, 0);

  const goalProgress =
    totalWeight > 0 ? Math.round(weightedProgress / totalWeight) : 0;
  const goalScore = calculateGoalScore(goalProgress);

  await db.goal.update({
    where: { id: keyResult.goal.id },
    data: {
      progress: goalProgress,
      score: goalScore,
      currentValue: goalProgress,
      ...(goalProgress >= 100 && { status: "COMPLETED" }),
    },
  });

  return updatedKR;
}

export async function deleteGoal(id: string, tenantId: string, userId: string) {
  const goal = await db.goal.findFirst({
    where: { id, tenantId },
  });
  if (!goal) throw new Error("Goal not found");
  if (goal.ownerId !== userId)
    throw new Error("Not authorized to delete this goal");

  // Delete related records first
  await db.keyResultUpdate.deleteMany({
    where: { keyResult: { goalId: id } },
  });
  await db.keyResult.deleteMany({ where: { goalId: id } });
  await db.goalUpdate.deleteMany({ where: { goalId: id } });
  await db.goal.delete({ where: { id } });

  return { success: true };
}

export async function addKeyResult(
  id: string,
  tenantId: string,
  _userId: string,
  data: {
    title: string;
    targetValue: number;
    unit?: string;
    weight?: number;
  },
) {
  const goal = await db.goal.findFirst({ where: { id, tenantId } });
  if (!goal) throw new Error("Goal not found");

  const maxOrder = await db.keyResult.aggregate({
    where: { goalId: id },
    _max: { order: true },
  });

  return db.keyResult.create({
    data: {
      goalId: id,
      title: data.title,
      targetValue: data.targetValue,
      currentValue: 0,
      unit: data.unit || "%",
      weight: data.weight || 100,
      order: (maxOrder._max.order ?? -1) + 1,
    },
  });
}

export async function getGoalCascade(tenantId: string, reviewCycleId?: string) {
  const where: Prisma.GoalWhereInput = {
    tenantId,
    parentGoalId: null, // Only top-level goals
    ...(reviewCycleId && { reviewCycleId }),
  };

  const goals = await db.goal.findMany({
    where,
    include: {
      owner: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      department: {
        select: { id: true, name: true },
      },
      keyResults: {
        orderBy: { order: "asc" },
      },
      childGoals: {
        include: {
          owner: {
            select: { id: true, fullName: true, employeeCode: true },
          },
          department: {
            select: { id: true, name: true },
          },
          keyResults: {
            orderBy: { order: "asc" },
          },
          childGoals: {
            include: {
              owner: {
                select: { id: true, fullName: true, employeeCode: true },
              },
              keyResults: {
                orderBy: { order: "asc" },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ goalType: "asc" }, { createdAt: "asc" }],
  });

  // Organize by hierarchy: COMPANY -> DEPARTMENT -> INDIVIDUAL
  const company = goals.filter((g) => g.goalType === "COMPANY");
  const department = goals.filter((g) => g.goalType === "DEPARTMENT");
  const team = goals.filter((g) => g.goalType === "TEAM");
  const individual = goals.filter((g) => g.goalType === "INDIVIDUAL");

  return {
    company,
    department,
    team,
    individual,
    all: goals,
  };
}
