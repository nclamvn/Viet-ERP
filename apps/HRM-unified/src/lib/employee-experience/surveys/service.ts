// src/lib/employee-experience/surveys/service.ts
// Survey Service with Pulse Surveys, eNPS, and Engagement Analytics

import { db } from "@/lib/db";

// Use db as prisma alias for consistency
const prisma = db;
import crypto from "crypto";
import type {
  SurveyType,
  SurveyQuestionType,
  SurveyStatus,
  SurveyTargetType,
} from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface CreateSurveyInput {
  tenantId: string;
  title: string;
  description?: string;
  type: SurveyType;
  startDate: Date;
  endDate: Date;
  isAnonymous?: boolean;
  targetType?: SurveyTargetType;
  targetDepartments?: string[];
  questions: {
    questionText: string;
    questionType: SurveyQuestionType;
    options?: string[];
    isRequired?: boolean;
    isENPS?: boolean;
    category?: string;
    scaleMin?: number;
    scaleMax?: number;
    scaleMinLabel?: string;
    scaleMaxLabel?: string;
  }[];
}

export interface SurveyResultSummary {
  totalResponses: number;
  completedResponses: number;
  responseRate: number;
  engagementScore: number | null;
  eNPS: number | null;
}

export interface QuestionResult {
  questionId: string;
  questionText: string;
  questionType: SurveyQuestionType;
  responseCount: number;
  average?: number;
  distribution?: Record<number, number>;
  optionCounts?: Record<string, number>;
  npsScore?: number | null;
  responses?: string[];
}

// ═══════════════════════════════════════════════════════════════
// SURVEY SERVICE
// ═══════════════════════════════════════════════════════════════

export class SurveyService {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  // ─────────────────────────────────────────────────────────────
  // Survey Creation
  // ─────────────────────────────────────────────────────────────

  async createSurvey(
    input: CreateSurveyInput,
    createdBy: string,
  ): Promise<string> {
    const survey = await prisma.survey.create({
      data: {
        tenantId: input.tenantId,
        title: input.title,
        description: input.description,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        isAnonymous: input.isAnonymous ?? true,
        targetType: input.targetType || "ALL",
        targetDepartments: input.targetDepartments || [],
        targetPositions: [],
        status: input.startDate <= new Date() ? "ACTIVE" : "SCHEDULED",
        createdBy,

        questions: {
          create: input.questions.map((q, index) => ({
            questionText: q.questionText,
            questionType: q.questionType,
            options: q.options || [],
            isRequired: q.isRequired ?? true,
            isENPS: q.isENPS || false,
            category: q.category,
            sortOrder: index,
            scaleMin: q.scaleMin ?? (q.questionType === "NPS" ? 0 : 1),
            scaleMax: q.scaleMax ?? (q.questionType === "NPS" ? 10 : 5),
            scaleMinLabel:
              q.scaleMinLabel ||
              (q.questionType === "NPS"
                ? "Hoàn toàn không"
                : "Rất không đồng ý"),
            scaleMaxLabel:
              q.scaleMaxLabel ||
              (q.questionType === "NPS" ? "Chắc chắn có" : "Rất đồng ý"),
          })),
        },
      },
    });

    return survey.id;
  }

  // ─────────────────────────────────────────────────────────────
  // Pre-built Survey Templates
  // ─────────────────────────────────────────────────────────────

