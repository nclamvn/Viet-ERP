// src/lib/performance/services/performance-review.service.ts
// Performance Review Service - Manage individual performance reviews

import { db } from "@/lib/db";
import { ReviewStatus, Prisma } from ".prisma/hrm-ai-client";

// Types
export interface SelfReviewInput {
  selfRating: number;
  selfComments?: string;
  strengths?: string;
  developmentAreas?: string;
}

export interface ManagerReviewInput {
  managerRating: number;
  managerComments?: string;
  strengths?: string;
  developmentAreas?: string;
  developmentPlan?: Record<string, unknown>[];
}

export interface GoalScoreInput {
  goalId: string;
  selfScore?: number;
  selfComments?: string;
  managerScore?: number;
  managerComments?: string;
}

export interface CompetencyScoreInput {
  competencyId: string;
  selfRating?: number;
  selfComments?: string;
  managerRating?: number;
  managerComments?: string;
}

export interface ReviewFilters {
  reviewCycleId?: string;
  employeeId?: string;
  managerId?: string;
  departmentId?: string;
  status?: ReviewStatus[];
}

export class PerformanceReviewService {
  constructor(private tenantId: string) {}

  /**
   * Get review by ID
   */
  async getById(id: string) {
    const review = await db.performanceReview.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            department: { select: { id: true, name: true } },
            position: { select: { id: true, name: true } },
          },
        },
        manager: {
          select: { id: true, fullName: true },
        },
        reviewCycle: {
          select: {
            id: true,
            name: true,
            year: true,
            goalWeight: true,
            competencyWeight: true,
            valuesWeight: true,
            feedbackWeight: true,
          },
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
        values: true,
        feedbackRequests: {
          include: {
            provider: { select: { id: true, name: true } },
            response: true,
          },
        },
      },
    });

    if (!review) {
      throw new Error("Review not found");
    }

    return review;
  }

  /**
   * Get review for employee and cycle
   */
  async getByEmployeeAndCycle(employeeId: string, reviewCycleId: string) {
    return db.performanceReview.findFirst({
      where: {
        tenantId: this.tenantId,
        employeeId,
        reviewCycleId,
      },
      include: {
        reviewCycle: { select: { id: true, name: true, status: true } },
        goals: {
          include: { goal: true },
        },
      },
    });
  }

  /**
   * List reviews
   */
  async list(
    filters: ReviewFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.PerformanceReviewWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.reviewCycleId) {
      where.reviewCycleId = filters.reviewCycleId;
    }

    if (filters.employeeId) {
      where.employeeId = filters.employeeId;
    }

    if (filters.managerId) {
      where.managerId = filters.managerId;
    }

    if (filters.departmentId) {
      where.employee = { departmentId: filters.departmentId };
    }

    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    const [reviews, total] = await Promise.all([
      db.performanceReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              department: { select: { id: true, name: true } },
            },
          },
          manager: {
            select: { id: true, fullName: true },
          },
          reviewCycle: {
            select: { id: true, name: true, year: true },
          },
        },
      }),
      db.performanceReview.count({ where }),
    ]);

    return {
      data: reviews,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get reviews for a manager
   */
  async getManagerReviews(managerId: string, reviewCycleId?: string) {
    const where: Prisma.PerformanceReviewWhereInput = {
      tenantId: this.tenantId,
      managerId,
    };

    if (reviewCycleId) {
      where.reviewCycleId = reviewCycleId;
    }

    return db.performanceReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            department: { select: { id: true, name: true } },
          },
        },
        reviewCycle: {
          select: { id: true, name: true },
        },
      },
    });
  }

  /**
   * Get employee's reviews history
   */
  async getEmployeeHistory(employeeId: string) {
    return db.performanceReview.findMany({
      where: {
        tenantId: this.tenantId,
        employeeId,
      },
      orderBy: { createdAt: "desc" },
      include: {
        reviewCycle: {
          select: { id: true, name: true, year: true, cycleType: true },
        },
      },
    });
  }

  // ===== SELF REVIEW =====

  /**
   * Submit self review
   */
  async submitSelfReview(id: string, input: SelfReviewInput) {
    const review = await db.performanceReview.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!review) {
      throw new Error("Review not found");
    }

    if (
      review.status !== ReviewStatus.NOT_STARTED &&
      review.status !== ReviewStatus.SELF_REVIEW_PENDING
    ) {
      throw new Error("Self review cannot be submitted at this stage");
    }

    return db.performanceReview.update({
      where: { id },
      data: {
        selfRating: input.selfRating,
        selfComments: input.selfComments,
        strengths: input.strengths,
        developmentAreas: input.developmentAreas,
        selfReviewAt: new Date(),
        status: ReviewStatus.SELF_REVIEW_DONE,
      },
    });
  }

  /**
   * Score goals (self assessment)
   */
  async submitGoalSelfScores(reviewId: string, scores: GoalScoreInput[]) {
    const review = await db.performanceReview.findFirst({
      where: { id: reviewId, tenantId: this.tenantId },
    });

    if (!review) {
      throw new Error("Review not found");
    }

    // Upsert goal scores
    for (const score of scores) {
      await db.reviewGoal.upsert({
        where: {
          reviewId_goalId: {
            reviewId,
            goalId: score.goalId,
          },
        },
        create: {
          reviewId,
          goalId: score.goalId,
          selfScore: score.selfScore,
          selfComments: score.selfComments,
        },
        update: {
          selfScore: score.selfScore,
          selfComments: score.selfComments,
        },
      });
    }

    return { success: true };
  }

  /**
   * Score competencies (self assessment)
   */
  async submitCompetencySelfScores(
    reviewId: string,
    scores: CompetencyScoreInput[],
  ) {
    const review = await db.performanceReview.findFirst({
      where: { id: reviewId, tenantId: this.tenantId },
    });

    if (!review) {
      throw new Error("Review not found");
    }

    // Upsert competency scores
    for (const score of scores) {
      await db.reviewCompetency.upsert({
        where: {
          reviewId_competencyId: {
            reviewId,
            competencyId: score.competencyId,
          },
        },
        create: {
          reviewId,
          competencyId: score.competencyId,
          requiredLevel: 3, // Default required level
          selfRating: score.selfRating,
          selfComments: score.selfComments,
        },
        update: {
          selfRating: score.selfRating,
          selfComments: score.selfComments,
        },
      });
    }

    return { success: true };
  }

  // ===== MANAGER REVIEW =====

  /**
   * Submit manager review
   */
  async submitManagerReview(id: string, input: ManagerReviewInput) {
    const review = await db.performanceReview.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!review) {
      throw new Error("Review not found");
    }

    if (
      review.status !== ReviewStatus.SELF_REVIEW_DONE &&
      review.status !== ReviewStatus.MANAGER_REVIEW_PENDING
    ) {
      throw new Error("Manager review cannot be submitted at this stage");
    }

    return db.performanceReview.update({
      where: { id },
      data: {
        managerRating: input.managerRating,
        managerComments: input.managerComments,
        strengths: input.strengths,
        developmentAreas: input.developmentAreas,
        developmentPlan:
          input.developmentPlan as unknown as Prisma.InputJsonValue,
        managerReviewAt: new Date(),
        status: ReviewStatus.MANAGER_REVIEW_DONE,
      },
    });
  }

  /**
   * Score goals (manager assessment)
   */
  async submitGoalManagerScores(reviewId: string, scores: GoalScoreInput[]) {
    for (const score of scores) {
      await db.reviewGoal.update({
        where: {
          reviewId_goalId: {
            reviewId,
            goalId: score.goalId,
          },
        },
        data: {
          managerScore: score.managerScore,
          managerComments: score.managerComments,
          finalScore: score.managerScore, // Manager score becomes final by default
        },
      });
    }

    // Calculate overall goal score
    await this.calculateGoalScore(reviewId);

    return { success: true };
  }

  /**
   * Score competencies (manager assessment)
   */
  async submitCompetencyManagerScores(
    reviewId: string,
    scores: CompetencyScoreInput[],
  ) {
    for (const score of scores) {
      await db.reviewCompetency.update({
        where: {
          reviewId_competencyId: {
            reviewId,
            competencyId: score.competencyId,
          },
        },
        data: {
          managerRating: score.managerRating,
          managerComments: score.managerComments,
          finalRating: score.managerRating,
        },
      });
    }

    // Calculate overall competency score
    await this.calculateCompetencyScore(reviewId);

    return { success: true };
  }

  // ===== CALIBRATION =====

  /**
   * Submit calibrated rating
   */
  async calibrate(id: string, calibratedRating: number) {
    const review = await db.performanceReview.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!review) {
      throw new Error("Review not found");
    }

    return db.performanceReview.update({
      where: { id },
      data: {
        calibratedRating,
        calibratedAt: new Date(),
        status: ReviewStatus.CALIBRATION_PENDING,
      },
    });
  }

  /**
   * Complete review
   */
  async complete(id: string, finalRating: number) {
    const review = await this.getById(id);

    // Calculate overall score
    const overallScore = await this.calculateOverallScore(id);

    return db.performanceReview.update({
      where: { id },
      data: {
        finalRating,
        overallScore,
        status: ReviewStatus.COMPLETED,
      },
    });
  }

  /**
   * Acknowledge review (by employee)
   */
  async acknowledge(id: string, employeeComments?: string) {
    const review = await db.performanceReview.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!review) {
      throw new Error("Review not found");
    }

    if (review.status !== ReviewStatus.COMPLETED) {
      throw new Error("Review must be completed before acknowledgement");
    }

    return db.performanceReview.update({
      where: { id },
      data: {
        employeeComments,
        acknowledgedAt: new Date(),
        status: ReviewStatus.ACKNOWLEDGED,
      },
    });
  }

  // ===== SCORE CALCULATIONS =====

  /**
   * Calculate goal score
   */
  private async calculateGoalScore(reviewId: string) {
    const goals = await db.reviewGoal.findMany({
      where: { reviewId },
      include: { goal: true },
    });

    if (goals.length === 0) return 0;

    // Weighted average
    const totalWeight = goals.reduce(
      (sum, g) => sum + Number(g.goal.weight),
      0,
    );
    const weightedScore = goals.reduce((sum, g) => {
      const score = Number(g.finalScore || g.managerScore || 0);
      return sum + score * Number(g.goal.weight);
    }, 0);

    const goalScore =
      totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 10) / 10 : 0;

    await db.performanceReview.update({
      where: { id: reviewId },
      data: { goalScore },
    });

    return goalScore;
  }

  /**
   * Calculate competency score
   */
  private async calculateCompetencyScore(reviewId: string) {
    const competencies = await db.reviewCompetency.findMany({
      where: { reviewId },
    });

    if (competencies.length === 0) return 0;

    const avgRating =
      competencies.reduce((sum, c) => {
        return sum + (c.finalRating || c.managerRating || 0);
      }, 0) / competencies.length;

    const competencyScore = Math.round(avgRating * 10) / 10;

    await db.performanceReview.update({
      where: { id: reviewId },
      data: { competencyScore },
    });

    return competencyScore;
  }

  /**
   * Calculate overall score
   */
  private async calculateOverallScore(reviewId: string) {
    const review = await db.performanceReview.findFirst({
      where: { id: reviewId },
      include: {
        reviewCycle: true,
      },
    });

    if (!review) return 0;

    const weights = {
      goal: Number(review.reviewCycle.goalWeight) / 100,
      competency: Number(review.reviewCycle.competencyWeight) / 100,
      values: Number(review.reviewCycle.valuesWeight) / 100,
      feedback: Number(review.reviewCycle.feedbackWeight) / 100,
    };

    const scores = {
      goal: Number(review.goalScore || 0),
      competency: Number(review.competencyScore || 0),
      values: Number(review.valuesScore || 0),
      feedback: Number(review.feedbackScore || 0),
    };

    const overallScore =
      scores.goal * weights.goal +
      scores.competency * weights.competency +
      scores.values * weights.values +
      scores.feedback * weights.feedback;

    return Math.round(overallScore * 10) / 10;
  }

  // ===== STATISTICS =====

  /**
   * Get review statistics for a cycle
   */
  async getCycleStats(reviewCycleId: string) {
    const [total, byStatus, avgRatings, ratingDistribution] = await Promise.all(
      [
        db.performanceReview.count({
          where: { reviewCycleId, tenantId: this.tenantId },
        }),

        db.performanceReview.groupBy({
          by: ["status"],
          where: { reviewCycleId, tenantId: this.tenantId },
          _count: true,
        }),

        db.performanceReview.aggregate({
          where: {
            reviewCycleId,
            tenantId: this.tenantId,
            finalRating: { not: null },
          },
          _avg: {
            finalRating: true,
            overallScore: true,
          },
        }),

        db.performanceReview.groupBy({
          by: ["finalRating"],
          where: {
            reviewCycleId,
            tenantId: this.tenantId,
            finalRating: { not: null },
          },
          _count: true,
          orderBy: { finalRating: "asc" },
        }),
      ],
    );

    return {
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      averageRating: avgRatings._avg.finalRating || 0,
      averageScore: avgRatings._avg.overallScore || 0,
      ratingDistribution: ratingDistribution.map((r) => ({
        rating: r.finalRating,
        count: r._count,
      })),
    };
  }

  /**
   * Get pending actions for user
   */
  async getPendingActions(userId: string) {
    // Get employee ID from user
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { employee: { select: { id: true } } },
    });

    const employeeId = user?.employee?.id;

    const results = {
      selfReviewPending: [] as any[],
      managerReviewPending: [] as any[],
      calibrationPending: [] as any[],
      acknowledgedPending: [] as any[],
    };

    if (employeeId) {
      // Self reviews pending
      results.selfReviewPending = await db.performanceReview.findMany({
        where: {
          tenantId: this.tenantId,
          employeeId,
          status: {
            in: [ReviewStatus.NOT_STARTED, ReviewStatus.SELF_REVIEW_PENDING],
          },
        },
        include: {
          reviewCycle: {
            select: { id: true, name: true, selfReviewEnd: true },
          },
        },
      });

      // Acknowledgements pending
      results.acknowledgedPending = await db.performanceReview.findMany({
        where: {
          tenantId: this.tenantId,
          employeeId,
          status: ReviewStatus.COMPLETED,
        },
        include: {
          reviewCycle: { select: { id: true, name: true } },
        },
      });
    }

    // Manager reviews pending
    results.managerReviewPending = await db.performanceReview.findMany({
      where: {
        tenantId: this.tenantId,
        managerId: userId,
        status: {
          in: [
            ReviewStatus.SELF_REVIEW_DONE,
            ReviewStatus.MANAGER_REVIEW_PENDING,
          ],
        },
      },
      include: {
        employee: { select: { id: true, fullName: true } },
        reviewCycle: {
          select: { id: true, name: true, managerReviewEnd: true },
        },
      },
    });

    return results;
  }
}

// Factory function
export function createPerformanceReviewService(
  tenantId: string,
): PerformanceReviewService {
  return new PerformanceReviewService(tenantId);
}
