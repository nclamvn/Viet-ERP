// benefits-administration/api/benefits.controller.ts

/**
 * LAC VIET HR - Benefits Administration API Controller
 * REST API endpoints for employee benefits management
 */

// @ts-ignore
import { Router, Request, Response, NextFunction } from "express";
import { BenefitsService } from "../services/benefits.service";
import { PrismaClient } from ".prisma/hrm-ai-client";
import {
  BenefitCategory,
  BenefitType,
  EnrollmentStatus,
  ClaimStatus,
} from "../types/benefits.types";

const prisma = new PrismaClient();
const benefitsService = new BenefitsService(prisma);
const router = Router();

const asyncHandler =
  (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════════════════
// BENEFIT PLANS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/plans",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      category,
      planType,
      isActive,
      planYear,
      page = 1,
      limit = 20,
    } = req.query;
    const plans = await benefitsService.listBenefitPlans(
      {
        category: category as BenefitCategory,
        planType: planType as BenefitType,
        isActive:
          isActive === "true" ? true : isActive === "false" ? false : undefined,
        planYear: planYear ? parseInt(planYear as string) : undefined,
      },
      parseInt(page as string),
      parseInt(limit as string),
    );
    res.json({
      success: true,
      data: plans.data,
      pagination: {
        total: plans.total,
        page: plans.page,
        limit: plans.limit,
        totalPages: plans.totalPages,
      },
    });
  }),
);

router.get(
  "/plans/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const plan = await benefitsService.getBenefitPlan(req.params.id);
    if (!plan)
      return res.status(404).json({ success: false, error: "Plan not found" });
    res.json({ success: true, data: plan });
  }),
);

router.post(
  "/plans",
  asyncHandler(async (req: Request, res: Response) => {
    const plan = await benefitsService.createBenefitPlan(req.body);
    res
      .status(201)
      .json({ success: true, data: plan, message: "Benefit plan created" });
  }),
);

router.put(
  "/plans/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const plan = await benefitsService.updateBenefitPlan(
      req.params.id,
      req.body,
    );
    res.json({ success: true, data: plan, message: "Benefit plan updated" });
  }),
);

router.get(
  "/plans/eligible/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const plans = await benefitsService.getEligiblePlansForEmployee(
      req.params.employeeId,
    );
    res.json({ success: true, data: plans });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ENROLLMENT PERIODS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/enrollment-periods",
  asyncHandler(async (req: Request, res: Response) => {
    const periods = await benefitsService.getActiveEnrollmentPeriods();
    res.json({ success: true, data: periods });
  }),
);

router.post(
  "/enrollment-periods",
  asyncHandler(async (req: Request, res: Response) => {
    const createdBy = (req as any).user?.id || "system";
    const period = await benefitsService.createEnrollmentPeriod(
      req.body,
      createdBy,
    );
    res
      .status(201)
      .json({
        success: true,
        data: period,
        message: "Enrollment period created",
      });
  }),
);

router.post(
  "/enrollment-periods/:id/lock",
  asyncHandler(async (req: Request, res: Response) => {
    const period = await benefitsService.lockEnrollmentPeriod(req.params.id);
    res.json({
      success: true,
      data: period,
      message: "Enrollment period locked",
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ENROLLMENTS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/enrollments",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      employeeId,
      planId,
      status,
      enrollmentPeriodId,
      page = 1,
      limit = 50,
    } = req.query;
    const enrollments = await benefitsService.listEnrollments(
      {
        employeeId: employeeId as string,
        planId: planId as string,
        status: status as EnrollmentStatus,
        enrollmentPeriodId: enrollmentPeriodId as string,
      } as any,
      parseInt(page as string),
      parseInt(limit as string),
    );
    res.json({
      success: true,
      data: enrollments.data,
      pagination: {
        total: enrollments.total,
        page: enrollments.page,
        limit: enrollments.limit,
        totalPages: enrollments.totalPages,
      },
    });
  }),
);

router.get(
  "/enrollments/employee/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const { activeOnly = "true" } = req.query;
    const enrollments = await benefitsService.getEmployeeEnrollments(
      req.params.employeeId,
      activeOnly === "true",
    );
    res.json({ success: true, data: enrollments });
  }),
);

router.post(
  "/enrollments",
  asyncHandler(async (req: Request, res: Response) => {
    const enrolledBy = (req as any).user?.id || "system";
    const enrollment = await benefitsService.createEnrollment(
      req.body,
      enrolledBy,
    );
    res
      .status(201)
      .json({ success: true, data: enrollment, message: "Enrollment created" });
  }),
);

router.post(
  "/enrollments/:id/approve",
  asyncHandler(async (req: Request, res: Response) => {
    const approvedBy = (req as any).user?.id || "system";
    const enrollment = await benefitsService.approveEnrollment(
      req.params.id,
      approvedBy,
    );
    res.json({
      success: true,
      data: enrollment,
      message: "Enrollment approved",
    });
  }),
);

