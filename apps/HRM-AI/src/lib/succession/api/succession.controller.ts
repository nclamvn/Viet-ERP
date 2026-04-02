// succession-planning/api/succession.controller.ts

/**
 * LAC VIET HR - Succession Planning API Controller
 * REST API endpoints for succession and talent management
 */

// @ts-ignore
import { Router, Request, Response, NextFunction } from "express";
import { SuccessionService } from "../services/succession.service";
import { PrismaClient } from ".prisma/hrm-ai-client";
import {
  PositionCriticality,
  RiskLevel,
  SuccessorReadiness,
  TalentCategory,
  NineBoxPosition,
  FlightRisk,
  CreateCriticalPositionDto,
  CreateSuccessionPlanDto,
  AddSuccessorDto,
  UpdateTalentProfileDto,
  CreateDevelopmentPlanDto,
  AddDevelopmentActivityDto,
  NineBoxAssessmentDto,
  TalentSearchFilters,
} from "../types/succession.types";

const prisma = new PrismaClient();
const successionService = new SuccessionService(prisma);
const router = Router();

// Middleware for async error handling
const asyncHandler =
  (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════════════════
// CRITICAL POSITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/succession/critical-positions
 * @desc    List critical positions
 * @access  Private (HR, Executive)
 */
router.get(
  "/critical-positions",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      criticality,
      departmentId,
      hasSuccessors,
      riskLevel,
      page = 1,
      limit = 20,
    } = req.query;

    const positions = await successionService.listCriticalPositions(
      {
        criticality: criticality as PositionCriticality,
        departmentId: departmentId as string,
        hasSuccessors: hasSuccessors ? hasSuccessors === "true" : undefined,
        riskLevel: riskLevel as RiskLevel,
      },
      parseInt(page as string),
      parseInt(limit as string),
    );

    res.json({
      success: true,
      data: positions.data,
      pagination: {
        total: positions.total,
        page: positions.page,
        limit: positions.limit,
        totalPages: positions.totalPages,
      },
    });
  }),
);

/**
 * @route   GET /api/succession/critical-positions/:id
 * @desc    Get critical position details
 * @access  Private (HR, Executive)
 */
router.get(
  "/critical-positions/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const position = await successionService.getCriticalPosition(req.params.id);

    if (!position) {
      return res.status(404).json({
        success: false,
        error: "Critical position not found",
      });
    }

    res.json({
      success: true,
      data: position,
    });
  }),
);

/**
 * @route   POST /api/succession/critical-positions
 * @desc    Create critical position
 * @access  Private (HR Admin)
 */
router.post(
  "/critical-positions",
  asyncHandler(async (req: Request, res: Response) => {
    const data: CreateCriticalPositionDto = req.body;

    const position = await successionService.createCriticalPosition(data);

    res.status(201).json({
      success: true,
      data: position,
      message: "Critical position created successfully",
    });
  }),
);

/**
 * @route   PUT /api/succession/critical-positions/:id
 * @desc    Update critical position
 * @access  Private (HR Admin)
 */
router.put(
  "/critical-positions/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const position = await successionService.updateCriticalPosition(
      req.params.id,
      req.body,
    );

    res.json({
      success: true,
      data: position,
      message: "Critical position updated",
    });
  }),
);

/**
 * @route   POST /api/succession/critical-positions/:id/assess-risk
 * @desc    Assess position vacancy risk
 * @access  Private (HR)
 */