  async createPulseSurvey(createdBy: string): Promise<string> {
    const weekNumber = this.getWeekNumber();
    const year = new Date().getFullYear();

    return this.createSurvey(
      {
        tenantId: this.tenantId,
        title: `Pulse Survey - Tuần ${weekNumber}/${year}`,
        description: "Khảo sát nhanh hàng tuần để lắng nghe ý kiến của bạn",
        type: "PULSE",
        startDate: new Date(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isAnonymous: true,
        questions: [
          {
            questionText: "Bạn cảm thấy thế nào về công việc tuần này?",
            questionType: "SCALE",
            category: "WELLBEING",
            scaleMinLabel: "Rất tệ",
            scaleMaxLabel: "Rất tốt",
          },
          {
            questionText: "Bạn có đủ nguồn lực để hoàn thành công việc không?",
            questionType: "SCALE",
            category: "RESOURCES",
          },
          {
            questionText: "Bạn cảm thấy được hỗ trợ từ đội nhóm như thế nào?",
            questionType: "SCALE",
            category: "TEAM",
          },
          {
            questionText: "Có điều gì bạn muốn chia sẻ?",
            questionType: "TEXT",
            isRequired: false,
            category: "FEEDBACK",
          },
        ],
      },
      createdBy,
    );
  }

  async createENPSSurvey(createdBy: string): Promise<string> {
    const quarter = Math.ceil((new Date().getMonth() + 1) / 3);
    const year = new Date().getFullYear();

    return this.createSurvey(
      {
        tenantId: this.tenantId,
        title: `eNPS Survey - Q${quarter}/${year}`,
        description: "Khảo sát Employee Net Promoter Score",
        type: "ENPS",
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        isAnonymous: true,
        questions: [
          {
            questionText:
              "Trên thang điểm 0-10, bạn có muốn giới thiệu công ty này cho bạn bè/người quen làm việc không?",
            questionType: "NPS",
            isENPS: true,
            isRequired: true,
            category: "NPS",
          },
          {
            questionText: "Điều gì khiến bạn chọn điểm số này?",
            questionType: "TEXT",
            isRequired: false,
            category: "NPS_REASON",
          },
          {
            questionText: "Chúng tôi có thể cải thiện điều gì?",
            questionType: "TEXT",
            isRequired: false,
            category: "IMPROVEMENT",
          },
        ],
      },
      createdBy,
    );
  }

  async createEngagementSurvey(createdBy: string): Promise<string> {
    const quarter = Math.ceil((new Date().getMonth() + 1) / 3);
    const year = new Date().getFullYear();

    return this.createSurvey(
      {
        tenantId: this.tenantId,
        title: `Khảo sát Engagement - Q${quarter}/${year}`,
        description: "Khảo sát mức độ gắn kết nhân viên",
        type: "ENGAGEMENT",
        startDate: new Date(),
        endDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
        isAnonymous: true,
        questions: [
          // Work Environment
          {
            questionText:
              "Tôi có đủ tài nguyên và công cụ để hoàn thành công việc tốt",
            questionType: "SCALE",
            category: "WORK_ENVIRONMENT",
          },
          {
            questionText: "Môi trường làm việc của tôi thoải mái và an toàn",
            questionType: "SCALE",
            category: "WORK_ENVIRONMENT",
          },
          // Leadership
          {
            questionText:
              "Quản lý trực tiếp của tôi quan tâm đến tôi như một con người",
            questionType: "SCALE",
            category: "LEADERSHIP",
          },
          {
            questionText: "Tôi được feedback thường xuyên về công việc",
            questionType: "SCALE",
            category: "LEADERSHIP",
          },
          // Growth
          {
            questionText: "Tôi có cơ hội học hỏi và phát triển",
            questionType: "SCALE",
            category: "GROWTH",
          },
          {
            questionText: "Tôi thấy rõ con đường thăng tiến của mình",
            questionType: "SCALE",
            category: "GROWTH",
          },
          // Recognition
          {
            questionText: "Công sức của tôi được ghi nhận xứng đáng",
            questionType: "SCALE",
            category: "RECOGNITION",
          },
          // Team
          {
            questionText: "Đồng nghiệp của tôi hỗ trợ và tôn trọng lẫn nhau",
            questionType: "SCALE",
            category: "TEAM",
          },
          // Purpose
          {
            questionText:
              "Tôi hiểu công việc của mình đóng góp như thế nào vào mục tiêu công ty",
            questionType: "SCALE",
            category: "PURPOSE",
          },
          // Overall
          {
            questionText: "Nhìn chung, tôi hài lòng với công việc hiện tại",
            questionType: "SCALE",
            category: "OVERALL",
          },
          // eNPS
          {
            questionText:
              "Bạn có giới thiệu công ty này cho bạn bè làm việc không? (0-10)",
            questionType: "NPS",
            isENPS: true,
            category: "NPS",
          },
          // Open feedback
          {
            questionText: "Bạn có góp ý gì để công ty tốt hơn?",
            questionType: "TEXT",
            isRequired: false,
            category: "FEEDBACK",
          },
        ],
      },
      createdBy,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Survey Response
  // ─────────────────────────────────────────────────────────────

  async submitResponse(
    surveyId: string,
    respondentId: string,
    answers: {
      questionId: string;
      scaleValue?: number;
      selectedOptions?: string[];
      textValue?: string;
    }[],
  ): Promise<void> {
    const survey = await prisma.survey.findFirst({
      where: { id: surveyId, tenantId: this.tenantId },
      include: { questions: true },
    });

    if (!survey) {
      throw new Error("Không tìm thấy khảo sát");
    }

    if (survey.status !== "ACTIVE") {
      throw new Error("Khảo sát không còn hoạt động");
    }

    if (new Date() > survey.endDate) {
      throw new Error("Khảo sát đã hết hạn");
    }

    // Check if already responded
    const existing = await prisma.surveyResponse.findFirst({
      where: {
        surveyId,
        respondentId: survey.isAnonymous ? null : respondentId,
        anonymousToken: survey.isAnonymous
          ? crypto
              .createHash("sha256")
              .update(respondentId + surveyId)
              .digest("hex")
          : null,
      },
    });

    if (existing) {
      throw new Error("Bạn đã trả lời khảo sát này");
    }

    // Generate anonymous token if survey is anonymous
    const anonymousToken = survey.isAnonymous
      ? crypto
          .createHash("sha256")
          .update(respondentId + surveyId)
          .digest("hex")
      : null;

    // Create response
    await prisma.surveyResponse.create({
      data: {
        surveyId,
        respondentId: survey.isAnonymous ? null : respondentId,
        anonymousToken,
        completedAt: new Date(),

        answers: {
          create: answers.map((a) => ({
            questionId: a.questionId,
            scaleValue: a.scaleValue,
            selectedOptions: a.selectedOptions || [],
            textValue: a.textValue,
          })),
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Survey Queries
  // ─────────────────────────────────────────────────────────────

  async getActiveSurveys(employeeId: string) {
    // Get employee info for targeting
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, tenantId: this.tenantId },
      select: { departmentId: true, positionId: true },
    });

    const surveys = await prisma.survey.findMany({
      where: {
        tenantId: this.tenantId,
        status: "ACTIVE",
        endDate: { gte: new Date() },
        OR: [
          { targetType: "ALL" },
          {
            targetType: "DEPARTMENT",
            targetDepartments: { has: employee?.departmentId || "" },
          },
          {
            targetType: "POSITION",
            targetPositions: { has: employee?.positionId || "" },
          },
        ],
      },
      include: {
        questions: {
          orderBy: { sortOrder: "asc" },
        },
        _count: {
          select: { responses: true },
        },
      },
      orderBy: { endDate: "asc" },
    });

    // Check which ones the employee has completed
    const completedSurveyIds = await prisma.surveyResponse.findMany({
      where: {
        surveyId: { in: surveys.map((s) => s.id) },
        OR: [
          { respondentId: employeeId },
          {
            anonymousToken: {
              in: surveys.map((s) =>
                crypto
                  .createHash("sha256")
                  .update(employeeId + s.id)
                  .digest("hex"),
              ),
            },
          },
        ],
      },
      select: { surveyId: true },
    });

    const completedIds = new Set(completedSurveyIds.map((s) => s.surveyId));

    return surveys.map((survey) => ({
      ...survey,
      isCompleted: completedIds.has(survey.id),
      daysRemaining: Math.ceil(
        (survey.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      ),
    }));
  }

  async getSurvey(surveyId: string) {
    return prisma.survey.findFirst({
      where: { id: surveyId, tenantId: this.tenantId },
      include: {
        questions: {
          orderBy: { sortOrder: "asc" },
        },
        _count: {
          select: { responses: true },
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Survey Results & Analytics
  // ─────────────────────────────────────────────────────────────

  async getSurveyResults(surveyId: string): Promise<{
    survey: {
      id: string;
      title: string;
      type: SurveyType;
      status: SurveyStatus;
      startDate: Date;
      endDate: Date;
    };
    summary: SurveyResultSummary;
    questions: QuestionResult[];
  }> {
    const survey = await prisma.survey.findFirst({
      where: { id: surveyId, tenantId: this.tenantId },
      include: {
        questions: {
          include: {
            answers: true,
          },
          orderBy: { sortOrder: "asc" },
        },
        responses: true,
      },
    });

    if (!survey) {
      throw new Error("Không tìm thấy khảo sát");
    }

    const totalResponses = survey.responses.length;
    const completedResponses = survey.responses.filter(
      (r) => r.completedAt,
    ).length;

    // Calculate results for each question
    const questionResults: QuestionResult[] = survey.questions.map(
      (question) => {
        const answers = question.answers;

        if (["SCALE", "NPS", "RATING"].includes(question.questionType)) {
          const values = answers
            .map((a) => a.scaleValue)
            .filter((v): v is number => v !== null);
          const average =
            values.length > 0
              ? values.reduce((a, b) => a + b, 0) / values.length
              : 0;

          // Distribution
          const distribution: Record<number, number> = {};
          values.forEach((v) => {
            distribution[v] = (distribution[v] || 0) + 1;
          });

          // For NPS, calculate score
          let npsScore: number | null = null;
          if (question.isENPS && values.length > 0) {
            const promoters = values.filter((v) => v >= 9).length;
            const detractors = values.filter((v) => v <= 6).length;
            npsScore = Math.round(
              ((promoters - detractors) / values.length) * 100,
            );
          }

          return {
            questionId: question.id,
            questionText: question.questionText,
            questionType: question.questionType,
            responseCount: values.length,
            average: Math.round(average * 10) / 10,
            distribution,
            npsScore,
          };
        }

        if (
          ["SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(question.questionType)
        ) {
          const optionCounts: Record<string, number> = {};
          answers.forEach((a) => {
            a.selectedOptions.forEach((opt) => {
              optionCounts[opt] = (optionCounts[opt] || 0) + 1;
            });
          });

          return {
            questionId: question.id,
            questionText: question.questionText,
            questionType: question.questionType,
            responseCount: answers.length,
            optionCounts,
          };
        }

        if (question.questionType === "TEXT") {
          return {
            questionId: question.id,
            questionText: question.questionText,
            questionType: question.questionType,
            responseCount: answers.filter((a) => a.textValue).length,
            responses: answers
              .filter((a) => a.textValue)
              .map((a) => a.textValue!),
          };
        }

        return {
          questionId: question.id,
          questionText: question.questionText,
          questionType: question.questionType,
          responseCount: answers.length,
        };
      },
    );

    // Calculate overall engagement score
    let engagementScore: number | null = null;
    if (["ENGAGEMENT", "PULSE"].includes(survey.type)) {
      const scaleQuestions = questionResults.filter(
        (q) =>
          ["SCALE", "RATING"].includes(q.questionType) &&
          q.average !== undefined,
      );
      if (scaleQuestions.length > 0) {
        const avgScore =
          scaleQuestions.reduce((sum, q) => sum + (q.average || 0), 0) /
          scaleQuestions.length;
        engagementScore = Math.round((avgScore / 5) * 100);
      }
    }

    // Calculate eNPS
    let eNPS: number | null = null;
    const npsQuestion = questionResults.find(
      (q) => q.npsScore !== null && q.npsScore !== undefined,
    );
    if (npsQuestion) {
      eNPS = npsQuestion.npsScore!;
    }

    return {
      survey: {
        id: survey.id,
        title: survey.title,
        type: survey.type,
        status: survey.status,
        startDate: survey.startDate,
        endDate: survey.endDate,
      },
      summary: {
        totalResponses,
        completedResponses,
        responseRate:
          totalResponses > 0
            ? Math.round((completedResponses / totalResponses) * 100)
            : 0,
        engagementScore,
        eNPS,
      },
      questions: questionResults,
    };
  }

  async getEngagementTrends(months: number = 6) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const surveys = await prisma.survey.findMany({
      where: {
        tenantId: this.tenantId,
        type: { in: ["PULSE", "ENGAGEMENT"] },
        status: "CLOSED",
        endDate: { gte: startDate },
      },
      include: {
        questions: {
          where: { questionType: "SCALE" },
          include: { answers: true },
        },
      },
      orderBy: { endDate: "asc" },
    });

    return surveys.map((survey) => {
      const allValues = survey.questions.flatMap((q) =>
        q.answers
          .map((a) => a.scaleValue)
          .filter((v): v is number => v !== null),
      );

      const avgScore =
        allValues.length > 0
          ? allValues.reduce((a, b) => a + b, 0) / allValues.length
          : 0;

      return {
        date: survey.endDate,
        title: survey.title,
        type: survey.type,
        score: Math.round((avgScore / 5) * 100),
        responseCount: survey.questions[0]?.answers.length || 0,
      };
    });
  }

  async getENPSTrends(quarters: number = 4) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - quarters * 3);

    const surveys = await prisma.survey.findMany({
      where: {
        tenantId: this.tenantId,
        type: "ENPS",
        status: "CLOSED",
        endDate: { gte: startDate },
      },
      include: {
        questions: {
          where: { isENPS: true },
          include: { answers: true },
        },
      },
      orderBy: { endDate: "asc" },
    });

    return surveys.map((survey) => {
      const npsQuestion = survey.questions[0];
      if (!npsQuestion)
        return {
          date: survey.endDate,
          title: survey.title,
          eNPS: 0,
          responseCount: 0,
        };

      const values = npsQuestion.answers
        .map((a) => a.scaleValue)
        .filter((v): v is number => v !== null);

      if (values.length === 0) {
        return {
          date: survey.endDate,
          title: survey.title,
          eNPS: 0,
          responseCount: 0,
        };
      }

      const promoters = values.filter((v) => v >= 9).length;
      const detractors = values.filter((v) => v <= 6).length;
      const eNPS = Math.round(((promoters - detractors) / values.length) * 100);

      return {
        date: survey.endDate,
        title: survey.title,
        eNPS,
        responseCount: values.length,
        promoters,
        passives: values.filter((v) => v === 7 || v === 8).length,
        detractors,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Survey Management
  // ─────────────────────────────────────────────────────────────

  async closeSurvey(surveyId: string): Promise<void> {
    await prisma.survey.update({
      where: { id: surveyId },
      data: { status: "CLOSED" },
    });
  }

  async archiveSurvey(surveyId: string): Promise<void> {
    await prisma.survey.update({
      where: { id: surveyId },
      data: { status: "ARCHIVED" },
    });
  }

  async getAllSurveys(status?: SurveyStatus) {
    return prisma.survey.findMany({
      where: {
        tenantId: this.tenantId,
        ...(status && { status }),
      },
      include: {
        _count: {
          select: { responses: true, questions: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  private getWeekNumber(): number {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now.getTime() - start.getTime();
    return Math.ceil(diff / (7 * 24 * 60 * 60 * 1000));
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════

export function createSurveyService(tenantId: string): SurveyService {
  return new SurveyService(tenantId);
}
