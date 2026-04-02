// src/lib/performance/services/feedback.service.ts
// Feedback Service - 360 Feedback and Recognition

import { db } from "@/lib/db";
import {
  FeedbackType,
  FeedbackRequestStatus,
  Prisma,
} from ".prisma/hrm-unified-client";

// Types
export interface RequestFeedbackInput {
  reviewId?: string;
  subjectId: string;
  providerId: string;
  feedbackType: FeedbackType;
  dueDate?: Date;
  questions?: Record<string, string>[];
}

export interface SubmitFeedbackInput {
  overallRating?: number;
  ratings?: Record<string, number>;
  strengths?: string;
  areasForImprovement?: string;
  comments?: string;
  isAnonymous?: boolean;
}

export interface GiveRecognitionInput {
  subjectId: string;
  recognitionType: string;
  comments: string;
  isPublic?: boolean;
}

export interface FeedbackFilters {
  subjectId?: string;
  providerId?: string;
  feedbackType?: FeedbackType[];
  status?: FeedbackRequestStatus[];
  reviewId?: string;
}

export class FeedbackService {
  constructor(private tenantId: string) {}

  // ===== FEEDBACK REQUESTS =====

  /**
   * Request feedback from someone
   */
  async requestFeedback(requesterId: string, input: RequestFeedbackInput) {
    // Verify subject exists
    const subject = await db.employee.findFirst({
      where: { id: input.subjectId, tenantId: this.tenantId },
    });

    if (!subject) {
      throw new Error("Subject employee not found");
    }

    // Verify provider exists
    const provider = await db.user.findUnique({
      where: { id: input.providerId },
    });

    if (!provider) {
      throw new Error("Feedback provider not found");
    }

    // Check for existing pending request
    const existing = await db.feedbackRequest.findFirst({
      where: {
        tenantId: this.tenantId,
        subjectId: input.subjectId,
        providerId: input.providerId,
        reviewId: input.reviewId,
        status: FeedbackRequestStatus.REQUESTED,
      },
    });

    if (existing) {
      throw new Error(
        "Pending feedback request already exists for this provider",
      );
    }

    return db.feedbackRequest.create({
      data: {
        tenantId: this.tenantId,
        reviewId: input.reviewId,
        requesterId,
        providerId: input.providerId,
        subjectId: input.subjectId,
        feedbackType: input.feedbackType,
        dueDate: input.dueDate,
        questions: input.questions as unknown as Prisma.InputJsonValue,
        status: FeedbackRequestStatus.REQUESTED,
      },
      include: {
        provider: { select: { id: true, name: true, email: true } },
        subject: { select: { id: true, fullName: true } },
      },
    });
  }

  /**
   * Request feedback from multiple people
   */
  async requestBulkFeedback(
    requesterId: string,
    subjectId: string,
    providerIds: string[],
    input: {
      reviewId?: string;
      feedbackType: FeedbackType;
      dueDate?: Date;
      questions?: Record<string, string>[];
    },
  ) {
    const results = [];

    for (const providerId of providerIds) {
      try {
        const request = await this.requestFeedback(requesterId, {
          ...input,
          subjectId,
          providerId,
        });
        results.push({ providerId, success: true, request });
      } catch (error) {
        results.push({
          providerId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      total: providerIds.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * Get feedback request by ID
   */
  async getRequestById(id: string) {
    const request = await db.feedbackRequest.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        requester: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
        subject: { select: { id: true, fullName: true } },
        review: { select: { id: true, reviewCycleId: true } },
        response: true,
      },
    });

    if (!request) {
      throw new Error("Feedback request not found");
    }

    return request;
  }

  /**
   * List feedback requests
   */
  async listRequests(
    filters: FeedbackFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.FeedbackRequestWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.subjectId) {
      where.subjectId = filters.subjectId;
    }

    if (filters.providerId) {
      where.providerId = filters.providerId;
    }

    if (filters.feedbackType?.length) {
      where.feedbackType = { in: filters.feedbackType };
    }

    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    if (filters.reviewId) {
      where.reviewId = filters.reviewId;
    }

    const [requests, total] = await Promise.all([
      db.feedbackRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip,
        take: pageSize,
        include: {
          requester: { select: { id: true, name: true } },
          provider: { select: { id: true, name: true } },
          subject: { select: { id: true, fullName: true } },
          response: { select: { id: true, overallRating: true } },
        },
      }),
      db.feedbackRequest.count({ where }),
    ]);