router.post(
  "/critical-positions/:id/assess-risk",
  asyncHandler(async (req: Request, res: Response) => {
    const assessment = await successionService.assessPositionRisk(
      req.params.id,
    );

    res.json({
      success: true,
      data: assessment,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// TALENT PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/succession/talent-profiles
 * @desc    Search talent profiles
 * @access  Private (HR, Manager)
 */
router.get(
  "/talent-profiles",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      departmentIds,
      nineBoxPositions,
      talentCategories,
      minPerformanceRating,
      minPotentialRating,
      flightRiskLevels,
      searchTerm,
      page = 1,
      limit = 50,
    } = req.query;

    const filters: TalentSearchFilters = {
      departmentIds: departmentIds
        ? (departmentIds as string).split(",")
        : undefined,
      nineBoxPositions: nineBoxPositions
        ? ((nineBoxPositions as string).split(",") as NineBoxPosition[])
        : undefined,
      talentCategories: talentCategories
        ? ((talentCategories as string).split(",") as TalentCategory[])
        : undefined,
      minPerformanceRating: minPerformanceRating
        ? parseInt(minPerformanceRating as string)
        : undefined,
      minPotentialRating: minPotentialRating
        ? parseInt(minPotentialRating as string)
        : undefined,
      flightRiskLevels: flightRiskLevels
        ? ((flightRiskLevels as string).split(",") as FlightRisk[])
        : undefined,
      searchTerm: searchTerm as string,
    };

    const profiles = await successionService.searchTalentProfiles(
      filters,
      parseInt(page as string),
      parseInt(limit as string),
    );

    res.json({
      success: true,
      data: profiles.data,
      pagination: {
        total: profiles.total,
        page: profiles.page,
        limit: profiles.limit,
        totalPages: profiles.totalPages,
      },
    });
  }),
);

/**
 * @route   GET /api/succession/talent-profiles/:employeeId
 * @desc    Get talent profile by employee ID
 * @access  Private (HR, Manager, Self)
 */
router.get(
  "/talent-profiles/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const profile = await successionService.getTalentProfile(
      req.params.employeeId,
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: "Talent profile not found",
      });
    }

    res.json({
      success: true,
      data: profile,
    });
  }),
);

/**
 * @route   POST /api/succession/talent-profiles/:employeeId
 * @desc    Create talent profile for employee
 * @access  Private (HR)
 */
router.post(
  "/talent-profiles/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const profile = await successionService.createTalentProfile(
      req.params.employeeId,
    );

    res.status(201).json({
      success: true,
      data: profile,
      message: "Talent profile created",
    });
  }),
);

/**
 * @route   PUT /api/succession/talent-profiles/:id
 * @desc    Update talent profile
 * @access  Private (HR)
 */
