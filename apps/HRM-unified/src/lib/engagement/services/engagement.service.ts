// @ts-nocheck - Prisma models not yet in schema (Phase 6)
// employee-engagement/services/engagement.service.ts

/**
 * LAC VIET HR - Employee Engagement Service
 * Business logic for surveys and engagement management
 */

import { PrismaClient, Prisma } from ".prisma/hrm-unified-client";
import {
  Survey,
  SurveyType,
  SurveyStatus,
  SurveySection,
  SurveyQuestion,
  QuestionType,
  SurveyResponse,
  ResponseStatus,
  QuestionAnswer,
  AnonymityLevel,
  SurveyResults,
  CategoryScore,
  QuestionResult,
  ActionPlan,
  ActionItem,
  ActionStatus,
  ActionPriority,
  EngagementDashboard,
  Recognition,
  PulseConfig,
  PulseResult,
  CreateSurveyDto,
  CreateQuestionDto,
  SubmitAnswersDto,
  CreateActionPlanDto,
  SurveyFilters,
} from "../types/engagement.types";
import { v4 as uuidv4 } from "uuid";

export class EngagementService {
  constructor(private prisma: PrismaClient) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // SURVEYS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createSurvey(
    data: CreateSurveyDto,
    createdBy: string,
  ): Promise<Survey> {
    const code = await this.generateSurveyCode(data.type);

    const survey = await this.prisma.survey.create({
      data: {
        code,
        title: data.title,
        description: data.description,
        type: data.type,
        status: SurveyStatus.DRAFT,
        startDate: data.startDate,
        endDate: data.endDate,
        anonymityLevel: data.anonymityLevel,
        allowPartialSubmission: true,
        showProgressBar: true,
        randomizeQuestions: false,
        randomizeOptions: false,
        targetAudience: data.targetAudience as unknown as Prisma.JsonObject,
        totalQuestions: 0,
        estimatedMinutes: 0,
        totalInvited: 0,
        welcomeMessage: data.welcomeMessage,
        thankYouMessage: data.thankYouMessage,
        includeBenchmark: false,
        responseCount: 0,
        completionRate: 0,
        createdBy,
        ownerId: createdBy,
      },
    });

    return survey as unknown as Survey;
  }

  async updateSurvey(surveyId: string, data: Partial<Survey>): Promise<Survey> {
    const survey = await this.prisma.survey.update({
      where: { id: surveyId },
      data: {
        ...data,
        targetAudience: data.targetAudience as unknown as Prisma.JsonObject,
      },
    });

    return survey as unknown as Survey;
  }

  async publishSurvey(surveyId: string): Promise<Survey> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      include: { sections: { include: { questions: true } } },
    });

    if (!survey) throw new Error("Survey not found");
    if (survey.status !== SurveyStatus.DRAFT)
      throw new Error("Survey is not in draft status");

    // Calculate totals
    const totalQuestions = survey.sections.reduce(
      (sum, s) => sum + s.questions.length,
      0,
    );
    const estimatedMinutes = Math.ceil(totalQuestions * 0.5); // ~30 seconds per question

    // Get eligible employees
    const eligibleCount = await this.getEligibleEmployeeCount(
      survey.targetAudience as any,
    );

    const updated = await this.prisma.survey.update({
      where: { id: surveyId },
      data: {
        status: SurveyStatus.SCHEDULED,
        totalQuestions,
        estimatedMinutes,
        totalInvited: eligibleCount,
        publishedAt: new Date(),
      },
    });

    return updated as unknown as Survey;
  }

  async activateSurvey(surveyId: string): Promise<Survey> {
    const survey = await this.prisma.survey.update({
      where: { id: surveyId },
      data: { status: SurveyStatus.ACTIVE },
    });

    // Create response records for all eligible employees
    await this.createResponseRecords(surveyId);

    return survey as unknown as Survey;
  }

  async closeSurvey(surveyId: string): Promise<Survey> {
    const survey = await this.prisma.survey.update({
      where: { id: surveyId },
      data: {
        status: SurveyStatus.CLOSED,
        closedAt: new Date(),
      },
    });

    // Calculate final results
    await this.calculateSurveyResults(surveyId);

    return survey as unknown as Survey;
  }

  async getSurvey(surveyId: string): Promise<Survey | null> {
    return this.prisma.survey.findUnique({
      where: { id: surveyId },
      include: {
        sections: {
          include: { questions: { orderBy: { order: "asc" } } },
          orderBy: { order: "asc" },
        },
      },
    }) as unknown as Survey;
  }

  async listSurveys(
    filters: SurveyFilters,
    page: number = 1,
    limit: number = 20,
  ) {
    const where: Prisma.SurveyWhereInput = {};

    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.startDateFrom) where.startDate = { gte: filters.startDateFrom };
    if (filters.startDateTo)
      where.startDate = { ...where.startDate, lte: filters.startDateTo };

    const [surveys, total] = await Promise.all([
      this.prisma.survey.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.survey.count({ where }),
    ]);

    return {
      data: surveys,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async generateSurveyCode(type: SurveyType): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.survey.count({
      where: {
        type,
        createdAt: { gte: new Date(year, 0, 1) },
      },
    });
    return `${type.substring(0, 3).toUpperCase()}-${year}-${String(count + 1).padStart(4, "0")}`;
  }

  private async getEligibleEmployeeCount(audience: any): Promise<number> {
    if (audience.type === "ALL") {
      return this.prisma.employee.count({ where: { status: "ACTIVE" } });
    }

    if (audience.type === "SPECIFIC" && audience.employeeIds) {
      return audience.employeeIds.length;
    }

    // Build filter for FILTERED type
    const where: Prisma.EmployeeWhereInput = { status: "ACTIVE" };
    const filters = audience.filters || {};

    if (filters.departmentIds?.length)
      where.departmentId = { in: filters.departmentIds };
    if (filters.locationIds?.length)
      where.locationId = { in: filters.locationIds };
    if (filters.employmentTypes?.length)
      where.employmentType = { in: filters.employmentTypes };

    return this.prisma.employee.count({ where });
  }

  private async createResponseRecords(surveyId: string): Promise<void> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
    });
    if (!survey) return;

    const audience = survey.targetAudience as any;
    let employeeIds: string[] = [];

    if (audience.type === "SPECIFIC") {
      employeeIds = audience.employeeIds || [];
    } else {
      const where: Prisma.EmployeeWhereInput = { status: "ACTIVE" };
      if (audience.filters?.departmentIds?.length) {
        where.departmentId = { in: audience.filters.departmentIds };
      }
      const employees = await this.prisma.employee.findMany({
        where,
        select: { id: true },
      });
      employeeIds = employees.map((e) => e.id);
    }

    // Create response records
    const responses = employeeIds.map((employeeId) => ({
      surveyId,
      employeeId:
        survey.anonymityLevel !== AnonymityLevel.ANONYMOUS ? employeeId : null,
      anonymousId: uuidv4(),
      status: ResponseStatus.NOT_STARTED,
      currentSectionIndex: 0,
      currentQuestionIndex: 0,
      progress: 0,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      timeSpentSeconds: 0,
      isSubmitted: false,
    }));

    await this.prisma.surveyResponse.createMany({ data: responses });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SECTIONS & QUESTIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  async addSection(
    surveyId: string,
    title: string,
    description?: string,
  ): Promise<SurveySection> {
    const existingSections = await this.prisma.surveySection.count({
      where: { surveyId },
    });

    const section = await this.prisma.surveySection.create({
      data: {
        surveyId,
        title,
        description,
        order: existingSections + 1,
        isRequired: true,
      },
    });

    return section as unknown as SurveySection;
  }

  async addQuestion(data: CreateQuestionDto): Promise<SurveyQuestion> {
    const existingQuestions = await this.prisma.surveyQuestion.count({
      where: { sectionId: data.sectionId },
    });

    const question = await this.prisma.surveyQuestion.create({
      data: {
        sectionId: data.sectionId,
        questionText: data.questionText,
        helpText: data.helpText,
        type: data.type,
        order: existingQuestions + 1,
        options: data.options as unknown as Prisma.JsonArray,
        ratingScale: data.ratingScale as unknown as Prisma.JsonObject,
        likertScale: data.likertScale as unknown as Prisma.JsonObject,
        isRequired: data.isRequired,
        categoryId: data.categoryId,
        isKeyDriver: false,
      },
    });

    // Update survey question count
    const section = await this.prisma.surveySection.findUnique({
      where: { id: data.sectionId },
    });
    if (section) {
      const totalQuestions = await this.prisma.surveyQuestion.count({
        where: { section: { surveyId: section.surveyId } },
      });
      await this.prisma.survey.update({
        where: { id: section.surveyId },
        data: { totalQuestions },
      });
    }

    return question as unknown as SurveyQuestion;
  }

  async updateQuestion(
    questionId: string,
    data: Partial<SurveyQuestion>,
  ): Promise<SurveyQuestion> {
    const question = await this.prisma.surveyQuestion.update({
      where: { id: questionId },
      data: {
        ...data,
        options: data.options as unknown as Prisma.JsonArray,
        ratingScale: data.ratingScale as unknown as Prisma.JsonObject,
        likertScale: data.likertScale as unknown as Prisma.JsonObject,
      },
    });

    return question as unknown as SurveyQuestion;
  }

  async deleteQuestion(questionId: string): Promise<void> {
    await this.prisma.surveyQuestion.delete({ where: { id: questionId } });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // RESPONSES
  // ═══════════════════════════════════════════════════════════════════════════════

  async getResponseForEmployee(
    surveyId: string,
    employeeId: string,
  ): Promise<SurveyResponse | null> {
    return this.prisma.surveyResponse.findFirst({
      where: { surveyId, employeeId },
      include: { answers: true },
    }) as unknown as SurveyResponse;
  }

  async getResponseByAnonymousId(
    anonymousId: string,
  ): Promise<SurveyResponse | null> {
    return this.prisma.surveyResponse.findFirst({
      where: { anonymousId },
      include: { answers: true },
    }) as unknown as SurveyResponse;
  }

  async submitAnswers(data: SubmitAnswersDto): Promise<SurveyResponse> {
    const response = await this.prisma.surveyResponse.findUnique({
      where: { id: data.responseId },
      include: {
        survey: { include: { sections: { include: { questions: true } } } },
      },
    });

    if (!response) throw new Error("Response not found");

    // Save answers
    for (const answer of data.answers) {
      await this.prisma.questionAnswer.upsert({
        where: {
          responseId_questionId: {
            responseId: data.responseId,
            questionId: answer.questionId,
          },
        },
        create: {
          responseId: data.responseId,
          questionId: answer.questionId,
          ratingValue: answer.ratingValue,
          selectedOptionIds: answer.selectedOptionIds || [],
          textValue: answer.textValue,
          answeredAt: new Date(),
        },
        update: {
          ratingValue: answer.ratingValue,
          selectedOptionIds: answer.selectedOptionIds || [],
          textValue: answer.textValue,
          answeredAt: new Date(),
        },
      });
    }

    // Calculate progress
    const totalQuestions = response.survey.sections.reduce(
      (sum, s) => sum + s.questions.length,
      0,
    );
    const answeredCount = await this.prisma.questionAnswer.count({
      where: { responseId: data.responseId },
    });
    const progress = Math.round((answeredCount / totalQuestions) * 100);

    // Update response
    const updated = await this.prisma.surveyResponse.update({
      where: { id: data.responseId },
      data: {
        status:
          progress === 100
            ? ResponseStatus.COMPLETED
            : ResponseStatus.IN_PROGRESS,
        progress,
        lastActivityAt: new Date(),
        completedAt: progress === 100 ? new Date() : undefined,
        isSubmitted: progress === 100,
        submittedAt: progress === 100 ? new Date() : undefined,
      },
    });

    // Update survey stats
    await this.updateSurveyStats(response.surveyId);

    return updated as unknown as SurveyResponse;
  }

  private async updateSurveyStats(surveyId: string): Promise<void> {
    const [total, completed] = await Promise.all([
      this.prisma.surveyResponse.count({ where: { surveyId } }),
      this.prisma.surveyResponse.count({
        where: { surveyId, status: ResponseStatus.COMPLETED },
      }),
    ]);

    await this.prisma.survey.update({
      where: { id: surveyId },
      data: {
        responseCount: completed,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // RESULTS & ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════════

  async calculateSurveyResults(surveyId: string): Promise<SurveyResults> {
    const survey = await this.prisma.survey.findUnique({
      where: { id: surveyId },
      include: {
        sections: { include: { questions: true } },
        responses: {
          include: { answers: true },
          where: { status: ResponseStatus.COMPLETED },
        },
      },
    });

    if (!survey) throw new Error("Survey not found");

    const responses = survey.responses;
    const totalInvited = await this.prisma.surveyResponse.count({
      where: { surveyId },
    });

    // Response stats
    const responseStats = {
      totalInvited,
      totalStarted: await this.prisma.surveyResponse.count({
        where: { surveyId, status: { not: ResponseStatus.NOT_STARTED } },
      }),
      totalCompleted: responses.length,
      responseRate:
        totalInvited > 0
          ? Math.round((responses.length / totalInvited) * 100)
          : 0,
      completionRate: survey.completionRate,
      averageTimeMinutes: 0,
    };

    // Calculate question results
    const questionResults: QuestionResult[] = [];
    for (const section of survey.sections) {
      for (const question of section.questions) {
        const answers = responses.flatMap((r) =>
          r.answers.filter((a) => a.questionId === question.id),
        );

        const result: QuestionResult = {
          questionId: question.id,
          questionText: question.questionText,
          questionType: question.type as QuestionType,
          categoryId: question.categoryId || undefined,
          responseCount: answers.length,
        };

        if (
          question.type === "RATING" ||
          question.type === "NPS" ||
          question.type === "LIKERT"
        ) {
          const values = answers
            .map((a) => a.ratingValue)
            .filter((v) => v !== null) as number[];
          if (values.length > 0) {
            result.averageScore =
              values.reduce((a, b) => a + b, 0) / values.length;
            result.distribution = this.calculateDistribution(
              values,
              question.type as QuestionType,
            );
          }
        }

        if (
          question.type === "SINGLE_CHOICE" ||
          question.type === "MULTIPLE_CHOICE"
        ) {
          result.optionResults = this.calculateOptionResults(
            answers,
            question.options as any[],
          );
        }

        questionResults.push(result);
      }
    }

    // Calculate overall engagement score (average of all rating questions)
    const ratingResults = questionResults.filter(
      (q) => q.averageScore !== undefined,
    );
    const overallScore =
      ratingResults.length > 0
        ? Math.round(
            (ratingResults.reduce((sum, q) => sum + (q.averageScore || 0), 0) /
              ratingResults.length) *
              20,
          ) // Scale to 0-100
        : 0;

    // Calculate eNPS if applicable
    let eNPS;
    const enpsQuestion = questionResults.find(
      (q) => q.questionType === "NPS" || q.questionType === "ENPS",
    );
    if (enpsQuestion && enpsQuestion.distribution) {
      const dist = enpsQuestion.distribution;
      const promoters = dist
        .filter((d) => (d.value as number) >= 9)
        .reduce((sum, d) => sum + d.percentage, 0);
      const detractors = dist
        .filter((d) => (d.value as number) <= 6)
        .reduce((sum, d) => sum + d.percentage, 0);
      eNPS = {
        score: Math.round(promoters - detractors),
        promoters,
        passives: 100 - promoters - detractors,
        detractors,
      };
    }

    return {
      surveyId,
      survey: survey as unknown as Survey,
      responseStats,
      overallEngagementScore: overallScore,
      eNPS,
      categoryScores: [],
      questionResults,
      demographicBreakdown: [],
      generatedAt: new Date(),
    };
  }

  private calculateDistribution(
    values: number[],
    type: QuestionType,
  ): { value: number | string; count: number; percentage: number }[] {
    const counts = new Map<number, number>();
    values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));

    const total = values.length;
    const maxValue = type === "NPS" ? 10 : 5;

    const distribution = [];
    for (let i = type === "NPS" ? 0 : 1; i <= maxValue; i++) {
      const count = counts.get(i) || 0;
      distribution.push({
        value: i,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      });
    }

    return distribution;
  }

  private calculateOptionResults(
    answers: any[],
    options: any[],
  ): {
    optionId: string;
    optionText: string;
    count: number;
    percentage: number;
  }[] {
    if (!options) return [];

    const total = answers.length;
    return options.map((opt) => {
      const count = answers.filter((a) =>
        a.selectedOptionIds?.includes(opt.id),
      ).length;
      return {
        optionId: opt.id,
        optionText: opt.text,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    });
  }

  async getSurveyResults(surveyId: string): Promise<SurveyResults> {
    return this.calculateSurveyResults(surveyId);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ACTION PLANS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createActionPlan(
    data: CreateActionPlanDto,
    createdBy: string,
  ): Promise<ActionPlan> {
    const results = await this.getSurveyResults(data.surveyId);
    const currentScore = results.overallEngagementScore;

    const plan = await this.prisma.actionPlan.create({
      data: {
        surveyId: data.surveyId,
        title: data.title,
        description: data.description,
        categoryId: data.categoryId,
        ownerId: data.ownerId,
        departmentId: data.departmentId,
        targetImprovement: data.targetImprovement,
        currentScore,
        targetScore: currentScore + data.targetImprovement,
        startDate: data.startDate,
        targetDate: data.targetDate,
        status: ActionStatus.OPEN,
        progress: 0,
        createdBy,
      },
    });

    return plan as unknown as ActionPlan;
  }

  async addActionItem(
    planId: string,
    data: {
      title: string;
      description?: string;
      priority: ActionPriority;
      assigneeId: string;
      dueDate: Date;
    },
  ): Promise<ActionItem> {
    const item = await this.prisma.actionItem.create({
      data: {
        actionPlanId: planId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        status: ActionStatus.OPEN,
        assigneeId: data.assigneeId,
        dueDate: data.dueDate,
        progress: 0,
      },
    });

    return item as unknown as ActionItem;
  }

  async updateActionItemProgress(
    itemId: string,
    progress: number,
    notes?: string,
  ): Promise<ActionItem> {
    const item = await this.prisma.actionItem.update({
      where: { id: itemId },
      data: {
        progress,
        progressNotes: notes,
        status:
          progress === 100 ? ActionStatus.COMPLETED : ActionStatus.IN_PROGRESS,
        completedDate: progress === 100 ? new Date() : undefined,
      },
    });

    // Update plan progress
    await this.updateActionPlanProgress(item.actionPlanId);

    return item as unknown as ActionItem;
  }

  private async updateActionPlanProgress(planId: string): Promise<void> {
    const items = await this.prisma.actionItem.findMany({
      where: { actionPlanId: planId },
    });

    if (items.length === 0) return;

    const avgProgress = Math.round(
      items.reduce((sum, i) => sum + i.progress, 0) / items.length,
    );
    const allCompleted = items.every(
      (i) => i.status === ActionStatus.COMPLETED,
    );

    await this.prisma.actionPlan.update({
      where: { id: planId },
      data: {
        progress: avgProgress,
        status: allCompleted
          ? ActionStatus.COMPLETED
          : ActionStatus.IN_PROGRESS,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // RECOGNITION
  // ═══════════════════════════════════════════════════════════════════════════════

  async giveRecognition(
    fromEmployeeId: string,
    toEmployeeId: string,
    type: string,
    message: string,
    isPublic: boolean = true,
    companyValueIds?: string[],
  ): Promise<Recognition> {
    const recognition = await this.prisma.recognition.create({
      data: {
        fromEmployeeId,
        toEmployeeId,
        type,
        message,
        isPublic,
        companyValueIds: companyValueIds || [],
        reactions: [],
      },
    });

    return recognition as unknown as Recognition;
  }

  async getRecognitionsForEmployee(
    employeeId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const [recognitions, total] = await Promise.all([
      this.prisma.recognition.findMany({
        where: { toEmployeeId: employeeId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.recognition.count({ where: { toEmployeeId: employeeId } }),
    ]);

    return {
      data: recognitions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getPublicRecognitions(page: number = 1, limit: number = 50) {
    const [recognitions, total] = await Promise.all([
      this.prisma.recognition.findMany({
        where: { isPublic: true },
        include: {
          fromEmployee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              photoUrl: true,
            },
          },
          toEmployee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              photoUrl: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.recognition.count({ where: { isPublic: true } }),
    ]);

    return {
      data: recognitions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════════

  async getEngagementDashboard(): Promise<EngagementDashboard> {
    // Get latest completed survey
    const latestSurvey = await this.prisma.survey.findFirst({
      where: { status: SurveyStatus.CLOSED, type: SurveyType.ENGAGEMENT },
      orderBy: { closedAt: "desc" },
    });

    let currentScore = 0;
    let currentENPS = 0;
    let lastResponseRate = 0;

    if (latestSurvey) {
      const results = await this.getSurveyResults(latestSurvey.id);
      currentScore = results.overallEngagementScore;
      currentENPS = results.eNPS?.score || 0;
      lastResponseRate = results.responseStats.responseRate;
    }

    // Active surveys
    const activeSurveys = await this.prisma.survey.findMany({
      where: { status: SurveyStatus.ACTIVE },
      select: {
        id: true,
        title: true,
        endDate: true,
        responseCount: true,
        totalInvited: true,
      },
    });

    // Recent action plans
    const recentActions = await this.prisma.actionPlan.findMany({
      where: { status: { in: [ActionStatus.OPEN, ActionStatus.IN_PROGRESS] } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, status: true, progress: true },
    });

    return {
      asOfDate: new Date(),
      currentEngagementScore: currentScore,
      previousEngagementScore: 0,
      scoreTrend: "STABLE",
      currentENPS,
      previousENPS: 0,
      lastSurveyResponseRate: lastResponseRate,
      averageResponseRate: lastResponseRate,
      topCategories: [],
      bottomCategories: [],
      scoreTrendData: [],
      eNPSTrendData: [],
      activeSurveys: activeSurveys.map((s) => ({
        id: s.id,
        title: s.title,
        endDate: s.endDate,
        responseRate:
          s.totalInvited > 0
            ? Math.round((s.responseCount / s.totalInvited) * 100)
            : 0,
      })),
      recentActions: recentActions as any,
      alerts: [],
    };
  }
}

export default EngagementService;