router.post(
  "/enrollments/:id/terminate",
  asyncHandler(async (req: Request, res: Response) => {
    const terminatedBy = (req as any).user?.id || "system";
    const { terminationDate, reason } = req.body;
    const enrollment = await benefitsService.terminateEnrollment(
      req.params.id,
      new Date(terminationDate),
      reason,
      terminatedBy,
    );
    res.json({
      success: true,
      data: enrollment,
      message: "Enrollment terminated",
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// DEPENDENTS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/dependents/employee/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const dependents = await benefitsService.getEmployeeDependents(
      req.params.employeeId,
    );
    res.json({ success: true, data: dependents });
  }),
);

router.post(
  "/dependents",
  asyncHandler(async (req: Request, res: Response) => {
    const dependent = await benefitsService.addDependent(req.body);
    res
      .status(201)
      .json({ success: true, data: dependent, message: "Dependent added" });
  }),
);

router.put(
  "/dependents/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const dependent = await benefitsService.updateDependent(
      req.params.id,
      req.body,
    );
    res.json({ success: true, data: dependent, message: "Dependent updated" });
  }),
);

router.post(
  "/dependents/:id/verify",
  asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.body;
    const verifiedBy = (req as any).user?.id || "system";
    const dependent = await benefitsService.verifyDependent(
      req.params.id,
      status,
      verifiedBy,
    );
    res.json({
      success: true,
      data: dependent,
      message: `Dependent ${status.toLowerCase()}`,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// LIFE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/life-events/employee/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const events = await benefitsService.getEmployeeLifeEvents(
      req.params.employeeId,
    );
    res.json({ success: true, data: events });
  }),
);

router.get(
  "/life-events/pending",
  asyncHandler(async (req: Request, res: Response) => {
    const events = await benefitsService.getPendingLifeEvents();
    res.json({ success: true, data: events });
  }),
);

router.post(
  "/life-events",
  asyncHandler(async (req: Request, res: Response) => {
    const event = await benefitsService.createLifeEvent(req.body);
    res
      .status(201)
      .json({ success: true, data: event, message: "Life event submitted" });
  }),
);

router.post(
  "/life-events/:id/approve",
  asyncHandler(async (req: Request, res: Response) => {
    const reviewedBy = (req as any).user?.id || "system";
    const { notes } = req.body;
    const event = await benefitsService.approveLifeEvent(
      req.params.id,
      reviewedBy,
      notes,
    );
    res.json({ success: true, data: event, message: "Life event approved" });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIMS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/claims/employee/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const { page = 1, limit = 20 } = req.query;
    const claims = await benefitsService.getEmployeeClaims(
      req.params.employeeId,
      parseInt(page as string),
      parseInt(limit as string),
    );
    res.json({
      success: true,
      data: claims.data,
      pagination: {
        total: claims.total,
        page: claims.page,
        limit: claims.limit,
        totalPages: claims.totalPages,
      },
    });
  }),
);

router.get(
  "/claims/pending",
  asyncHandler(async (req: Request, res: Response) => {
    const { page = 1, limit = 50 } = req.query;
    const claims = await benefitsService.getPendingClaims(
      parseInt(page as string),
      parseInt(limit as string),
    );
    res.json({
      success: true,
      data: claims.data,
      pagination: {
        total: claims.total,
        page: claims.page,
        limit: claims.limit,
        totalPages: claims.totalPages,
      },
    });
  }),
);

router.post(
  "/claims",
  asyncHandler(async (req: Request, res: Response) => {
    const submittedBy = (req as any).user?.id || req.body.employeeId;
    const claim = await benefitsService.submitClaim(req.body, submittedBy);
    res
      .status(201)
      .json({ success: true, data: claim, message: "Claim submitted" });
  }),
);

router.post(
  "/claims/:id/review",
  asyncHandler(async (req: Request, res: Response) => {
    const reviewedBy = (req as any).user?.id || "system";
    const { status, ...data } = req.body;
    const claim = await benefitsService.reviewClaim(
      req.params.id,
      status,
      reviewedBy,
      data,
    );
    res.json({
      success: true,
      data: claim,
      message: `Claim ${status.toLowerCase()}`,
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// FLEXIBLE BENEFITS
// ═══════════════════════════════════════════════════════════════════════════════

router.post(
  "/flex-accounts",
  asyncHandler(async (req: Request, res: Response) => {
    const { employeeId, planYear, totalPoints, pointValue } = req.body;
    const account = await benefitsService.createFlexAccount(
      employeeId,
      planYear,
      totalPoints,
      pointValue,
    );
    res
      .status(201)
      .json({ success: true, data: account, message: "Flex account created" });
  }),
);

router.post(
  "/flex-accounts/:id/select",
  asyncHandler(async (req: Request, res: Response) => {
    const { planId, coverageOptionId, pointsToUse } = req.body;
    const account = await benefitsService.selectFlexBenefit(
      req.params.id,
      planId,
      coverageOptionId,
      pointsToUse,
    );
    res.json({ success: true, data: account, message: "Benefit selected" });
  }),
);

router.post(
  "/flex-accounts/:id/submit",
  asyncHandler(async (req: Request, res: Response) => {
    const account = await benefitsService.submitFlexSelections(req.params.id);
    res.json({ success: true, data: account, message: "Selections submitted" });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS & SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/analytics",
  asyncHandler(async (req: Request, res: Response) => {
    const { planYear = new Date().getFullYear() } = req.query;
    const analytics = await benefitsService.getBenefitsAnalytics(
      parseInt(planYear as string),
    );
    res.json({ success: true, data: analytics });
  }),
);

router.get(
  "/summary/employee/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const summary = await benefitsService.getEmployeeBenefitsSummary(
      req.params.employeeId,
    );
    res.json({ success: true, data: summary });
  }),
);

// Error handling
router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Benefits API Error:", err);
  res
    .status(500)
    .json({ success: false, error: err.message || "Internal server error" });
});

export default router;