router.put(
  "/talent-profiles/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const data: UpdateTalentProfileDto = req.body;

    const profile = await successionService.updateTalentProfile(
      req.params.id,
      data,
    );

    res.json({
      success: true,
      data: profile,
      message: "Talent profile updated",
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// SUCCESSION PLANS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/succession/plans/:id
 * @desc    Get succession plan details
 * @access  Private (HR, Executive)
 */
router.get(
  "/plans/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const plan = await successionService.getSuccessionPlan(req.params.id);

    if (!plan) {
      return res.status(404).json({
        success: false,
        error: "Succession plan not found",
      });
    }

    res.json({
      success: true,
      data: plan,
    });
  }),
);

/**
 * @route   POST /api/succession/plans
 * @desc    Create succession plan
 * @access  Private (HR)
 */
router.post(
  "/plans",
  asyncHandler(async (req: Request, res: Response) => {
    const data: CreateSuccessionPlanDto = req.body;
    const createdBy = (req as any).user?.id || "system";

    const plan = await successionService.createSuccessionPlan(data, createdBy);

    res.status(201).json({
      success: true,
      data: plan,
      message: "Succession plan created",
    });
  }),
);

/**
 * @route   POST /api/succession/plans/:id/successors
 * @desc    Add successor to plan
 * @access  Private (HR)
 */
router.post(
  "/plans/:id/successors",
  asyncHandler(async (req: Request, res: Response) => {
    const data: AddSuccessorDto = {
      successionPlanId: req.params.id,
      ...req.body,
    };

    const successor = await successionService.addSuccessor(data);

    res.status(201).json({
      success: true,
      data: successor,
      message: "Successor added to plan",
    });
  }),
);

/**
 * @route   PUT /api/succession/successors/:id/readiness
 * @desc    Update successor readiness
 * @access  Private (HR)
 */
router.put(
  "/successors/:id/readiness",
  asyncHandler(async (req: Request, res: Response) => {
    const { readiness, notes } = req.body;

    const successor = await successionService.updateSuccessorReadiness(
      req.params.id,
      readiness as SuccessorReadiness,
      notes,
    );

    res.json({
      success: true,
      data: successor,
      message: "Successor readiness updated",
    });
  }),
);

/**
 * @route   DELETE /api/succession/successors/:id
 * @desc    Remove successor from plan
 * @access  Private (HR)
 */
router.delete(
  "/successors/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = req.body;

    await successionService.removeSuccessor(
      req.params.id,
      reason || "Removed by HR",
    );

    res.json({
      success: true,
      message: "Successor removed from plan",
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// DEVELOPMENT PLANS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   POST /api/succession/development-plans
 * @desc    Create development plan
 * @access  Private (HR, Manager)
 */
router.post(
  "/development-plans",
  asyncHandler(async (req: Request, res: Response) => {
    const data: CreateDevelopmentPlanDto = req.body;
    const createdBy = (req as any).user?.id || "system";

    const plan = await successionService.createDevelopmentPlan(data, createdBy);

    res.status(201).json({
      success: true,
      data: plan,
      message: "Development plan created",
    });
  }),
);

/**
 * @route   POST /api/succession/development-plans/:id/activities
 * @desc    Add activity to development plan
 * @access  Private (HR, Manager)
 */
router.post(
  "/development-plans/:id/activities",
  asyncHandler(async (req: Request, res: Response) => {
    const data: AddDevelopmentActivityDto = {
      developmentPlanId: req.params.id,
      ...req.body,
    };

    const activity = await successionService.addDevelopmentActivity(data);

    res.status(201).json({
      success: true,
      data: activity,
      message: "Development activity added",
    });
  }),
);

/**
 * @route   PUT /api/succession/activities/:id/progress
 * @desc    Update activity progress
 * @access  Private (Employee, Manager, HR)
 */
router.put(
  "/activities/:id/progress",
  asyncHandler(async (req: Request, res: Response) => {
    const { status, progress, notes } = req.body;

    const activity = await successionService.updateActivityProgress(
      req.params.id,
      status,
      progress,
      notes,
    );

    res.json({
      success: true,
      data: activity,
      message: "Activity progress updated",
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// TALENT POOLS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   POST /api/succession/talent-pools
 * @desc    Create talent pool
 * @access  Private (HR)
 */
router.post(
  "/talent-pools",
  asyncHandler(async (req: Request, res: Response) => {
    const createdBy = (req as any).user?.id || "system";

    const pool = await successionService.createTalentPool(req.body, createdBy);

    res.status(201).json({
      success: true,
      data: pool,
      message: "Talent pool created",
    });
  }),
);

/**
 * @route   POST /api/succession/talent-pools/:id/members
 * @desc    Add member to talent pool
 * @access  Private (HR)
 */
router.post(
  "/talent-pools/:id/members",
  asyncHandler(async (req: Request, res: Response) => {
    const { talentProfileId, reason } = req.body;
    const addedBy = (req as any).user?.id || "system";

    await successionService.addToTalentPool(
      req.params.id,
      talentProfileId,
      addedBy,
      reason,
    );

    res.status(201).json({
      success: true,
      message: "Member added to talent pool",
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// NINE BOX GRID
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   POST /api/succession/nine-box/assess
 * @desc    Assess employee in nine-box grid
 * @access  Private (HR, Manager)
 */
router.post(
  "/nine-box/assess",
  asyncHandler(async (req: Request, res: Response) => {
    const data: NineBoxAssessmentDto = req.body;
    const assessedBy = (req as any).user?.id || "system";

    const profile = await successionService.assessNineBox(data, assessedBy);

    res.json({
      success: true,
      data: profile,
      message: "Nine-box assessment completed",
    });
  }),
);

/**
 * @route   GET /api/succession/nine-box/distribution
 * @desc    Get nine-box distribution
 * @access  Private (HR, Executive)
 */
router.get(
  "/nine-box/distribution",
  asyncHandler(async (req: Request, res: Response) => {
    const { departmentId } = req.query;

    const distribution = await successionService.getNineBoxDistribution(
      departmentId as string,
    );

    res.json({
      success: true,
      data: distribution,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS & DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/succession/dashboard
 * @desc    Get succession dashboard data
 * @access  Private (HR, Executive)
 */
router.get(
  "/dashboard",
  asyncHandler(async (req: Request, res: Response) => {
    const dashboard = await successionService.getDashboardData();

    res.json({
      success: true,
      data: dashboard,
    });
  }),
);

/**
 * @route   GET /api/succession/analytics
 * @desc    Get succession analytics
 * @access  Private (HR, Executive)
 */
router.get(
  "/analytics",
  asyncHandler(async (req: Request, res: Response) => {
    const analytics = await successionService.getSuccessionAnalytics();

    res.json({
      success: true,
      data: analytics,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/succession/reports/at-risk-positions
 * @desc    Get at-risk positions report
 * @access  Private (HR, Executive)
 */
router.get(
  "/reports/at-risk-positions",
  asyncHandler(async (req: Request, res: Response) => {
    const positions = await successionService.listCriticalPositions(
      { riskLevel: RiskLevel.CRITICAL },
      1,
      100,
    );

    const highRisk = await successionService.listCriticalPositions(
      { riskLevel: RiskLevel.HIGH },
      1,
      100,
    );

    res.json({
      success: true,
      data: {
        critical: positions.data,
        high: highRisk.data,
        summary: {
          criticalCount: positions.total,
          highRiskCount: highRisk.total,
        },
      },
    });
  }),
);

/**
 * @route   GET /api/succession/reports/talent-pipeline
 * @desc    Get talent pipeline report
 * @access  Private (HR, Executive)
 */
router.get(
  "/reports/talent-pipeline",
  asyncHandler(async (req: Request, res: Response) => {
    const nineBoxDistribution =
      await successionService.getNineBoxDistribution();
    const analytics = await successionService.getSuccessionAnalytics();

    res.json({
      success: true,
      data: {
        nineBoxDistribution,
        talentDistribution: analytics.talentDistribution,
        successionHealth: analytics.successionHealth,
      },
    });
  }),
);

/**
 * @route   GET /api/succession/reports/high-potentials
 * @desc    Get high potentials report
 * @access  Private (HR, Executive)
 */
router.get(
  "/reports/high-potentials",
  asyncHandler(async (req: Request, res: Response) => {
    const hipos = await successionService.searchTalentProfiles(
      {
        talentCategories: [TalentCategory.HIGH_POTENTIAL],
      },
      1,
      100,
    );

    const highPerformers = await successionService.searchTalentProfiles(
      {
        talentCategories: [TalentCategory.HIGH_PERFORMER],
      },
      1,
      100,
    );

    res.json({
      success: true,
      data: {
        highPotentials: hipos.data,
        highPerformers: highPerformers.data,
        summary: {
          hipoCount: hipos.total,
          highPerformerCount: highPerformers.total,
        },
      },
    });
  }),
);

/**
 * @route   GET /api/succession/reports/flight-risk
 * @desc    Get flight risk report
 * @access  Private (HR, Executive)
 */
router.get(
  "/reports/flight-risk",
  asyncHandler(async (req: Request, res: Response) => {
    const veryHigh = await successionService.searchTalentProfiles(
      { flightRiskLevels: [FlightRisk.VERY_HIGH] },
      1,
      100,
    );

    const high = await successionService.searchTalentProfiles(
      { flightRiskLevels: [FlightRisk.HIGH] },
      1,
      100,
    );

    res.json({
      success: true,
      data: {
        veryHighRisk: veryHigh.data,
        highRisk: high.data,
        summary: {
          veryHighCount: veryHigh.total,
          highCount: high.total,
          totalAtRisk: veryHigh.total + high.total,
        },
      },
    });
  }),
);

// Error handling middleware
router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Succession API Error:", err);
  res.status(500).json({
    success: false,
    error: err.message || "Internal server error",
  });
});

export default router;
