// workforce-planning/api/workforce.controller.ts

/**
 * LAC VIET HR - Workforce Planning API Controller
 * REST API endpoints for workforce analytics and forecasting
 */

// @ts-ignore
import { Router, Request, Response, NextFunction } from "express";
import {
  WorkforceService,
  ForecastScenario,
  PlanningHorizon,
} from "../services/workforce.service";
import { PrismaClient } from ".prisma/hrm-unified-client";

const prisma = new PrismaClient();
const workforceService = new WorkforceService(prisma);
const router = Router();

const asyncHandler =
  (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFORCE METRICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/workforce/metrics
 * @desc    Get current workforce metrics
 */
router.get(
  "/metrics",
  asyncHandler(async (req: Request, res: Response) => {
    const metrics = await workforceService.getCurrentWorkforceMetrics();
    res.json({ success: true, data: metrics });
  }),
);

/**
 * @route   GET /api/workforce/dashboard
 * @desc    Get workforce planning dashboard
 */
router.get(
  "/dashboard",
  asyncHandler(async (req: Request, res: Response) => {
    const dashboard = await workforceService.getWorkforceDashboard();
    res.json({ success: true, data: dashboard });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// HEADCOUNT PLANNING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/workforce/plans
 * @desc    List headcount plans
 */
router.get(
  "/plans",
  asyncHandler(async (req: Request, res: Response) => {
    const { fiscalYear, status } = req.query;
    const plans = await workforceService.listHeadcountPlans(
      fiscalYear ? parseInt(fiscalYear as string) : undefined,
      status as string,
    );
    res.json({ success: true, data: plans });
  }),
);

/**
 * @route   GET /api/workforce/plans/:id
 * @desc    Get headcount plan by ID
 */
router.get(
  "/plans/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const plan = await workforceService.getHeadcountPlan(req.params.id);
    if (!plan)
      return res.status(404).json({ success: false, error: "Plan not found" });
    res.json({ success: true, data: plan });
  }),
);

/**
 * @route   POST /api/workforce/plans
 * @desc    Create headcount plan
 */
router.post(
  "/plans",
  asyncHandler(async (req: Request, res: Response) => {
    const createdBy = (req as any).user?.id || "system";
    const plan = await workforceService.createHeadcountPlan(
      req.body,
      createdBy,
    );
    res
      .status(201)
      .json({ success: true, data: plan, message: "Headcount plan created" });
  }),
);

/**
 * @route   PUT /api/workforce/plans/:id
 * @desc    Update headcount plan
 */
router.put(
  "/plans/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const plan = await workforceService.updateHeadcountPlan(
      req.params.id,
      req.body,
    );
    res.json({ success: true, data: plan, message: "Plan updated" });
  }),
);

/**
 * @route   POST /api/workforce/plans/:id/submit
 * @desc    Submit plan for approval
 */
router.post(
  "/plans/:id/submit",
  asyncHandler(async (req: Request, res: Response) => {
    const plan = await workforceService.submitPlanForApproval(req.params.id);
    res.json({
      success: true,
      data: plan,
      message: "Plan submitted for approval",
    });
  }),
);

/**
 * @route   POST /api/workforce/plans/:id/approve
 * @desc    Approve headcount plan
 */
router.post(
  "/plans/:id/approve",
  asyncHandler(async (req: Request, res: Response) => {
    const approvedBy = (req as any).user?.id || "system";
    const plan = await workforceService.approvePlan(req.params.id, approvedBy);
    res.json({ success: true, data: plan, message: "Plan approved" });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ATTRITION FORECASTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/workforce/forecast/attrition
 * @desc    Generate attrition forecast
 */
router.get(
  "/forecast/attrition",
  asyncHandler(async (req: Request, res: Response) => {
    const { scenario = "BASELINE", horizon = "ANNUAL" } = req.query;
    const forecast = await workforceService.generateAttritionForecast(
      scenario as ForecastScenario,
      horizon as PlanningHorizon,
    );
    res.json({ success: true, data: forecast });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL GAP ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/workforce/skill-gaps
 * @desc    Perform skill gap analysis
 */
router.get(
  "/skill-gaps",
  asyncHandler(async (req: Request, res: Response) => {
    const analysis = await workforceService.performSkillGapAnalysis();
    res.json({ success: true, data: analysis });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO MODELING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/workforce/scenarios
 * @desc    List scenario models
 */
router.get(
  "/scenarios",
  asyncHandler(async (req: Request, res: Response) => {
    const { scenario } = req.query;
    const models = await workforceService.listScenarioModels(
      scenario as ForecastScenario,
    );
    res.json({ success: true, data: models });
  }),
);

/**
 * @route   POST /api/workforce/scenarios
 * @desc    Create scenario model
 */
router.post(
  "/scenarios",
  asyncHandler(async (req: Request, res: Response) => {
    const createdBy = (req as any).user?.id || "system";
    const model = await workforceService.createScenarioModel(
      req.body,
      createdBy,
    );
    res
      .status(201)
      .json({ success: true, data: model, message: "Scenario model created" });
  }),
);

/**
 * @route   POST /api/workforce/scenarios/compare
 * @desc    Compare multiple scenarios
 */
router.post(
  "/scenarios/compare",
  asyncHandler(async (req: Request, res: Response) => {
    const { modelIds } = req.body;
    const comparison = await workforceService.compareScenarios(modelIds);
    res.json({ success: true, data: comparison });
  }),
);

// Error handling
router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Workforce API Error:", err);
  res
    .status(500)
    .json({ success: false, error: err.message || "Internal server error" });
});

export default router;
