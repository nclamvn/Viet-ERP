// compensation-planning/api/compensation.controller.ts

/**
 * LAC VIET HR - Compensation Planning API Controller
 * REST API endpoints for compensation management
 */

// @ts-ignore
import { Router, Request, Response, NextFunction } from "express";
import { CompensationService } from "../services/compensation.service";
import { PrismaClient } from ".prisma/hrm-ai-client";
import {
  CompensationCycleStatus,
  AdjustmentType,
  ApprovalStatus,
  CreateCompensationCycleDto,
  CreateAdjustmentDto,
  ApproveAdjustmentDto,
  AdjustmentFilters,
} from "../types/compensation.types";

const prisma = new PrismaClient();
const compensationService = new CompensationService(prisma);
const router = Router();

// Middleware for async error handling
const asyncHandler =
  (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════════════════
// COMPENSATION CYCLES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/compensation/cycles
 * @desc    List compensation cycles
 * @access  Private (HR, Admin)
 */
router.get(
  "/cycles",
  asyncHandler(async (req: Request, res: Response) => {
    const { fiscalYear, status, page = 1, limit = 20 } = req.query;

    const cycles = await compensationService.listCompensationCycles(
      {
        fiscalYear: fiscalYear ? parseInt(fiscalYear as string) : undefined,
        status: status as CompensationCycleStatus,
      },
      parseInt(page as string),
      parseInt(limit as string),
    );

    res.json({
      success: true,
      data: cycles.data,
      pagination: {
        total: cycles.total,
        page: cycles.page,
        limit: cycles.limit,
        totalPages: cycles.totalPages,
      },
    });
  }),
);

/**
 * @route   GET /api/compensation/cycles/:id
 * @desc    Get compensation cycle details
 * @access  Private (HR, Admin)
 */
router.get(
  "/cycles/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const cycle = await compensationService.getCompensationCycle(req.params.id);

    if (!cycle) {
      return res.status(404).json({
        success: false,
        error: "Compensation cycle not found",
      });
    }

    res.json({
      success: true,
      data: cycle,
    });
  }),
);

/**
 * @route   POST /api/compensation/cycles
 * @desc    Create new compensation cycle
 * @access  Private (HR Admin)
 */
router.post(
  "/cycles",
  asyncHandler(async (req: Request, res: Response) => {
    const data: CreateCompensationCycleDto = req.body;
    const createdBy = (req as any).user?.id || "system";

    const cycle = await compensationService.createCompensationCycle(
      data,
      createdBy,
    );

    res.status(201).json({
      success: true,
      data: cycle,
      message: "Compensation cycle created successfully",
    });
  }),
);

/**
 * @route   PATCH /api/compensation/cycles/:id/status
 * @desc    Update cycle status
 * @access  Private (HR Admin)
 */
router.patch(
  "/cycles/:id/status",
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.body;

    const cycle = await compensationService.updateCycleStatus(
      req.params.id,
      status,
    );

    res.json({
      success: true,
      data: cycle,
      message: `Cycle status updated to ${status}`,
    });
  }),
);

/**
 * @route   GET /api/compensation/cycles/:id/budget
 * @desc    Get cycle budget summary
 * @access  Private (HR, Manager)
 */
router.get(
  "/cycles/:id/budget",
  asyncHandler(async (req: Request, res: Response) => {
    const summary = await compensationService.getBudgetSummary(req.params.id);

    res.json({
      success: true,
      data: summary,
    });
  }),
);

/**
 * @route   PUT /api/compensation/cycles/:id/budget/:departmentId
 * @desc    Update department budget allocation
 * @access  Private (HR Admin)
 */
