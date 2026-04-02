// src/services/engagement/engagement.service.ts
// Employee Engagement Service - Surveys & Results

import { db } from "@/lib/db";
import type {
  SurveyStatus,
  SurveyType,
  SurveyQuestionType,
} from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface CreateSurveyInput {
  title: string;
  description?: string;
  type: SurveyType;
  startDate: string;
  endDate: string;
  isAnonymous?: boolean;
  allowComments?: boolean;
  requireAllQuestions?: boolean;
  targetType?: "ALL" | "DEPARTMENT" | "POSITION" | "CUSTOM";
  targetDepartments?: string[];
  targetPositions?: string[];
}

export interface CreateQuestionInput {
  questionText: string;
  questionType: SurveyQuestionType;
  options?: string[];
  isRequired?: boolean;
  sortOrder?: number;
  category?: string;
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  allowMultiple?: boolean;
  isENPS?: boolean;
}

export interface SubmitResponseInput {
  answers: Array<{
    questionId: string;
    scaleValue?: number;
    selectedOptions?: string[];
    textValue?: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// SURVEYS
// ═══════════════════════════════════════════════════════════════

export async function createSurvey(
  tenantId: string,
  createdBy: string,
  input: CreateSurveyInput,
) {
  return db.survey.create({
    data: {
      tenantId,
      title: input.title,
      description: input.description,
      type: input.type,
      startDate: new Date(input.startDate),
      endDate: new Date(input.endDate),
      isAnonymous: input.isAnonymous ?? true,
      allowComments: input.allowComments ?? true,
      requireAllQuestions: input.requireAllQuestions ?? false,
      targetType: input.targetType ?? "ALL",
      targetDepartments: input.targetDepartments ?? [],
      targetPositions: input.targetPositions ?? [],
      status: "DRAFT",
      createdBy,
    },
    include: { questions: true },
  });
}

export async function listSurveys(
  tenantId: string,
  filters?: {
    status?: SurveyStatus;
    type?: SurveyType;
    page?: number;
    limit?: number;
  },
) {
  const page = filters?.page || 1;
  const limit = filters?.limit || 20;
  const where: Record<string, unknown> = { tenantId };
  if (filters?.status) where.status = filters.status;
  if (filters?.type) where.type = filters.type;

  const [surveys, total] = await Promise.all([
    db.survey.findMany({
      where,
      include: {
        questions: { select: { id: true } },
        responses: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.survey.count({ where }),
  ]);

  return {
    surveys: surveys.map((s) => ({
      ...s,
      questionCount: s.questions.length,
      responseCount: s.responses.length,
      questions: undefined,
      responses: undefined,
    })),
    total,
    page,
    limit,
  };
}

export async function getSurvey(tenantId: string, surveyId: string) {
  return db.survey.findFirst({
    where: { id: surveyId, tenantId },
    include: {
      questions: { orderBy: { sortOrder: "asc" } },
      responses: {
        select: { id: true, respondentId: true, completedAt: true },
      },
    },
  });
}

export async function updateSurvey(
  tenantId: string,
  surveyId: string,
  input: Partial<CreateSurveyInput>,
) {
  const existing = await db.survey.findFirst({
    where: { id: surveyId, tenantId },
  });
  if (!existing) throw new Error("Survey not found");

  return db.survey.update({
    where: { id: surveyId },
    data: {
      ...(input.title && { title: input.title }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.startDate && { startDate: new Date(input.startDate) }),
      ...(input.endDate && { endDate: new Date(input.endDate) }),
      ...(input.isAnonymous !== undefined && {
        isAnonymous: input.isAnonymous,
      }),
      ...(input.allowComments !== undefined && {
        allowComments: input.allowComments,
      }),
      ...(input.requireAllQuestions !== undefined && {
        requireAllQuestions: input.requireAllQuestions,
      }),
      ...(input.targetType && { targetType: input.targetType }),
      ...(input.targetDepartments && {
        targetDepartments: input.targetDepartments,
      }),
      ...(input.targetPositions && { targetPositions: input.targetPositions }),
    },
    include: { questions: true },
  });
}

export async function deleteSurvey(tenantId: string, surveyId: string) {
  const existing = await db.survey.findFirst({
    where: { id: surveyId, tenantId },
  });
  if (!existing) throw new Error("Survey not found");
  if (existing.status !== "DRAFT")
    throw new Error("Can only delete draft surveys");

  return db.survey.delete({ where: { id: surveyId } });
}

export async function updateSurveyStatus(
  tenantId: string,
  surveyId: string,
  status: SurveyStatus,
) {
  const survey = await db.survey.findFirst({
    where: { id: surveyId, tenantId },
  });
  if (!survey) throw new Error("Survey not found");

  // Validate status transitions
  const validTransitions: Record<string, string[]> = {
    DRAFT: ["SCHEDULED", "ACTIVE"],
    SCHEDULED: ["ACTIVE", "DRAFT"],
    ACTIVE: ["CLOSED"],
    CLOSED: ["ARCHIVED"],
  };

  if (!validTransitions[survey.status]?.includes(status)) {
    throw new Error(`Cannot transition from ${survey.status} to ${status}`);
  }

  return db.survey.update({
    where: { id: surveyId },
    data: { status },
  });
}

// ═══════════════════════════════════════════════════════════════
// QUESTIONS
// ═══════════════════════════════════════════════════════════════

export async function addQuestion(
  tenantId: string,
  surveyId: string,
  input: CreateQuestionInput,
) {
  const survey = await db.survey.findFirst({
    where: { id: surveyId, tenantId },
  });
  if (!survey) throw new Error("Survey not found");

  return db.surveyQuestion.create({
    data: {
      surveyId,
      questionText: input.questionText,
      questionType: input.questionType,
      options: input.options ?? [],
      isRequired: input.isRequired ?? true,
      sortOrder: input.sortOrder ?? 0,
      category: input.category,
      scaleMin: input.scaleMin,
      scaleMax: input.scaleMax,
      scaleMinLabel: input.scaleMinLabel,
      scaleMaxLabel: input.scaleMaxLabel,
      allowMultiple: input.allowMultiple ?? false,
      isENPS: input.isENPS ?? false,
    },
  });
}

export async function updateQuestion(
  tenantId: string,
  surveyId: string,
  questionId: string,
  input: Partial<CreateQuestionInput>,
) {
  const survey = await db.survey.findFirst({
    where: { id: surveyId, tenantId },
  });
  if (!survey) throw new Error("Survey not found");

  return db.surveyQuestion.update({
    where: { id: questionId },
    data: {
      ...(input.questionText && { questionText: input.questionText }),
      ...(input.questionType && { questionType: input.questionType }),
      ...(input.options && { options: input.options }),
      ...(input.isRequired !== undefined && { isRequired: input.isRequired }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      ...(input.category !== undefined && { category: input.category }),
    },
  });
}

export async function deleteQuestion(
  tenantId: string,
  surveyId: string,
  questionId: string,
) {
  const survey = await db.survey.findFirst({
    where: { id: surveyId, tenantId },
  });
  if (!survey) throw new Error("Survey not found");

  return db.surveyQuestion.delete({ where: { id: questionId } });
}

// ═══════════════════════════════════════════════════════════════
// RESPONSES
// ═══════════════════════════════════════════════════════════════

export async function submitResponse(
  tenantId: string,
  surveyId: string,
  respondentId: string,
  input: SubmitResponseInput,
) {
  const survey = await db.survey.findFirst({
    where: { id: surveyId, tenantId },
  });
  if (!survey) throw new Error("Survey not found");
  if (survey.status !== "ACTIVE") throw new Error("Survey is not active");

  // Check for existing response
  const existing = await db.surveyResponse.findUnique({
    where: { surveyId_respondentId: { surveyId, respondentId } },
  });
  if (existing) throw new Error("Already responded to this survey");

  return db.surveyResponse.create({
    data: {
      surveyId,
      respondentId,
      completedAt: new Date(),
      answers: {
        create: input.answers.map((a) => ({
          questionId: a.questionId,
          scaleValue: a.scaleValue,
          selectedOptions: a.selectedOptions ?? [],
          textValue: a.textValue,
        })),
      },
    },
    include: { answers: true },
  });
}

export async function getResponses(tenantId: string, surveyId: string) {
  const survey = await db.survey.findFirst({
    where: { id: surveyId, tenantId },
  });
  if (!survey) throw new Error("Survey not found");

  return db.surveyResponse.findMany({
    where: { surveyId },
    include: {
      answers: { include: { question: true } },
      respondent: survey.isAnonymous ? false : { select: { fullName: true } },
    },
    orderBy: { startedAt: "desc" },
  });
}

export async function getMyResponse(surveyId: string, respondentId: string) {
  return db.surveyResponse.findUnique({
    where: { surveyId_respondentId: { surveyId, respondentId } },
    include: { answers: true },
  });
}

// ═══════════════════════════════════════════════════════════════
// RESULTS / AGGREGATION
// ═══════════════════════════════════════════════════════════════

export async function getSurveyResults(tenantId: string, surveyId: string) {
  const survey = await db.survey.findFirst({
    where: { id: surveyId, tenantId },
    include: {
      questions: { orderBy: { sortOrder: "asc" } },
      responses: { include: { answers: true } },
    },
  });
  if (!survey) throw new Error("Survey not found");

  const totalResponses = survey.responses.length;
  const completedResponses = survey.responses.filter(
    (r) => r.completedAt,
  ).length;

  const questionResults = survey.questions.map((q) => {
    const answers = survey.responses.flatMap((r) =>
      r.answers.filter((a) => a.questionId === q.id),
    );

    let avgScore: number | null = null;
    const distribution: Record<string, number> = {};

    if (["SCALE", "RATING", "NPS"].includes(q.questionType)) {
      const values = answers
        .map((a) => a.scaleValue)
        .filter((v): v is number => v !== null);
      avgScore =
        values.length > 0
          ? values.reduce((s, v) => s + v, 0) / values.length
          : null;

      // Distribution
      for (const v of values) {
        distribution[String(v)] = (distribution[String(v)] || 0) + 1;
      }
    } else if (
      ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "YES_NO"].includes(q.questionType)
    ) {
      for (const a of answers) {
        for (const opt of a.selectedOptions) {
          distribution[opt] = (distribution[opt] || 0) + 1;
        }
      }
    }

    return {
      questionId: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      category: q.category,
      totalAnswers: answers.length,
      avgScore: avgScore ? Math.round(avgScore * 100) / 100 : null,
      distribution,
    };
  });

  // eNPS calculation if applicable
  let eNPS: number | null = null;
  const enpsQuestion = survey.questions.find((q) => q.isENPS);
  if (enpsQuestion) {
    const enpsAnswers = survey.responses
      .flatMap((r) => r.answers.filter((a) => a.questionId === enpsQuestion.id))
      .map((a) => a.scaleValue)
      .filter((v): v is number => v !== null);

    if (enpsAnswers.length > 0) {
      const promoters = enpsAnswers.filter((v) => v >= 9).length;
      const detractors = enpsAnswers.filter((v) => v <= 6).length;
      eNPS = Math.round(((promoters - detractors) / enpsAnswers.length) * 100);
    }
  }

  return {
    surveyId,
    title: survey.title,
    totalResponses,
    completedResponses,
    completionRate:
      totalResponses > 0
        ? Math.round((completedResponses / totalResponses) * 100)
        : 0,
    eNPS,
    questions: questionResults,
  };
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

export async function getEngagementDashboard(tenantId: string) {
  const [activeSurveys, totalSurveys, totalResponses, recentSurveys] =
    await Promise.all([
      db.survey.count({ where: { tenantId, status: "ACTIVE" } }),
      db.survey.count({ where: { tenantId } }),
      db.surveyResponse.count({ where: { survey: { tenantId } } }),
      db.survey.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          responses: { select: { id: true } },
          questions: { select: { id: true } },
        },
      }),
    ]);

  const totalRecognitions = await db.recognition.count({ where: { tenantId } });
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthlyRecognitions = await db.recognition.count({
    where: { tenantId, createdAt: { gte: monthStart } },
  });

  return {
    surveys: {
      active: activeSurveys,
      total: totalSurveys,
      totalResponses,
    },
    recognitions: {
      total: totalRecognitions,
      thisMonth: monthlyRecognitions,
    },
    recentSurveys: recentSurveys.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      type: s.type,
      responseCount: s.responses.length,
      questionCount: s.questions.length,
      startDate: s.startDate,
      endDate: s.endDate,
    })),
  };
}
