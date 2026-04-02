import { db } from "@/lib/db";
import {
  calculateOverallReviewScore,
  scoreToRating,
} from "@/lib/performance/scoring";
import type { Prisma } from ".prisma/hrm-ai-client";

export async function createReviewCycle(
  tenantId: string,
  userId: string,
  data: {
    name: string;
    description?: string;
    cycleType:
      | "ANNUAL"
      | "SEMI_ANNUAL"
      | "QUARTERLY"
      | "PROBATION"
      | "PROJECT"
      | "AD_HOC";
    year: number;
    startDate: Date;
    endDate: Date;
    goalSettingStart?: Date;
    goalSettingEnd?: Date;
    selfReviewStart?: Date;
    selfReviewEnd?: Date;
    managerReviewStart?: Date;
    managerReviewEnd?: Date;
    calibrationStart?: Date;
    calibrationEnd?: Date;
    goalWeight?: number;
    competencyWeight?: number;
    valuesWeight?: number;
    feedbackWeight?: number;
    allowSelfReview?: boolean;
    allow360Feedback?: boolean;
    requireCalibration?: boolean;
  },
) {
  return db.reviewCycle.create({
    data: {
      tenantId,
      name: data.name,
      description: data.description,
      cycleType: data.cycleType,
      year: data.year,
      startDate: data.startDate,
      endDate: data.endDate,
      goalSettingStart: data.goalSettingStart,
      goalSettingEnd: data.goalSettingEnd,
      selfReviewStart: data.selfReviewStart,
      selfReviewEnd: data.selfReviewEnd,
      managerReviewStart: data.managerReviewStart,
      managerReviewEnd: data.managerReviewEnd,
      calibrationStart: data.calibrationStart,
      calibrationEnd: data.calibrationEnd,
      goalWeight: data.goalWeight ?? 40,
      competencyWeight: data.competencyWeight ?? 30,
      valuesWeight: data.valuesWeight ?? 20,
      feedbackWeight: data.feedbackWeight ?? 10,
      allowSelfReview: data.allowSelfReview ?? true,
      allow360Feedback: data.allow360Feedback ?? true,
      requireCalibration: data.requireCalibration ?? true,
      createdById: userId,
    },
    include: {
      _count: {
        select: { reviews: true, goals: true },
      },
    },
  });
}