router.put(
  "/cycles/:id/budget/:departmentId",
  asyncHandler(async (req: Request, res: Response) => {
    const pool = await compensationService.updateBudgetAllocation(
      req.params.id,
      req.params.departmentId,
      req.body,
    );

    res.json({
      success: true,
      data: pool,
      message: "Budget allocation updated",
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// MERIT MATRIX
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   POST /api/compensation/cycles/:id/merit-matrix
 * @desc    Create merit matrix for cycle
 * @access  Private (HR Admin)
 */
router.post(
  "/cycles/:id/merit-matrix",
  asyncHandler(async (req: Request, res: Response) => {
    const matrix = await compensationService.createMeritMatrix(
      req.params.id,
      req.body,
    );

    res.status(201).json({
      success: true,
      data: matrix,
      message: "Merit matrix created",
    });
  }),
);

/**
 * @route   GET /api/compensation/merit-matrix/:matrixId/recommend
 * @desc    Get recommended increase from matrix
 * @access  Private (HR, Manager)
 */
router.get(
  "/merit-matrix/:matrixId/recommend",
  asyncHandler(async (req: Request, res: Response) => {
    const { performanceRating, compaRatio } = req.query;

    const recommendation = await compensationService.getRecommendedIncrease(
      req.params.matrixId,
      performanceRating as string,
      parseFloat(compaRatio as string),
    );

    res.json({
      success: true,
      data: recommendation,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ADJUSTMENTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/compensation/adjustments
 * @desc    List compensation adjustments
 * @access  Private (HR, Manager)
 */
router.get(
  "/adjustments",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      cycleId,
      departmentId,
      managerId,
      status,
      adjustmentType,
      employeeSearch,
      page = 1,
      limit = 50,
    } = req.query;

    if (!cycleId) {
      return res.status(400).json({
        success: false,
        error: "cycleId is required",
      });
    }

    const filters: AdjustmentFilters = {
      cycleId: cycleId as string,
      departmentId: departmentId as string,
      managerId: managerId as string,
      status: status as ApprovalStatus,
      adjustmentType: adjustmentType as AdjustmentType,
      employeeSearch: employeeSearch as string,
    };

    const adjustments = await compensationService.listAdjustments(
      filters,
      parseInt(page as string),
      parseInt(limit as string),
    );

    res.json({
      success: true,
      data: adjustments.data,
      pagination: {
        total: adjustments.total,
        page: adjustments.page,
        limit: adjustments.limit,
        totalPages: adjustments.totalPages,
      },
    });
  }),
);

/**
 * @route   POST /api/compensation/adjustments
 * @desc    Create compensation adjustment
 * @access  Private (HR, Manager)
 */
router.post(
  "/adjustments",
  asyncHandler(async (req: Request, res: Response) => {
    const data: CreateAdjustmentDto = req.body;
    const proposedBy = (req as any).user?.id || "system";

    const adjustment = await compensationService.createAdjustment(
      data,
      proposedBy,
    );

    res.status(201).json({
      success: true,
      data: adjustment,
      message: "Compensation adjustment created",
    });
  }),
);

/**
 * @route   POST /api/compensation/adjustments/bulk
 * @desc    Create multiple adjustments
 * @access  Private (HR)
 */
router.post(
  "/adjustments/bulk",
  asyncHandler(async (req: Request, res: Response) => {
    const { cycleId, adjustments } = req.body;
    const proposedBy = (req as any).user?.id || "system";

    const created = await compensationService.createBulkAdjustments(
      { cycleId, adjustments },
      proposedBy,
    );

    res.status(201).json({
      success: true,
      data: created,
      message: `${created.length} adjustments created`,
    });
  }),
);

/**
 * @route   POST /api/compensation/adjustments/:id/approve
 * @desc    Approve/reject/request revision for adjustment
 * @access  Private (Manager, HR)
 */
router.post(
  "/adjustments/:id/approve",
  asyncHandler(async (req: Request, res: Response) => {
    const data: ApproveAdjustmentDto = {
      adjustmentId: req.params.id,
      ...req.body,
    };
    const approverId = (req as any).user?.id || "system";

    const adjustment = await compensationService.approveAdjustment(
      data,
      approverId,
    );

    res.json({
      success: true,
      data: adjustment,
      message: `Adjustment ${data.action.toLowerCase()}`,
    });
  }),
);

/**
 * @route   POST /api/compensation/adjustments/bulk-approve
 * @desc    Bulk approve adjustments
 * @access  Private (HR)
 */
router.post(
  "/adjustments/bulk-approve",
  asyncHandler(async (req: Request, res: Response) => {
    const { adjustmentIds, comments } = req.body;
    const approverId = (req as any).user?.id || "system";

    const count = await compensationService.bulkApproveAdjustments(
      adjustmentIds,
      approverId,
      comments,
    );

    res.json({
      success: true,
      data: { approvedCount: count },
      message: `${count} adjustments approved`,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// SALARY STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/compensation/salary-grades
 * @desc    List salary grades
 * @access  Private (HR)
 */
router.get(
  "/salary-grades",
  asyncHandler(async (req: Request, res: Response) => {
    const { includeInactive } = req.query;

    const grades = await compensationService.listSalaryGrades(
      includeInactive === "true",
    );

    res.json({
      success: true,
      data: grades,
    });
  }),
);

/**
 * @route   POST /api/compensation/salary-grades
 * @desc    Create salary grade
 * @access  Private (HR Admin)
 */
router.post(
  "/salary-grades",
  asyncHandler(async (req: Request, res: Response) => {
    const grade = await compensationService.createSalaryGrade(req.body);

    res.status(201).json({
      success: true,
      data: grade,
      message: "Salary grade created",
    });
  }),
);

/**
 * @route   PUT /api/compensation/salary-grades/:id
 * @desc    Update salary grade
 * @access  Private (HR Admin)
 */
router.put(
  "/salary-grades/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const grade = await compensationService.updateSalaryGrade(
      req.params.id,
      req.body,
    );

    res.json({
      success: true,
      data: grade,
      message: "Salary grade updated",
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// TOTAL REWARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/compensation/total-rewards/:employeeId
 * @desc    Get employee total rewards statement
 * @access  Private (Employee - self, HR, Manager)
 */
router.get(
  "/total-rewards/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const { year = new Date().getFullYear() } = req.query;

    const statement = await compensationService.generateTotalRewardsStatement(
      req.params.employeeId,
      parseInt(year as string),
    );

    res.json({
      success: true,
      data: statement,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/compensation/analytics
 * @desc    Get compensation analytics
 * @access  Private (HR, Executive)
 */
router.get(
  "/analytics",
  asyncHandler(async (req: Request, res: Response) => {
    const { cycleId } = req.query;

    const analytics = await compensationService.getCompensationAnalytics(
      cycleId as string,
    );

    res.json({
      success: true,
      data: analytics,
    });
  }),
);

/**
 * @route   GET /api/compensation/cycles/:id/analytics
 * @desc    Get cycle-specific analytics
 * @access  Private (HR)
 */
router.get(
  "/cycles/:id/analytics",
  asyncHandler(async (req: Request, res: Response) => {
    const analytics = await compensationService.getCompensationAnalytics(
      req.params.id,
    );

    res.json({
      success: true,
      data: analytics,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// MANAGER VIEWS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/compensation/my-team
 * @desc    Get manager's team compensation data
 * @access  Private (Manager)
 */
router.get(
  "/my-team",
  asyncHandler(async (req: Request, res: Response) => {
    const managerId = (req as any).user?.id;
    const { cycleId } = req.query;

    if (!cycleId) {
      return res.status(400).json({
        success: false,
        error: "cycleId is required",
      });
    }

    const adjustments = await compensationService.listAdjustments(
      { cycleId: cycleId as string, managerId },
      1,
      100,
    );

    const budget = await compensationService.getBudgetSummary(
      cycleId as string,
    );

    res.json({
      success: true,
      data: {
        adjustments: adjustments.data,
        budget,
      },
    });
  }),
);

/**
 * @route   GET /api/compensation/pending-approvals
 * @desc    Get pending approvals for current user
 * @access  Private (Manager, HR)
 */
router.get(
  "/pending-approvals",
  asyncHandler(async (req: Request, res: Response) => {
    const managerId = (req as any).user?.id;
    const { cycleId, page = 1, limit = 20 } = req.query;

    if (!cycleId) {
      return res.status(400).json({
        success: false,
        error: "cycleId is required",
      });
    }

    const adjustments = await compensationService.listAdjustments(
      {
        cycleId: cycleId as string,
        managerId,
        status: ApprovalStatus.PENDING,
      },
      parseInt(page as string),
      parseInt(limit as string),
    );

    res.json({
      success: true,
      data: adjustments.data,
      pagination: {
        total: adjustments.total,
        page: adjustments.page,
        limit: adjustments.limit,
        totalPages: adjustments.totalPages,
      },
    });
  }),
);

// Error handling middleware
router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Compensation API Error:", err);
  res.status(500).json({
    success: false,
    error: err.message || "Internal server error",
  });
});

export default router;
