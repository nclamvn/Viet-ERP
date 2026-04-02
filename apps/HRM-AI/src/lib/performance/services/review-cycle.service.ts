// src/lib/performance/services/review-cycle.service.ts
// Review Cycle Service - Manage performance review cycles

import { db } from "@/lib/db";
import {
  ReviewCycleType,
  ReviewCycleStatus,
  ReviewStatus,
  Prisma,
} from ".prisma/hrm-ai-client";

// Types
export interface CreateReviewCycleInput {
  name: string;
  description?: string;
  cycleType: ReviewCycleType;
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
}

export interface ReviewCycleFilters {
  year?: number;
  cycleType?: ReviewCycleType[];
  status?: ReviewCycleStatus[];
}

export class ReviewCycleService {
  constructor(private tenantId: string) {}

  /**
   * Create a review cycle
   */
  async create(createdById: string, input: CreateReviewCycleInput) {
    // Validate weights sum to 100
    const totalWeight =
      (input.goalWeight ?? 40) +
      (input.competencyWeight ?? 30) +
      (input.valuesWeight ?? 20) +
      (input.feedbackWeight ?? 10);

    if (totalWeight !== 100) {
      throw new Error("Score weights must sum to 100");
    }

    return db.reviewCycle.create({
      data: {
        tenantId: this.tenantId,
        name: input.name,
        description: input.description,
        cycleType: input.cycleType,
        year: input.year,
        startDate: input.startDate,
        endDate: input.endDate,
        goalSettingStart: input.goalSettingStart,
        goalSettingEnd: input.goalSettingEnd,
        selfReviewStart: input.selfReviewStart,
        selfReviewEnd: input.selfReviewEnd,
        managerReviewStart: input.managerReviewStart,
        managerReviewEnd: input.managerReviewEnd,
        calibrationStart: input.calibrationStart,
        calibrationEnd: input.calibrationEnd,
        goalWeight: input.goalWeight ?? 40,
        competencyWeight: input.competencyWeight ?? 30,
        valuesWeight: input.valuesWeight ?? 20,
        feedbackWeight: input.feedbackWeight ?? 10,
        allowSelfReview: input.allowSelfReview ?? true,
        allow360Feedback: input.allow360Feedback ?? true,
        requireCalibration: input.requireCalibration ?? true,
        createdById,
        status: ReviewCycleStatus.DRAFT,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Get review cycle by ID
   */
  async getById(id: string) {
    const cycle = await db.reviewCycle.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: {
          select: {
            goals: true,
            reviews: true,
            calibrationSessions: true,
          },
        },
      },
    });

    if (!cycle) {
      throw new Error("Review cycle not found");
    }

    return cycle;
  }

  /**
   * List review cycles
   */
  async list(
    filters: ReviewCycleFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.ReviewCycleWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.year) {
      where.year = filters.year;
    }

    if (filters.cycleType?.length) {
      where.cycleType = { in: filters.cycleType };
    }

    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    const [cycles, total] = await Promise.all([
      db.reviewCycle.findMany({
        where,
        orderBy: [{ year: "desc" }, { startDate: "desc" }],
        skip,
        take: pageSize,
        include: {
          _count: {
            select: { reviews: true },
          },
        },
      }),
      db.reviewCycle.count({ where }),
    ]);

    return {
      data: cycles,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get active review cycles
   */
  async getActive() {
    return db.reviewCycle.findMany({
      where: {
        tenantId: this.tenantId,
        status: {
          in: [
            ReviewCycleStatus.GOAL_SETTING,
            ReviewCycleStatus.IN_PROGRESS,
            ReviewCycleStatus.SELF_REVIEW,
            ReviewCycleStatus.MANAGER_REVIEW,
            ReviewCycleStatus.CALIBRATION,
          ],
        },
      },
      orderBy: { startDate: "desc" },
    });
  }

  /**
   * Get current phase info
   */
  async getCurrentPhase(id: string) {
    const cycle = await this.getById(id);
    const now = new Date();

    let currentPhase = "UNKNOWN";
    let phaseStart: Date | null = null;
    let phaseEnd: Date | null = null;

    if (cycle.goalSettingStart && cycle.goalSettingEnd) {
      if (now >= cycle.goalSettingStart && now <= cycle.goalSettingEnd) {
        currentPhase = "GOAL_SETTING";
        phaseStart = cycle.goalSettingStart;
        phaseEnd = cycle.goalSettingEnd;
      }
    }

    if (cycle.selfReviewStart && cycle.selfReviewEnd) {
      if (now >= cycle.selfReviewStart && now <= cycle.selfReviewEnd) {
        currentPhase = "SELF_REVIEW";
        phaseStart = cycle.selfReviewStart;
        phaseEnd = cycle.selfReviewEnd;
      }
    }

    if (cycle.managerReviewStart && cycle.managerReviewEnd) {
      if (now >= cycle.managerReviewStart && now <= cycle.managerReviewEnd) {
        currentPhase = "MANAGER_REVIEW";
        phaseStart = cycle.managerReviewStart;
        phaseEnd = cycle.managerReviewEnd;
      }
    }

    if (cycle.calibrationStart && cycle.calibrationEnd) {
      if (now >= cycle.calibrationStart && now <= cycle.calibrationEnd) {
        currentPhase = "CALIBRATION";
        phaseStart = cycle.calibrationStart;
        phaseEnd = cycle.calibrationEnd;
      }
    }

    return {
      cycle,
      currentPhase,
      phaseStart,
      phaseEnd,
      daysRemaining: phaseEnd
        ? Math.ceil(
            (phaseEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          )
        : null,
    };
  }

  /**
   * Update review cycle
   */
  async update(id: string, input: Partial<CreateReviewCycleInput>) {
    const cycle = await db.reviewCycle.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!cycle) {
      throw new Error("Review cycle not found");
    }

    // Validate weights if any are provided
    if (
      input.goalWeight !== undefined ||
      input.competencyWeight !== undefined ||
      input.valuesWeight !== undefined ||
      input.feedbackWeight !== undefined
    ) {
      const totalWeight =
        (input.goalWeight ?? Number(cycle.goalWeight)) +
        (input.competencyWeight ?? Number(cycle.competencyWeight)) +
        (input.valuesWeight ?? Number(cycle.valuesWeight)) +
        (input.feedbackWeight ?? Number(cycle.feedbackWeight));

      if (totalWeight !== 100) {
        throw new Error("Score weights must sum to 100");
      }
    }

    return db.reviewCycle.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        cycleType: input.cycleType,
        year: input.year,
        startDate: input.startDate,
        endDate: input.endDate,
        goalSettingStart: input.goalSettingStart,
        goalSettingEnd: input.goalSettingEnd,
        selfReviewStart: input.selfReviewStart,
        selfReviewEnd: input.selfReviewEnd,
        managerReviewStart: input.managerReviewStart,
        managerReviewEnd: input.managerReviewEnd,
        calibrationStart: input.calibrationStart,
        calibrationEnd: input.calibrationEnd,
        goalWeight: input.goalWeight,
        competencyWeight: input.competencyWeight,
        valuesWeight: input.valuesWeight,
        feedbackWeight: input.feedbackWeight,
        allowSelfReview: input.allowSelfReview,
        allow360Feedback: input.allow360Feedback,
        requireCalibration: input.requireCalibration,
      },
    });
  }

  /**
   * Update cycle status
   */
  async updateStatus(id: string, status: ReviewCycleStatus) {
    const cycle = await db.reviewCycle.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!cycle) {
      throw new Error("Review cycle not found");
    }

    return db.reviewCycle.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Start the cycle (create reviews for all eligible employees)
   */
  async start(id: string) {
    const cycle = await db.reviewCycle.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { _count: { select: { reviews: true } } },
    });

    if (!cycle) {
      throw new Error("Review cycle not found");
    }

    if (cycle.status !== ReviewCycleStatus.DRAFT) {
      throw new Error("Cycle must be in draft status to start");
    }

    // Get all active employees with managers
    const employees = await db.employee.findMany({
      where: {
        tenantId: this.tenantId,
        status: "ACTIVE",
        directManagerId: { not: null },
      },
      select: { id: true, directManagerId: true },
    });

    // Create reviews for each employee
    const reviewData = employees.map((emp) => ({
      tenantId: this.tenantId,
      reviewCycleId: id,
      employeeId: emp.id,
      managerId: emp.directManagerId!,
      status: ReviewStatus.NOT_STARTED,
    }));

    await db.performanceReview.createMany({
      data: reviewData,
      skipDuplicates: true,
    });

    // Update cycle status
    await db.reviewCycle.update({
      where: { id },
      data: { status: ReviewCycleStatus.GOAL_SETTING },
    });

    return {
      success: true,
      reviewsCreated: reviewData.length,
    };
  }

  /**
   * Move to next phase
   */
  async advancePhase(id: string) {
    const cycle = await db.reviewCycle.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!cycle) {
      throw new Error("Review cycle not found");
    }

    const phaseOrder: ReviewCycleStatus[] = [
      ReviewCycleStatus.DRAFT,
      ReviewCycleStatus.GOAL_SETTING,
      ReviewCycleStatus.IN_PROGRESS,
      ReviewCycleStatus.SELF_REVIEW,
      ReviewCycleStatus.MANAGER_REVIEW,
      ReviewCycleStatus.CALIBRATION,
      ReviewCycleStatus.COMPLETED,
    ];

    const currentIndex = phaseOrder.indexOf(cycle.status);
    if (currentIndex === -1 || currentIndex >= phaseOrder.length - 1) {
      throw new Error("Cannot advance from current phase");
    }

    const nextStatus = phaseOrder[currentIndex + 1];

    return db.reviewCycle.update({
      where: { id },
      data: { status: nextStatus },
    });
  }

  /**
   * Complete the cycle
   */
  async complete(id: string) {
    const cycle = await db.reviewCycle.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!cycle) {
      throw new Error("Review cycle not found");
    }

    // Check all reviews are completed or acknowledged
    const incompleteReviews = await db.performanceReview.count({
      where: {
        reviewCycleId: id,
        status: {
          notIn: [ReviewStatus.COMPLETED, ReviewStatus.ACKNOWLEDGED],
        },
      },
    });

    if (incompleteReviews > 0) {
      throw new Error(
        `Cannot complete cycle. ${incompleteReviews} reviews are still pending.`,
      );
    }

    return db.reviewCycle.update({
      where: { id },
      data: { status: ReviewCycleStatus.COMPLETED },
    });
  }

  /**
   * Cancel the cycle
   */
  async cancel(id: string) {
    return db.reviewCycle.update({
      where: { id },
      data: { status: ReviewCycleStatus.CANCELLED },
    });
  }

  /**
   * Delete cycle (only draft cycles)
   */
  async delete(id: string) {
    const cycle = await db.reviewCycle.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!cycle) {
      throw new Error("Review cycle not found");
    }

    if (cycle.status !== ReviewCycleStatus.DRAFT) {
      throw new Error("Only draft cycles can be deleted");
    }

    await db.reviewCycle.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Get cycle progress
   */
  async getProgress(id: string) {
    const cycle = await this.getById(id);

    const reviews = await db.performanceReview.groupBy({
      by: ["status"],
      where: { reviewCycleId: id },
      _count: true,
    });

    const totalReviews = reviews.reduce((sum, r) => sum + r._count, 0);

    const statusCounts = reviews.reduce(
      (acc, r) => {
        acc[r.status] = r._count;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Calculate completion percentage
    const completed =
      (statusCounts[ReviewStatus.COMPLETED] || 0) +
      (statusCounts[ReviewStatus.ACKNOWLEDGED] || 0);
    const completionRate =
      totalReviews > 0 ? Math.round((completed / totalReviews) * 100) : 0;

    return {
      cycle,
      totalReviews,
      statusBreakdown: statusCounts,
      completionRate,
    };
  }

  /**
   * Get cycle statistics
   */
  async getStats() {
    const [total, byStatus, byYear] = await Promise.all([
      db.reviewCycle.count({ where: { tenantId: this.tenantId } }),

      db.reviewCycle.groupBy({
        by: ["status"],
        where: { tenantId: this.tenantId },
        _count: true,
      }),

      db.reviewCycle.groupBy({
        by: ["year"],
        where: { tenantId: this.tenantId },
        _count: true,
        orderBy: { year: "desc" },
        take: 5,
      }),
    ]);

    return {
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byYear: byYear.map((y) => ({ year: y.year, count: y._count })),
    };
  }
}

// Factory function
export function createReviewCycleService(tenantId: string): ReviewCycleService {
  return new ReviewCycleService(tenantId);
}
