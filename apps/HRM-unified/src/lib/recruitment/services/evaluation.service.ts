// src/lib/recruitment/services/evaluation.service.ts
// Evaluation Service - Manage candidate evaluations and feedback

import { db } from "@/lib/db";
import { Prisma } from ".prisma/hrm-unified-client";

// Types
export interface CreateEvaluationInput {
  applicationId: string;
  interviewId?: string;
  technicalSkills?: number;
  communication?: number;
  problemSolving?: number;
  cultureFit?: number;
  experience?: number;
  overallRating: number;
  strengths?: string;
  weaknesses?: string;
  notes?: string;
  recommendation: string;
}

export interface UpdateEvaluationInput extends Partial<CreateEvaluationInput> {}

export interface EvaluationFilters {
  applicationId?: string;
  interviewId?: string;
  evaluatorId?: string;
  recommendation?: string[];
  minRating?: number;
  maxRating?: number;
}

// Recommendation options
export const RECOMMENDATIONS = {
  STRONG_HIRE: "STRONG_HIRE",
  HIRE: "HIRE",
  NO_HIRE: "NO_HIRE",
  STRONG_NO_HIRE: "STRONG_NO_HIRE",
} as const;

// Rating criteria
export const RATING_CRITERIA = [
  {
    key: "technicalSkills",
    label: "Technical Skills",
    description: "Technical knowledge and abilities",
  },
  {
    key: "communication",
    label: "Communication",
    description: "Verbal and written communication skills",
  },
  {
    key: "problemSolving",
    label: "Problem Solving",
    description: "Analytical and problem-solving abilities",
  },
  {
    key: "cultureFit",
    label: "Culture Fit",
    description: "Alignment with company values and culture",
  },
  {
    key: "experience",
    label: "Experience",
    description: "Relevant work experience",
  },
];

export class EvaluationService {
  constructor(private tenantId: string) {}

  /**
   * Create a new evaluation
   */
  async create(evaluatorId: string, input: CreateEvaluationInput) {
    // Verify application exists
    const application = await db.application.findFirst({
      where: {
        id: input.applicationId,
        tenantId: this.tenantId,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    // Check if evaluator already submitted for this interview
    if (input.interviewId) {
      const existing = await db.candidateEvaluation.findUnique({
        where: {
          applicationId_interviewId_evaluatorId: {
            applicationId: input.applicationId,
            interviewId: input.interviewId,
            evaluatorId,
          },
        },
      });

      if (existing) {
        throw new Error(
          "You have already submitted an evaluation for this interview",
        );
      }
    }

    const evaluation = await db.candidateEvaluation.create({
      data: {
        tenantId: this.tenantId,
        applicationId: input.applicationId,
        interviewId: input.interviewId,
        evaluatorId,
        technicalSkills: input.technicalSkills,
        communication: input.communication,
        problemSolving: input.problemSolving,
        cultureFit: input.cultureFit,
        experience: input.experience,
        overallRating: input.overallRating,
        strengths: input.strengths,
        weaknesses: input.weaknesses,
        notes: input.notes,
        recommendation: input.recommendation,
      },
      include: {
        evaluator: {
          select: { id: true, name: true, email: true },
        },
        interview: {
          select: { id: true, interviewType: true, round: true },
        },
      },
    });

    // Update application overall rating
    await this.updateApplicationRating(input.applicationId);

    // Create activity
    await db.applicationActivity.create({
      data: {
        applicationId: input.applicationId,
        action: "EVALUATION_SUBMITTED",
        description: `Evaluation submitted with recommendation: ${input.recommendation}`,
        performedById: evaluatorId,
      },
    });

    return evaluation;
  }

  /**
   * Get evaluation by ID
   */
  async getById(id: string) {
    const evaluation = await db.candidateEvaluation.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        evaluator: {
          select: { id: true, name: true, email: true },
        },
        application: {
          include: {
            candidate: {
              select: { id: true, fullName: true, email: true },
            },
            requisition: {
              select: { id: true, title: true },
            },
          },
        },
        interview: {
          select: {
            id: true,
            interviewType: true,
            round: true,
            scheduledAt: true,
          },
        },
      },
    });

    if (!evaluation) {
      throw new Error("Evaluation not found");
    }

    return evaluation;
  }

