// src/lib/learning/services/assessment.service.ts
// Assessment Service - Manage course assessments, quizzes, and grading

import { db } from "@/lib/db";
import { AssessmentType, QuestionType, Prisma } from ".prisma/hrm-ai-client";

// Types
export interface CreateAssessmentInput {
  courseId?: string;
  title: string;
  description?: string;
  instructions?: string;
  assessmentType: AssessmentType;
  timeLimitMinutes?: number;
  passingScore: number;
  totalPoints: number;
  maxAttempts?: number;
  availableFrom?: Date;
  availableUntil?: Date;
  shuffleQuestions?: boolean;
  showCorrectAnswers?: boolean;
}

export interface CreateQuestionInput {
  questionText: string;
  questionType: QuestionType;
  options?: { id: string; text: string }[];
  correctAnswer?: string;
  points: number;
  explanation?: string;
  order?: number;
}

export interface SubmitResponseInput {
  questionId: string;
  response?: string;
  selectedOptions?: string[];
}

export interface AssessmentFilters {
  courseId?: string;
  assessmentType?: AssessmentType[];
  isActive?: boolean;
  search?: string;
}

export class AssessmentService {
  constructor(private tenantId: string) {}

  // ===== ASSESSMENTS =====

  /**
   * Create an assessment
   */
  async create(createdById: string, input: CreateAssessmentInput) {
    return db.assessment.create({
      data: {
        tenantId: this.tenantId,
        courseId: input.courseId,
        title: input.title,
        description: input.description,
        instructions: input.instructions,
        assessmentType: input.assessmentType,
        timeLimitMinutes: input.timeLimitMinutes,
        passingScore: input.passingScore,
        totalPoints: input.totalPoints,
        maxAttempts: input.maxAttempts ?? 1,
        availableFrom: input.availableFrom,
        availableUntil: input.availableUntil,
        shuffleQuestions: input.shuffleQuestions ?? false,
        showCorrectAnswers: input.showCorrectAnswers ?? true,
        createdById,
      },
      include: {
        course: { select: { id: true, title: true, code: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Get assessment by ID
   */
  async getById(id: string) {
    const assessment = await db.assessment.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        course: { select: { id: true, title: true, code: true } },
        createdBy: { select: { id: true, name: true } },
        questions: {
          orderBy: { order: "asc" },
        },
        _count: {
          select: { attempts: true },
        },
      },
    });

    if (!assessment) {
      throw new Error("Assessment not found");
    }

    return assessment;
  }

  /**
   * Get assessment for taking (without correct answers)
   */
  async getForAttempt(id: string, employeeId: string) {
    const assessment = await this.getById(id);

    // Check if active and available
    if (!assessment.isActive) {
      throw new Error("Assessment is not active");
    }

    const now = new Date();
    if (assessment.availableFrom && now < assessment.availableFrom) {
      throw new Error("Assessment is not yet available");
    }
    if (assessment.availableUntil && now > assessment.availableUntil) {
      throw new Error("Assessment is no longer available");
    }

    // Check attempts limit
    const attemptCount = await db.assessmentAttempt.count({
      where: {
        assessmentId: id,
        employeeId,
      },
    });

    if (attemptCount >= assessment.maxAttempts) {
      throw new Error("Maximum attempts reached");
    }

    // Remove correct answers from questions
    const questions = assessment.questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      options: q.options,
      points: q.points,
      order: q.order,
    }));

    // Shuffle if needed
    if (assessment.shuffleQuestions) {
      for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
      }
    }

