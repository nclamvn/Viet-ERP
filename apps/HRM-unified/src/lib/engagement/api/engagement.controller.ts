// employee-engagement/api/engagement.controller.ts

/**
 * LAC VIET HR - Employee Engagement API Controller
 * REST API endpoints for surveys and engagement management
 */

// @ts-ignore
import { Router, Request, Response, NextFunction } from "express";
import { EngagementService } from "../services/engagement.service";
import { PrismaClient } from ".prisma/hrm-unified-client";
import {
  SurveyType,
  SurveyStatus,
  ActionItemPriority,
} from "../types/engagement.types";

const prisma = new PrismaClient();
const engagementService = new EngagementService(prisma);
const router = Router();

const asyncHandler =
  (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════════════════
// SURVEYS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/surveys",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      type,
      status,
      ownerId,
      startDateFrom,
      startDateTo,
      page = 1,
      limit = 20,
    } = req.query;
    const surveys = await engagementService.listSurveys(
      {
        type: type as SurveyType,
        status: status as SurveyStatus,
        ownerId: ownerId as string,
        startDateFrom: startDateFrom
          ? new Date(startDateFrom as string)
          : undefined,
        startDateTo: startDateTo ? new Date(startDateTo as string) : undefined,
      } as any,
      parseInt(page as string),
      parseInt(limit as string),
    );
    res.json({ success: true, ...surveys });
  }),
);

router.get(
  "/surveys/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const survey = await engagementService.getSurvey(req.params.id);
    if (!survey)
      return res
        .status(404)
        .json({ success: false, error: "Survey not found" });
    res.json({ success: true, data: survey });
  }),
);

router.post(
  "/surveys",
  asyncHandler(async (req: Request, res: Response) => {
    const createdBy = (req as any).user?.id || "system";
    const survey = await engagementService.createSurvey(req.body, createdBy);
    res
      .status(201)
      .json({ success: true, data: survey, message: "Survey created" });
  }),
);

router.put(
  "/surveys/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const survey = await engagementService.updateSurvey(
      req.params.id,
      req.body,
    );
    res.json({ success: true, data: survey, message: "Survey updated" });
  }),
);

router.post(
  "/surveys/:id/publish",
  asyncHandler(async (req: Request, res: Response) => {
    const survey = await engagementService.publishSurvey(req.params.id);
    res.json({ success: true, data: survey, message: "Survey published" });
  }),
);

router.post(
  "/surveys/:id/activate",
  asyncHandler(async (req: Request, res: Response) => {
    const survey = await engagementService.activateSurvey(req.params.id);
    res.json({ success: true, data: survey, message: "Survey activated" });
  }),
);

router.post(
  "/surveys/:id/close",
  asyncHandler(async (req: Request, res: Response) => {
    const survey = await engagementService.closeSurvey(req.params.id);
    res.json({ success: true, data: survey, message: "Survey closed" });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTIONS & QUESTIONS
// ═══════════════════════════════════════════════════════════════════════════════

router.post(
  "/surveys/:id/sections",
  asyncHandler(async (req: Request, res: Response) => {
    const { title, description } = req.body;
    const section = await engagementService.addSection(
      req.params.id,
      title,
      description,
    );
    res
      .status(201)
      .json({ success: true, data: section, message: "Section added" });
  }),
);

router.post(
  "/questions",
  asyncHandler(async (req: Request, res: Response) => {
    const question = await engagementService.addQuestion(req.body);
    res
      .status(201)
      .json({ success: true, data: question, message: "Question added" });
  }),
);

router.put(
  "/questions/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const question = await engagementService.updateQuestion(
      req.params.id,
      req.body,
    );
    res.json({ success: true, data: question, message: "Question updated" });
  }),
);

router.delete(
  "/questions/:id",
  asyncHandler(async (req: Request, res: Response) => {
    await engagementService.deleteQuestion(req.params.id);
    res.json({ success: true, message: "Question deleted" });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSES
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/surveys/:surveyId/response",
  asyncHandler(async (req: Request, res: Response) => {
    const employeeId = (req as any).user?.id;
    const response = await engagementService.getResponseForEmployee(
      req.params.surveyId,
      employeeId,
    );
    if (!response)
      return res
        .status(404)
        .json({ success: false, error: "Response not found" });
    res.json({ success: true, data: response });
  }),
);

router.get(
  "/responses/anonymous/:anonymousId",
  asyncHandler(async (req: Request, res: Response) => {
    const response = await engagementService.getResponseByAnonymousId(
      req.params.anonymousId,
    );
    if (!response)
      return res
        .status(404)
        .json({ success: false, error: "Response not found" });
    res.json({ success: true, data: response });
  }),
);

router.post(
  "/responses/submit",
  asyncHandler(async (req: Request, res: Response) => {
    const response = await engagementService.submitAnswers(req.body);
    res.json({ success: true, data: response, message: "Answers saved" });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS & ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/surveys/:id/results",
  asyncHandler(async (req: Request, res: Response) => {
    const results = await engagementService.getSurveyResults(req.params.id);
    res.json({ success: true, data: results });
  }),
);

router.get(
  "/dashboard",
  asyncHandler(async (req: Request, res: Response) => {
    const dashboard = await engagementService.getEngagementDashboard();
    res.json({ success: true, data: dashboard });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION PLANS
// ═══════════════════════════════════════════════════════════════════════════════

router.post(
  "/action-plans",
  asyncHandler(async (req: Request, res: Response) => {
    const createdBy = (req as any).user?.id || "system";
    const plan = await engagementService.createActionPlan(req.body, createdBy);
    res
      .status(201)
      .json({ success: true, data: plan, message: "Action plan created" });
  }),
);

router.post(
  "/action-plans/:id/items",
  asyncHandler(async (req: Request, res: Response) => {
    const item = await engagementService.addActionItem(req.params.id, req.body);
    res
      .status(201)
      .json({ success: true, data: item, message: "Action item added" });
  }),
);

router.patch(
  "/action-items/:id/progress",
  asyncHandler(async (req: Request, res: Response) => {
    const { progress, notes } = req.body;
    const item = await engagementService.updateActionItemProgress(
      req.params.id,
      progress,
      notes,
    );
    res.json({ success: true, data: item, message: "Progress updated" });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// RECOGNITION
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/recognitions/public",
  asyncHandler(async (req: Request, res: Response) => {
    const { page = 1, limit = 50 } = req.query;
    const recognitions = await engagementService.getPublicRecognitions(
      parseInt(page as string),
      parseInt(limit as string),
    );
    res.json({ success: true, ...recognitions });
  }),
);

router.get(
  "/recognitions/employee/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const { page = 1, limit = 20 } = req.query;
    const recognitions = await engagementService.getRecognitionsForEmployee(
      req.params.employeeId,
      parseInt(page as string),
      parseInt(limit as string),
    );
    res.json({ success: true, ...recognitions });
  }),
);

router.post(
  "/recognitions",
  asyncHandler(async (req: Request, res: Response) => {
    const fromEmployeeId = (req as any).user?.id || req.body.fromEmployeeId;
    const { toEmployeeId, type, message, isPublic, companyValueIds } = req.body;
    const recognition = await engagementService.giveRecognition(
      fromEmployeeId,
      toEmployeeId,
      type,
      message,
      isPublic,
      companyValueIds,
    );
    res
      .status(201)
      .json({ success: true, data: recognition, message: "Recognition sent" });
  }),
);

// Error handling
router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Engagement API Error:", err);
  res
    .status(500)
    .json({ success: false, error: err.message || "Internal server error" });
});

export default router;