    return {
      data: requests,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get pending requests for a provider
   */
  async getPendingForProvider(providerId: string) {
    return db.feedbackRequest.findMany({
      where: {
        tenantId: this.tenantId,
        providerId,
        status: FeedbackRequestStatus.REQUESTED,
      },
      orderBy: [{ dueDate: "asc" }, { requestedAt: "desc" }],
      include: {
        subject: { select: { id: true, fullName: true } },
        requester: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Decline feedback request
   */
  async declineRequest(requestId: string, providerId: string) {
    const request = await db.feedbackRequest.findFirst({
      where: {
        id: requestId,
        tenantId: this.tenantId,
        providerId,
      },
    });

    if (!request) {
      throw new Error("Feedback request not found");
    }

    if (request.status !== FeedbackRequestStatus.REQUESTED) {
      throw new Error("Request is no longer pending");
    }

    return db.feedbackRequest.update({
      where: { id: requestId },
      data: { status: FeedbackRequestStatus.DECLINED },
    });
  }

  /**
   * Cancel feedback request
   */
  async cancelRequest(requestId: string) {
    return db.feedbackRequest.update({
      where: { id: requestId },
      data: { status: FeedbackRequestStatus.DECLINED },
    });
  }

  // ===== FEEDBACK RESPONSES =====

  /**
   * Submit feedback response
   */
  async submitFeedback(
    requestId: string,
    providerId: string,
    input: SubmitFeedbackInput,
  ) {
    const request = await db.feedbackRequest.findFirst({
      where: {
        id: requestId,
        tenantId: this.tenantId,
        providerId,
      },
    });

    if (!request) {
      throw new Error("Feedback request not found");
    }

    if (request.status !== FeedbackRequestStatus.REQUESTED) {
      throw new Error("Request is no longer pending");
    }

    // Create feedback response
    const feedback = await db.feedback.create({
      data: {
        tenantId: this.tenantId,
        requestId,
        providerId,
        subjectId: request.subjectId,
        feedbackType: request.feedbackType,
        overallRating: input.overallRating,
        ratings: input.ratings as unknown as Prisma.InputJsonValue,
        strengths: input.strengths,
        areasForImprovement: input.areasForImprovement,
        comments: input.comments,
        isAnonymous: input.isAnonymous ?? false,
      },
      include: {
        subject: { select: { id: true, fullName: true } },
      },
    });

    // Update request status
    await db.feedbackRequest.update({
      where: { id: requestId },
      data: {
        status: FeedbackRequestStatus.SUBMITTED,
        respondedAt: new Date(),
      },
    });

    return feedback;
  }

  /**
   * Give direct feedback/recognition (without request)
   */
  async giveFeedback(providerId: string, input: GiveRecognitionInput) {
    // Verify subject exists
    const subject = await db.employee.findFirst({
      where: { id: input.subjectId, tenantId: this.tenantId },
    });

    if (!subject) {
      throw new Error("Subject employee not found");
    }

    return db.feedback.create({
      data: {
        tenantId: this.tenantId,
        providerId,
        subjectId: input.subjectId,
        feedbackType: FeedbackType.PEER,
        recognitionType: input.recognitionType,
        comments: input.comments,
        isPublic: input.isPublic ?? false,
        isAnonymous: false,
      },
      include: {
        provider: { select: { id: true, name: true } },
        subject: { select: { id: true, fullName: true } },
      },
    });
  }

  /**
   * Get feedback received by an employee
   */
  async getFeedbackForEmployee(
    subjectId: string,
    options?: {
      feedbackType?: FeedbackType[];
      includeAnonymous?: boolean;
    },
  ) {
    const where: Prisma.FeedbackWhereInput = {
      tenantId: this.tenantId,
      subjectId,
    };

    if (options?.feedbackType?.length) {
      where.feedbackType = { in: options.feedbackType };
    }

    const feedbacks = await db.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        provider: { select: { id: true, name: true } },
        request: {
          select: { id: true, reviewId: true },
        },
      },
    });

    // Filter anonymous if not allowed
    return feedbacks.map((f) => {
      if (f.isAnonymous && !options?.includeAnonymous) {
        return {
          ...f,
          providerId: null,
          provider: null,
        };
      }
      return f;
    });
  }

  /**
   * Get feedback given by a user
   */
  async getFeedbackByProvider(providerId: string) {
    return db.feedback.findMany({
      where: {
        tenantId: this.tenantId,
        providerId,
      },
      orderBy: { createdAt: "desc" },
      include: {
        subject: { select: { id: true, fullName: true } },
      },
    });
  }

  /**
   * Get public recognitions
   */
  async getPublicRecognitions(limit: number = 20) {
    return db.feedback.findMany({
      where: {
        tenantId: this.tenantId,
        isPublic: true,
        recognitionType: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        provider: { select: { id: true, name: true } },
        subject: { select: { id: true, fullName: true } },
      },
    });
  }

  // ===== 360 FEEDBACK SUMMARY =====

  /**
   * Get 360 feedback summary for a review
   */
  async get360Summary(reviewId: string) {
    const requests = await db.feedbackRequest.findMany({
      where: {
        tenantId: this.tenantId,
        reviewId,
      },
      include: {
        response: true,
        provider: { select: { id: true, name: true } },
      },
    });

    const completed = requests.filter((r) => r.response);
    const pending = requests.filter(
      (r) => !r.response && r.status === FeedbackRequestStatus.REQUESTED,
    );
    const declined = requests.filter(
      (r) => r.status === FeedbackRequestStatus.DECLINED,
    );

    // Calculate averages
    let avgRating = 0;
    const ratingsByCategory: Record<string, number[]> = {};

    completed.forEach((r) => {
      if (r.response?.overallRating) {
        avgRating += r.response.overallRating;
      }
      if (r.response?.ratings) {
        const ratings = r.response.ratings as Record<string, number>;
        Object.entries(ratings).forEach(([key, value]) => {
          if (!ratingsByCategory[key]) {
            ratingsByCategory[key] = [];
          }
          ratingsByCategory[key].push(value);
        });
      }
    });

    const categoryAverages = Object.entries(ratingsByCategory).reduce(
      (acc, [key, values]) => {
        acc[key] =
          values.length > 0
            ? Math.round(
                (values.reduce((a, b) => a + b, 0) / values.length) * 10,
              ) / 10
            : 0;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalRequested: requests.length,
      completed: completed.length,
      pending: pending.length,
      declined: declined.length,
      completionRate:
        requests.length > 0
          ? Math.round((completed.length / requests.length) * 100)
          : 0,
      averageRating:
        completed.length > 0
          ? Math.round((avgRating / completed.length) * 10) / 10
          : null,
      categoryAverages,
      feedbacks: completed.map((r) => ({
        feedbackType: r.feedbackType,
        overallRating: r.response?.overallRating,
        ratings: r.response?.ratings,
        strengths: r.response?.strengths,
        areasForImprovement: r.response?.areasForImprovement,
        comments: r.response?.comments,
        isAnonymous: r.response?.isAnonymous,
        provider: r.response?.isAnonymous ? null : r.provider,
      })),
    };
  }

  // ===== STATISTICS =====

  /**
   * Get feedback statistics
   */
  async getStats(dateRange?: { from: Date; to: Date }) {
    const where: Prisma.FeedbackWhereInput = {
      tenantId: this.tenantId,
    };

    if (dateRange) {
      where.createdAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    const [totalFeedback, byType, avgRating, topRecognized] = await Promise.all(
      [
        db.feedback.count({ where }),

        db.feedback.groupBy({
          by: ["feedbackType"],
          where,
          _count: true,
        }),

        db.feedback.aggregate({
          where: { ...where, overallRating: { not: null } },
          _avg: { overallRating: true },
        }),

        // Top recognized employees
        db.feedback.groupBy({
          by: ["subjectId"],
          where: { ...where, recognitionType: { not: null } },
          _count: true,
          orderBy: { _count: { subjectId: "desc" } },
          take: 10,
        }),
      ],
    );

    // Get employee names for top recognized
    const employeeIds = topRecognized.map((r) => r.subjectId);
    const employees = await db.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, fullName: true },
    });
    const employeeMap = new Map(employees.map((e) => [e.id, e.fullName]));

    return {
      totalFeedback,
      byType: byType.map((t) => ({ type: t.feedbackType, count: t._count })),
      averageRating: avgRating._avg.overallRating || 0,
      topRecognized: topRecognized.map((r) => ({
        employeeId: r.subjectId,
        employeeName: employeeMap.get(r.subjectId) || "Unknown",
        recognitionCount: r._count,
      })),
    };
  }

  /**
   * Get request completion stats
   */
  async getRequestStats() {
    const [total, byStatus, overdue] = await Promise.all([
      db.feedbackRequest.count({
        where: { tenantId: this.tenantId },
      }),

      db.feedbackRequest.groupBy({
        by: ["status"],
        where: { tenantId: this.tenantId },
        _count: true,
      }),

      db.feedbackRequest.count({
        where: {
          tenantId: this.tenantId,
          status: FeedbackRequestStatus.REQUESTED,
          dueDate: { lt: new Date() },
        },
      }),
    ]);

    return {
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      overdue,
      completionRate:
        total > 0
          ? Math.round(
              ((byStatus.find(
                (s) => s.status === FeedbackRequestStatus.SUBMITTED,
              )?._count || 0) /
                total) *
                100,
            )
          : 0,
    };
  }
}

// Factory function
export function createFeedbackService(tenantId: string): FeedbackService {
  return new FeedbackService(tenantId);
}