    return {
      id: assessment.id,
      title: assessment.title,
      description: assessment.description,
      instructions: assessment.instructions,
      assessmentType: assessment.assessmentType,
      timeLimitMinutes: assessment.timeLimitMinutes,
      totalPoints: assessment.totalPoints,
      questions,
      attemptNumber: attemptCount + 1,
      maxAttempts: assessment.maxAttempts,
    };
  }

  /**
   * List assessments
   */
  async list(
    filters: AssessmentFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.AssessmentWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.courseId) {
      where.courseId = filters.courseId;
    }

    if (filters.assessmentType?.length) {
      where.assessmentType = { in: filters.assessmentType };
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const [assessments, total] = await Promise.all([
      db.assessment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          course: { select: { id: true, title: true } },
          _count: {
            select: { questions: true, attempts: true },
          },
        },
      }),
      db.assessment.count({ where }),
    ]);

    return {
      data: assessments,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Update assessment
   */
  async update(id: string, input: Partial<CreateAssessmentInput>) {
    const assessment = await db.assessment.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!assessment) {
      throw new Error("Assessment not found");
    }

    return db.assessment.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        instructions: input.instructions,
        assessmentType: input.assessmentType,
        timeLimitMinutes: input.timeLimitMinutes,
        passingScore: input.passingScore,
        totalPoints: input.totalPoints,
        maxAttempts: input.maxAttempts,
        availableFrom: input.availableFrom,
        availableUntil: input.availableUntil,
        shuffleQuestions: input.shuffleQuestions,
        showCorrectAnswers: input.showCorrectAnswers,
      },
    });
  }

  /**
   * Activate/Deactivate assessment
   */
  async setActive(id: string, isActive: boolean) {
    return db.assessment.update({
      where: { id },
      data: { isActive },
    });
  }

  /**
   * Delete assessment
   */
  async delete(id: string) {
    const assessment = await db.assessment.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { _count: { select: { attempts: true } } },
    });

    if (!assessment) {
      throw new Error("Assessment not found");
    }

    if (assessment._count.attempts > 0) {
      throw new Error("Cannot delete assessment with attempts");
    }

    await db.assessment.delete({ where: { id } });
    return { success: true };
  }

  // ===== QUESTIONS =====

  /**
   * Add question to assessment
   */
  async addQuestion(assessmentId: string, input: CreateQuestionInput) {
    const assessment = await db.assessment.findFirst({
      where: { id: assessmentId, tenantId: this.tenantId },
    });

    if (!assessment) {
      throw new Error("Assessment not found");
    }

    // Get max order
    const lastQuestion = await db.assessmentQuestion.findFirst({
      where: { assessmentId },
      orderBy: { order: "desc" },
    });

    const order = input.order ?? (lastQuestion ? lastQuestion.order + 1 : 0);

    return db.assessmentQuestion.create({
      data: {
        assessmentId,
        questionText: input.questionText,
        questionType: input.questionType,
        options: input.options as unknown as Prisma.InputJsonValue,
        correctAnswer: input.correctAnswer,
        points: input.points,
        explanation: input.explanation,
        order,
      },
    });
  }

  /**
   * Update question
   */
  async updateQuestion(
    questionId: string,
    input: Partial<CreateQuestionInput>,
  ) {
    return db.assessmentQuestion.update({
      where: { id: questionId },
      data: {
        questionText: input.questionText,
        questionType: input.questionType,
        options: input.options as unknown as Prisma.InputJsonValue,
        correctAnswer: input.correctAnswer,
        points: input.points,
        explanation: input.explanation,
        order: input.order,
      },
    });
  }

  /**
   * Delete question
   */
  async deleteQuestion(questionId: string) {
    await db.assessmentQuestion.delete({ where: { id: questionId } });
    return { success: true };
  }

  /**
   * Reorder questions
   */
  async reorderQuestions(assessmentId: string, questionIds: string[]) {
    const updates = questionIds.map((id, index) =>
      db.assessmentQuestion.update({
        where: { id },
        data: { order: index },
      }),
    );

    await Promise.all(updates);
    return { success: true };
  }

  // ===== ATTEMPTS =====

  /**
   * Start an assessment attempt
   */
  async startAttempt(
    assessmentId: string,
    employeeId: string,
    enrollmentId?: string,
  ) {
    const assessment = await db.assessment.findFirst({
      where: { id: assessmentId, tenantId: this.tenantId },
    });

    if (!assessment) {
      throw new Error("Assessment not found");
    }

    // Check attempts limit
    const attemptCount = await db.assessmentAttempt.count({
      where: { assessmentId, employeeId },
    });

    if (attemptCount >= assessment.maxAttempts) {
      throw new Error("Maximum attempts reached");
    }

    return db.assessmentAttempt.create({
      data: {
        tenantId: this.tenantId,
        assessmentId,
        employeeId,
        enrollmentId,
        attemptNumber: attemptCount + 1,
        startedAt: new Date(),
      },
      include: {
        assessment: {
          select: { id: true, title: true, timeLimitMinutes: true },
        },
      },
    });
  }

  /**
   * Submit responses for an attempt
   */
  async submitResponses(attemptId: string, responses: SubmitResponseInput[]) {
    const attempt = await db.assessmentAttempt.findFirst({
      where: { id: attemptId, tenantId: this.tenantId },
      include: {
        assessment: {
          include: { questions: true },
        },
      },
    });

    if (!attempt) {
      throw new Error("Attempt not found");
    }

    if (attempt.submittedAt) {
      throw new Error("Attempt already submitted");
    }

    // Check time limit
    if (attempt.assessment.timeLimitMinutes) {
      const timeElapsed = (Date.now() - attempt.startedAt.getTime()) / 60000;
      if (timeElapsed > attempt.assessment.timeLimitMinutes + 1) {
        // 1 minute grace
        throw new Error("Time limit exceeded");
      }
    }

    // Process responses
    const questionMap = new Map(
      attempt.assessment.questions.map((q) => [q.id, q]),
    );
    let totalScore = 0;

    const responseData = responses.map((r) => {
      const question = questionMap.get(r.questionId);
      if (!question) {
        throw new Error(`Question ${r.questionId} not found`);
      }

      // Auto-grade for objective questions
      let isCorrect: boolean | null = null;
      let pointsEarned: number | null = null;

      if (
        [
          QuestionType.SINGLE_CHOICE,
          QuestionType.MULTIPLE_CHOICE,
          QuestionType.TRUE_FALSE,
        ].some((t) => t === question.questionType)
      ) {
        if (
          question.questionType === QuestionType.MULTIPLE_CHOICE &&
          r.selectedOptions
        ) {
          // Compare arrays
          const correct = JSON.parse(question.correctAnswer || "[]");
          isCorrect =
            JSON.stringify(r.selectedOptions.sort()) ===
            JSON.stringify(correct.sort());
        } else {
          isCorrect = r.response === question.correctAnswer;
        }
        pointsEarned = isCorrect ? Number(question.points) : 0;
        totalScore += pointsEarned;
      }

      return {
        attemptId,
        questionId: r.questionId,
        response: r.response,
        selectedOptions: r.selectedOptions as unknown as Prisma.InputJsonValue,
        isCorrect,
        pointsEarned,
      };
    });

    // Create responses
    await db.questionResponse.createMany({
      data: responseData,
    });

    // Calculate final score
    const totalPoints = Number(attempt.assessment.totalPoints);
    const percentageScore =
      totalPoints > 0 ? Math.round((totalScore / totalPoints) * 100) : 0;
    const passingScore = Number(attempt.assessment.passingScore);
    const passed = percentageScore >= passingScore;

    // Check if all questions are graded (no essay/short answer)
    const needsManualGrading = attempt.assessment.questions.some((q) =>
      [QuestionType.ESSAY, QuestionType.SHORT_ANSWER].some(
        (t) => t === q.questionType,
      ),
    );

    const timeSpentMinutes = Math.round(
      (Date.now() - attempt.startedAt.getTime()) / 60000,
    );

    // Update attempt
    const result = await db.assessmentAttempt.update({
      where: { id: attemptId },
      data: {
        submittedAt: new Date(),
        score: needsManualGrading ? null : totalScore,
        percentageScore: needsManualGrading ? null : percentageScore,
        passed: needsManualGrading ? null : passed,
        timeSpentMinutes,
      },
      include: {
        responses: {
          include: {
            question: true,
          },
        },
      },
    });

    return {
      attempt: result,
      score: needsManualGrading ? null : totalScore,
      percentageScore: needsManualGrading ? null : percentageScore,
      passed: needsManualGrading ? null : passed,
      needsManualGrading,
    };
  }

  /**
   * Grade a response manually
   */
  async gradeResponse(
    responseId: string,
    graderId: string,
    pointsEarned: number,
    comments?: string,
  ) {
    const response = await db.questionResponse.findUnique({
      where: { id: responseId },
      include: {
        attempt: {
          include: {
            assessment: true,
            responses: true,
          },
        },
        question: true,
      },
    });

    if (!response) {
      throw new Error("Response not found");
    }

    if (pointsEarned > Number(response.question.points)) {
      throw new Error("Points earned cannot exceed question points");
    }

    // Update response
    await db.questionResponse.update({
      where: { id: responseId },
      data: {
        isCorrect: pointsEarned > 0,
        pointsEarned,
        gradedById: graderId,
        gradedAt: new Date(),
        graderComments: comments,
      },
    });

    // Recalculate attempt score
    const allResponses = await db.questionResponse.findMany({
      where: { attemptId: response.attemptId },
    });

    const allGraded = allResponses.every((r) => r.pointsEarned !== null);

    if (allGraded) {
      const totalScore = allResponses.reduce(
        (sum, r) => sum + Number(r.pointsEarned || 0),
        0,
      );
      const totalPoints = Number(response.attempt.assessment.totalPoints);
      const percentageScore =
        totalPoints > 0 ? Math.round((totalScore / totalPoints) * 100) : 0;
      const passingScore = Number(response.attempt.assessment.passingScore);
      const passed = percentageScore >= passingScore;

      await db.assessmentAttempt.update({
        where: { id: response.attemptId },
        data: {
          score: totalScore,
          percentageScore,
          passed,
        },
      });
    }

    return { success: true };
  }

  /**
   * Get attempt result
   */
  async getAttemptResult(attemptId: string) {
    const attempt = await db.assessmentAttempt.findFirst({
      where: { id: attemptId, tenantId: this.tenantId },
      include: {
        assessment: {
          include: {
            questions: {
              orderBy: { order: "asc" },
            },
          },
        },
        employee: {
          select: { id: true, fullName: true },
        },
        responses: {
          include: {
            question: true,
            gradedBy: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!attempt) {
      throw new Error("Attempt not found");
    }

    // Include correct answers if showCorrectAnswers is true
    if (!attempt.assessment.showCorrectAnswers) {
      attempt.assessment.questions = attempt.assessment.questions.map((q) => ({
        ...q,
        correctAnswer: null,
        explanation: null,
      }));
    }

    return attempt;
  }

  /**
   * Get employee's attempts for an assessment
   */
  async getEmployeeAttempts(assessmentId: string, employeeId: string) {
    return db.assessmentAttempt.findMany({
      where: {
        tenantId: this.tenantId,
        assessmentId,
        employeeId,
      },
      orderBy: { createdAt: "desc" },
      include: {
        assessment: {
          select: { id: true, title: true, passingScore: true },
        },
      },
    });
  }

  /**
   * Get attempts needing grading
   */
  async getPendingGrading() {
    return db.assessmentAttempt.findMany({
      where: {
        tenantId: this.tenantId,
        submittedAt: { not: null },
        passed: null, // Not fully graded
      },
      orderBy: { submittedAt: "asc" },
      include: {
        assessment: {
          select: { id: true, title: true },
        },
        employee: {
          select: { id: true, fullName: true },
        },
        responses: {
          where: { pointsEarned: null },
          include: { question: true },
        },
      },
    });
  }

  /**
   * Get assessment statistics
   */
  async getStats(assessmentId?: string) {
    const where: Prisma.AssessmentAttemptWhereInput = {
      tenantId: this.tenantId,
      submittedAt: { not: null },
    };

    if (assessmentId) {
      where.assessmentId = assessmentId;
    }

    const [totalAttempts, passRate, avgScore] = await Promise.all([
      db.assessmentAttempt.count({ where }),

      db.assessmentAttempt.groupBy({
        by: ["passed"],
        where: { ...where, passed: { not: null } },
        _count: true,
      }),

      db.assessmentAttempt.aggregate({
        where: { ...where, percentageScore: { not: null } },
        _avg: { percentageScore: true },
      }),
    ]);

    const passedCount = passRate.find((p) => p.passed);
    const failedCount = passRate.find((p) => !p.passed);
    const passRatePercent =
      totalAttempts > 0
        ? Math.round(((passedCount?._count || 0) / totalAttempts) * 100)
        : 0;

    return {
      totalAttempts,
      passRate: passRatePercent,
      failRate: 100 - passRatePercent,
      averageScore: avgScore._avg.percentageScore
        ? Math.round(Number(avgScore._avg.percentageScore))
        : 0,
      passed: passedCount?._count || 0,
      failed: failedCount?._count || 0,
    };
  }
}

// Factory function
export function createAssessmentService(tenantId: string): AssessmentService {
  return new AssessmentService(tenantId);
}