export async function getReviewCycles(
  tenantId: string,
  filters?: {
    year?: number;
    status?: string;
    cycleType?: string;
    search?: string;
  },
  page = 1,
  limit = 20,
) {
  const where: Prisma.ReviewCycleWhereInput = {
    tenantId,
    ...(filters?.year && { year: filters.year }),
    ...(filters?.status && { status: filters.status as any }),
    ...(filters?.cycleType && { cycleType: filters.cycleType as any }),
    ...(filters?.search && {
      OR: [
        { name: { contains: filters.search, mode: "insensitive" as const } },
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
    db.reviewCycle.findMany({
      where,
      include: {
        _count: {
          select: { reviews: true, goals: true },
        },
      },
      orderBy: [{ year: "desc" }, { startDate: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.reviewCycle.count({ where }),
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

export async function getReviewCycleById(id: string, tenantId: string) {
  return db.reviewCycle.findFirst({
    where: { id, tenantId },
    include: {
      reviews: {
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              employeeCode: true,
              position: { select: { name: true } },
              department: { select: { id: true, name: true } },
            },
          },
          manager: {
            select: { id: true, fullName: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      goals: {
        include: {
          owner: {
            select: { id: true, fullName: true, employeeCode: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { reviews: true, goals: true },
      },
    },
  });
}

export async function launchReviewCycle(
  id: string,
  tenantId: string,
  employeeIds?: string[],
) {
  const cycle = await db.reviewCycle.findFirst({
    where: { id, tenantId },
  });

  if (!cycle) {
    throw new Error("Review cycle not found");
  }

  // Get employees to create reviews for
  const employees = await db.employee.findMany({
    where: {
      tenantId,
      status: { in: ["ACTIVE", "PROBATION"] },
      deletedAt: null,
      ...(employeeIds && { id: { in: employeeIds } }),
      directManagerId: { not: null },
    },
    select: {
      id: true,
      directManagerId: true,
    },
  });

  // Create performance reviews for each employee
  const reviews = await db.$transaction(
    employees.map((emp) =>
      db.performanceReview.upsert({
        where: {
          reviewCycleId_employeeId: {
            reviewCycleId: id,
            employeeId: emp.id,
          },
        },
        update: {},
        create: {
          tenantId,
          reviewCycleId: id,
          employeeId: emp.id,
          managerId: emp.directManagerId!,
          status: "SELF_REVIEW_PENDING",
        },
      }),
    ),
  );

  // Update cycle status
  await db.reviewCycle.update({
    where: { id },
    data: { status: "IN_PROGRESS" },
  });

  return {
    cycleId: id,
    reviewsCreated: reviews.length,
    reviews,
  };
}

export async function getPerformanceReviews(
  tenantId: string,
  filters?: {
    reviewCycleId?: string;
    employeeId?: string;
    managerId?: string;
    status?: string;
    departmentId?: string;
    search?: string;
  },
  page = 1,
  limit = 20,
) {
  const where: Prisma.PerformanceReviewWhereInput = {
    tenantId,
    ...(filters?.reviewCycleId && { reviewCycleId: filters.reviewCycleId }),
    ...(filters?.employeeId && { employeeId: filters.employeeId }),
    ...(filters?.managerId && { managerId: filters.managerId }),
    ...(filters?.status && { status: filters.status as any }),
    ...(filters?.departmentId && {
      employee: { departmentId: filters.departmentId },
    }),
    ...(filters?.search && {
      employee: {
        OR: [
          {
            fullName: {
              contains: filters.search,
              mode: "insensitive" as const,
            },
          },
          {
            employeeCode: {
              contains: filters.search,
              mode: "insensitive" as const,
            },
          },
        ],
      },
    }),
  };

  const [data, total] = await Promise.all([
    db.performanceReview.findMany({
      where,
      include: {
        reviewCycle: {
          select: { id: true, name: true, year: true, cycleType: true },
        },
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            position: { select: { name: true } },
            department: { select: { id: true, name: true } },
          },
        },
        manager: {
          select: { id: true, fullName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.performanceReview.count({ where }),
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

export async function getPerformanceReviewById(id: string, tenantId: string) {
  return db.performanceReview.findFirst({
    where: { id, tenantId },
    include: {
      reviewCycle: true,
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          position: { select: { name: true } },
          department: { select: { id: true, name: true } },
        },
      },
      manager: {
        select: { id: true, fullName: true },
      },
      goals: {
        include: {
          goal: {
            include: {
              keyResults: { orderBy: { order: "asc" } },
            },
          },
        },
      },
      competencies: {
        include: {
          competency: true,
        },
      },
      values: {
        include: {
          coreValue: true,
        },
      },
      feedbackRequests: {
        include: {
          response: true,
          provider: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });
}

export async function submitSelfReview(
  id: string,
  tenantId: string,
  employeeId: string,
  data: {
    selfRating: number;
    selfComments?: string;
    goalScores?: { goalId: string; selfScore: number; selfComments?: string }[];
    competencyRatings?: {
      competencyId: string;
      selfRating: number;
      selfComments?: string;
    }[];
    valueRatings?: {
      coreValueId: string;
      selfRating: number;
      selfComments?: string;
    }[];
  },
) {
  const review = await db.performanceReview.findFirst({
    where: { id, tenantId, employeeId },
  });

  if (!review) {
    throw new Error("Review not found or access denied");
  }

  // Update goal scores
  if (data.goalScores) {
    await Promise.all(
      data.goalScores.map((gs) =>
        db.reviewGoal.updateMany({
          where: { reviewId: id, goalId: gs.goalId },
          data: {
            selfScore: gs.selfScore,
            selfComments: gs.selfComments,
          },
        }),
      ),
    );
  }

  // Update competency ratings
  if (data.competencyRatings) {
    await Promise.all(
      data.competencyRatings.map((cr) =>
        db.reviewCompetency.updateMany({
          where: { reviewId: id, competencyId: cr.competencyId },
          data: {
            selfRating: cr.selfRating,
            selfComments: cr.selfComments,
          },
        }),
      ),
    );
  }

  // Update value ratings
  if (data.valueRatings) {
    await Promise.all(
      data.valueRatings.map((vr) =>
        db.reviewValue.updateMany({
          where: { reviewId: id, coreValueId: vr.coreValueId },
          data: {
            selfRating: vr.selfRating,
            selfComments: vr.selfComments,
          },
        }),
      ),
    );
  }

  // Update review status
  return db.performanceReview.update({
    where: { id },
    data: {
      selfRating: data.selfRating,
      selfComments: data.selfComments,
      status: "SELF_REVIEW_DONE",
      selfReviewAt: new Date(),
    },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      goals: { include: { goal: true } },
      competencies: { include: { competency: true } },
      values: { include: { coreValue: true } },
    },
  });
}

export async function submitManagerReview(
  id: string,
  tenantId: string,
  managerId: string,
  data: {
    managerRating: number;
    managerComments?: string;
    strengths?: string;
    developmentAreas?: string;
    developmentPlan?: {
      area: string;
      action: string;
      timeline: string;
      resources?: string;
    }[];
    goalScores?: {
      goalId: string;
      managerScore: number;
      managerComments?: string;
    }[];
    competencyRatings?: {
      competencyId: string;
      managerRating: number;
      managerComments?: string;
    }[];
    valueRatings?: {
      coreValueId: string;
      managerRating: number;
      managerComments?: string;
    }[];
  },
) {
  const review = await db.performanceReview.findFirst({
    where: { id, tenantId, managerId },
    include: { reviewCycle: true },
  });

  if (!review) {
    throw new Error("Review not found or access denied");
  }

  // Update goal scores
  if (data.goalScores) {
    await Promise.all(
      data.goalScores.map((gs) =>
        db.reviewGoal.updateMany({
          where: { reviewId: id, goalId: gs.goalId },
          data: {
            managerScore: gs.managerScore,
            managerComments: gs.managerComments,
            finalScore: gs.managerScore, // Manager score as final by default
          },
        }),
      ),
    );
  }

  // Update competency ratings
  if (data.competencyRatings) {
    await Promise.all(
      data.competencyRatings.map((cr) =>
        db.reviewCompetency.updateMany({
          where: { reviewId: id, competencyId: cr.competencyId },
          data: {
            managerRating: cr.managerRating,
            managerComments: cr.managerComments,
            finalRating: cr.managerRating,
          },
        }),
      ),
    );
  }

  // Update value ratings
  if (data.valueRatings) {
    await Promise.all(
      data.valueRatings.map((vr) =>
        db.reviewValue.updateMany({
          where: { reviewId: id, coreValueId: vr.coreValueId },
          data: {
            managerRating: vr.managerRating,
            managerComments: vr.managerComments,
            finalRating: vr.managerRating,
          },
        }),
      ),
    );
  }

  // Calculate overall scores
  const goalScore =
    data.goalScores && data.goalScores.length > 0
      ? data.goalScores.reduce((sum, g) => sum + g.managerScore, 0) /
        data.goalScores.length
      : null;

  const competencyScore =
    data.competencyRatings && data.competencyRatings.length > 0
      ? data.competencyRatings.reduce((sum, c) => sum + c.managerRating, 0) /
        data.competencyRatings.length
      : null;

  const valuesScore =
    data.valueRatings && data.valueRatings.length > 0
      ? data.valueRatings.reduce((sum, v) => sum + v.managerRating, 0) /
        data.valueRatings.length
      : null;

  const weights = {
    goal: Number(review.reviewCycle.goalWeight),
    competency: Number(review.reviewCycle.competencyWeight),
    values: Number(review.reviewCycle.valuesWeight),
    feedback: Number(review.reviewCycle.feedbackWeight),
  };

  const overallScore = calculateOverallReviewScore(
    goalScore,
    competencyScore,
    valuesScore,
    null, // feedback score calculated separately
    weights,
  );

  const finalRating = scoreToRating(overallScore);

  return db.performanceReview.update({
    where: { id },
    data: {
      managerRating: data.managerRating,
      managerComments: data.managerComments,
      strengths: data.strengths,
      developmentAreas: data.developmentAreas,
      developmentPlan: data.developmentPlan as any,
      goalScore,
      competencyScore,
      valuesScore,
      overallScore,
      finalRating,
      status: "MANAGER_REVIEW_DONE",
      managerReviewAt: new Date(),
    },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      manager: {
        select: { id: true, fullName: true },
      },
      goals: { include: { goal: true } },
      competencies: { include: { competency: true } },
      values: { include: { coreValue: true } },
    },
  });
}

export async function acknowledgeReview(
  id: string,
  tenantId: string,
  employeeId: string,
  comments?: string,
) {
  const review = await db.performanceReview.findFirst({
    where: { id, tenantId, employeeId },
  });

  if (!review) {
    throw new Error("Review not found or access denied");
  }

  return db.performanceReview.update({
    where: { id },
    data: {
      employeeComments: comments,
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date(),
    },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      reviewCycle: {
        select: { id: true, name: true },
      },
    },
  });
}