  /**
   * List evaluations with filters
   */
  async list(
    filters: EvaluationFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.CandidateEvaluationWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.applicationId) {
      where.applicationId = filters.applicationId;
    }

    if (filters.interviewId) {
      where.interviewId = filters.interviewId;
    }

    if (filters.evaluatorId) {
      where.evaluatorId = filters.evaluatorId;
    }

    if (filters.recommendation?.length) {
      where.recommendation = { in: filters.recommendation };
    }

    if (filters.minRating !== undefined) {
      where.overallRating = { gte: filters.minRating };
    }

    if (filters.maxRating !== undefined) {
      where.overallRating = {
        ...((where.overallRating as object) || {}),
        lte: filters.maxRating,
      };
    }

    const [evaluations, total] = await Promise.all([
      db.candidateEvaluation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          evaluator: {
            select: { id: true, name: true },
          },
          application: {
            include: {
              candidate: {
                select: { id: true, fullName: true },
              },
            },
          },
          interview: {
            select: { id: true, interviewType: true, round: true },
          },
        },
      }),
      db.candidateEvaluation.count({ where }),
    ]);

    return {
      data: evaluations,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get evaluations for an application
   */
  async getByApplication(applicationId: string) {
    const evaluations = await db.candidateEvaluation.findMany({
      where: {
        applicationId,
        tenantId: this.tenantId,
      },
      orderBy: { createdAt: "asc" },
      include: {
        evaluator: {
          select: { id: true, name: true, email: true },
        },
        interview: {
          select: {
            id: true,
            interviewType: true,
            round: true,
            scheduledAt: true,
          },
        },
      },
    });

    // Calculate summary
    const summary = this.calculateSummary(evaluations);

    return {
      evaluations,
      summary,
    };
  }

  /**
   * Get evaluations for an interview
   */
  async getByInterview(interviewId: string) {
    const evaluations = await db.candidateEvaluation.findMany({
      where: {
        interviewId,
        tenantId: this.tenantId,
      },
      include: {
        evaluator: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    const summary = this.calculateSummary(evaluations);

    return {
      evaluations,
      summary,
    };
  }

  /**
   * Update an evaluation
   */
  async update(id: string, evaluatorId: string, input: UpdateEvaluationInput) {
    const evaluation = await db.candidateEvaluation.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
        evaluatorId, // Only evaluator can update their own evaluation
      },
    });

    if (!evaluation) {
      throw new Error(
        "Evaluation not found or you do not have permission to update",
      );
    }

    const updated = await db.candidateEvaluation.update({
      where: { id },
      data: {
        technicalSkills: input.technicalSkills,
        communication: input.communication,
        problemSolving: input.problemSolving,
        cultureFit: input.cultureFit,
        experience: input.experience,
        overallRating:
          input.overallRating !== undefined ? input.overallRating : undefined,
        strengths: input.strengths,
        weaknesses: input.weaknesses,
        notes: input.notes,
        recommendation: input.recommendation,
      },
      include: {
        evaluator: {
          select: { id: true, name: true },
        },
      },
    });

    // Update application overall rating
    await this.updateApplicationRating(evaluation.applicationId);

    return updated;
  }

  /**
   * Delete an evaluation
   */
  async delete(id: string, evaluatorId: string) {
    const evaluation = await db.candidateEvaluation.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
        evaluatorId,
      },
    });

    if (!evaluation) {
      throw new Error(
        "Evaluation not found or you do not have permission to delete",
      );
    }

    await db.candidateEvaluation.delete({ where: { id } });

    // Update application overall rating
    await this.updateApplicationRating(evaluation.applicationId);

    return { success: true };
  }

  /**
   * Get pending evaluations for an evaluator
   */
  async getPendingForEvaluator(evaluatorId: string) {
    // Get interviews where this user is an interviewer but hasn't submitted evaluation
    const interviews = await db.interview.findMany({
      where: {
        tenantId: this.tenantId,
        interviewerIds: { array_contains: [evaluatorId] },
        scheduledAt: { lt: new Date() }, // Past interviews
        evaluations: {
          none: { evaluatorId },
        },
      },
      orderBy: { scheduledAt: "desc" },
      include: {
        application: {
          include: {
            candidate: {
              select: { id: true, fullName: true, email: true },
            },
            requisition: {
              select: { id: true, title: true },
            },
          },
        },
      },
    });

    return interviews;
  }

  /**
   * Calculate evaluation summary
   */
  private calculateSummary(evaluations: any[]) {
    if (evaluations.length === 0) {
      return null;
    }

    const avgRating =
      evaluations.reduce((sum, e) => sum + Number(e.overallRating), 0) /
      evaluations.length;

    const avgCriteria = {
      technicalSkills: this.avgField(evaluations, "technicalSkills"),
      communication: this.avgField(evaluations, "communication"),
      problemSolving: this.avgField(evaluations, "problemSolving"),
      cultureFit: this.avgField(evaluations, "cultureFit"),
      experience: this.avgField(evaluations, "experience"),
    };

    const recommendationCounts = evaluations.reduce(
      (acc, e) => {
        acc[e.recommendation] = (acc[e.recommendation] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Determine overall recommendation
    const hireVotes =
      (recommendationCounts.STRONG_HIRE || 0) +
      (recommendationCounts.HIRE || 0);
    const noHireVotes =
      (recommendationCounts.STRONG_NO_HIRE || 0) +
      (recommendationCounts.NO_HIRE || 0);
    const overallRecommendation =
      hireVotes > noHireVotes
        ? "HIRE"
        : noHireVotes > hireVotes
          ? "NO_HIRE"
          : "UNDECIDED";

    return {
      totalEvaluations: evaluations.length,
      averageRating: Math.round(avgRating * 10) / 10,
      criteriaAverages: avgCriteria,
      recommendationCounts,
      overallRecommendation,
    };
  }

  /**
   * Calculate average for a field
   */
  private avgField(evaluations: any[], field: string): number | null {
    const values = evaluations
      .filter((e) => e[field] !== null)
      .map((e) => e[field]);
    if (values.length === 0) return null;
    return (
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    );
  }

  /**
   * Update application overall rating
   */
  private async updateApplicationRating(applicationId: string) {
    const evaluations = await db.candidateEvaluation.findMany({
      where: { applicationId },
    });

    if (evaluations.length === 0) {
      await db.application.update({
        where: { id: applicationId },
        data: { overallRating: null },
      });
      return;
    }

    const avgRating =
      evaluations.reduce((sum, e) => sum + Number(e.overallRating), 0) /
      evaluations.length;

    await db.application.update({
      where: { id: applicationId },
      data: { overallRating: Math.round(avgRating * 10) / 10 },
    });
  }

  /**
   * Get evaluation statistics
   */
  async getStats(dateRange?: { from: Date; to: Date }) {
    const where: Prisma.CandidateEvaluationWhereInput = {
      tenantId: this.tenantId,
    };

    if (dateRange) {
      where.createdAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    const [total, byRecommendation, topEvaluators] = await Promise.all([
      db.candidateEvaluation.count({ where }),

      db.candidateEvaluation.groupBy({
        by: ["recommendation"],
        where,
        _count: true,
      }),

      db.candidateEvaluation.groupBy({
        by: ["evaluatorId"],
        where,
        _count: true,
        orderBy: { _count: { evaluatorId: "desc" } },
        take: 10,
      }),
    ]);

    // Get evaluator names
    const evaluatorIds = topEvaluators.map((e) => e.evaluatorId);
    const evaluators = await db.user.findMany({
      where: { id: { in: evaluatorIds } },
      select: { id: true, name: true },
    });
    const evaluatorMap = new Map(evaluators.map((e) => [e.id, e.name]));

    return {
      total,
      byRecommendation: byRecommendation.map((r) => ({
        recommendation: r.recommendation,
        count: r._count,
      })),
      topEvaluators: topEvaluators.map((e) => ({
        evaluatorId: e.evaluatorId,
        evaluatorName: evaluatorMap.get(e.evaluatorId) || "Unknown",
        count: e._count,
      })),
    };
  }
}

// Factory function
export function createEvaluationService(tenantId: string): EvaluationService {
  return new EvaluationService(tenantId);
}
