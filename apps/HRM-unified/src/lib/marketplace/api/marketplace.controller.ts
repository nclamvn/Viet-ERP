// job-marketplace/api/marketplace.controller.ts

/**
 * LAC VIET HR - Internal Job Marketplace API Controller
 * REST API endpoints for internal mobility and career opportunities
 */

// @ts-ignore
import { Router, Request, Response, NextFunction } from "express";
import { MarketplaceService } from "../services/marketplace.service";
import { PrismaClient } from ".prisma/hrm-unified-client";
import {
  JobPostingStatus,
  JobType,
  ApplicationStatus,
} from "../types/marketplace.types";

const prisma = new PrismaClient();
const marketplaceService = new MarketplaceService(prisma);
const router = Router();

const asyncHandler =
  (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ═══════════════════════════════════════════════════════════════════════════════
// JOB POSTINGS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/postings",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      status,
      jobType,
      departmentId,
      locationId,
      gradeId,
      searchTerm,
      page = 1,
      limit = 20,
    } = req.query;
    const postings = await marketplaceService.listJobPostings(
      {
        status: status as JobPostingStatus,
        jobType: jobType as JobType,
        departmentId: departmentId as string,
        locationId: locationId as string,
        gradeId: gradeId as string,
        searchTerm: searchTerm as string,
      },
      parseInt(page as string),
      parseInt(limit as string),
    );
    res.json({ success: true, ...postings });
  }),
);

router.get(
  "/postings/available",
  asyncHandler(async (req: Request, res: Response) => {
    const employeeId = (req as any).user?.id;
    const postings =
      await marketplaceService.getActivePostingsForEmployee(employeeId);
    res.json({ success: true, data: postings });
  }),
);

router.get(
  "/postings/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const posting = await marketplaceService.getJobPosting(req.params.id);
    if (!posting)
      return res
        .status(404)
        .json({ success: false, error: "Posting not found" });
    res.json({ success: true, data: posting });
  }),
);

router.post(
  "/postings",
  asyncHandler(async (req: Request, res: Response) => {
    const createdBy = (req as any).user?.id || "system";
    const posting = await marketplaceService.createJobPosting(
      req.body,
      createdBy,
    );
    res
      .status(201)
      .json({ success: true, data: posting, message: "Job posting created" });
  }),
);

router.put(
  "/postings/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const posting = await marketplaceService.updateJobPosting(
      req.params.id,
      req.body,
    );
    res.json({ success: true, data: posting, message: "Job posting updated" });
  }),
);

router.post(
  "/postings/:id/submit",
  asyncHandler(async (req: Request, res: Response) => {
    const posting = await marketplaceService.submitForApproval(req.params.id);
    res.json({
      success: true,
      data: posting,
      message: "Submitted for approval",
    });
  }),
);

router.post(
  "/postings/:id/approve",
  asyncHandler(async (req: Request, res: Response) => {
    const approvedBy = (req as any).user?.id || "system";
    const posting = await marketplaceService.approvePosting(
      req.params.id,
      approvedBy,
    );
    res.json({
      success: true,
      data: posting,
      message: "Job posting approved and published",
    });
  }),
);

router.post(
  "/postings/:id/close",
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = req.body;
    const posting = await marketplaceService.closePosting(
      req.params.id,
      reason,
    );
    res.json({ success: true, data: posting, message: "Job posting closed" });
  }),
);

router.get(
  "/postings/:id/applications",
  asyncHandler(async (req: Request, res: Response) => {
    const applications = await marketplaceService.getApplicationsForPosting(
      req.params.id,
    );
    res.json({ success: true, data: applications });
  }),
);

router.get(
  "/postings/:id/talent-matches",
  asyncHandler(async (req: Request, res: Response) => {
    const { limit = 20 } = req.query;
    const matches = await marketplaceService.getTalentMatchesForPosting(
      req.params.id,
      parseInt(limit as string),
    );
    res.json({ success: true, data: matches });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// APPLICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/applications",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      jobPostingId,
      applicantId,
      status,
      hiringManagerId,
      page = 1,
      limit = 50,
    } = req.query;
    const applications = await marketplaceService.listApplications(
      {
        jobPostingId: jobPostingId as string,
        applicantId: applicantId as string,
        status: status as ApplicationStatus,
        hiringManagerId: hiringManagerId as string,
      },
      parseInt(page as string),
      parseInt(limit as string),
    );
    res.json({ success: true, ...applications });
  }),
);

router.get(
  "/applications/my",
  asyncHandler(async (req: Request, res: Response) => {
    const applicantId = (req as any).user?.id;
    const applications = await marketplaceService.listApplications(
      { applicantId },
      1,
      100,
    );
    res.json({ success: true, data: applications.data });
  }),
);

router.post(
  "/applications",
  asyncHandler(async (req: Request, res: Response) => {
    const applicantId = (req as any).user?.id || req.body.applicantId;
    const application = await marketplaceService.submitApplication(
      req.body,
      applicantId,
    );
    res
      .status(201)
      .json({
        success: true,
        data: application,
        message: "Application submitted",
      });
  }),
);

router.patch(
  "/applications/:id/status",
  asyncHandler(async (req: Request, res: Response) => {
    const updatedBy = (req as any).user?.id || "system";
    const { status, notes } = req.body;
    const application = await marketplaceService.updateApplicationStatus(
      req.params.id,
      status,
      updatedBy,
      notes,
    );
    res.json({ success: true, data: application, message: "Status updated" });
  }),
);

router.post(
  "/applications/:id/withdraw",
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = req.body;
    const application = await marketplaceService.withdrawApplication(
      req.params.id,
      reason,
    );
    res.json({
      success: true,
      data: application,
      message: "Application withdrawn",
    });
  }),
);

router.post(
  "/applications/:id/manager-approval",
  asyncHandler(async (req: Request, res: Response) => {
    const managerId = (req as any).user?.id;
    const { approved, comments } = req.body;
    const application = await marketplaceService.approveByManager(
      req.params.id,
      managerId,
      approved,
      comments,
    );
    res.json({
      success: true,
      data: application,
      message: approved ? "Approved" : "Declined",
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// INTERVIEWS
// ═══════════════════════════════════════════════════════════════════════════════

router.post(
  "/interviews",
  asyncHandler(async (req: Request, res: Response) => {
    const interview = await marketplaceService.scheduleInterview(req.body);
    res
      .status(201)
      .json({ success: true, data: interview, message: "Interview scheduled" });
  }),
);

router.post(
  "/interviews/:id/feedback",
  asyncHandler(async (req: Request, res: Response) => {
    const interviewerId = (req as any).user?.id;
    const interview = await marketplaceService.submitInterviewFeedback(
      { interviewId: req.params.id, ...req.body },
      interviewerId,
    );
    res.json({ success: true, data: interview, message: "Feedback submitted" });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// OFFERS
// ═══════════════════════════════════════════════════════════════════════════════

router.post(
  "/offers",
  asyncHandler(async (req: Request, res: Response) => {
    const createdBy = (req as any).user?.id || "system";
    const offer = await marketplaceService.createOffer(req.body, createdBy);
    res
      .status(201)
      .json({ success: true, data: offer, message: "Offer created" });
  }),
);

router.post(
  "/offers/:id/send",
  asyncHandler(async (req: Request, res: Response) => {
    const offer = await marketplaceService.sendOffer(req.params.id);
    res.json({ success: true, data: offer, message: "Offer sent" });
  }),
);

router.post(
  "/offers/:id/respond",
  asyncHandler(async (req: Request, res: Response) => {
    const { accepted, declineReason } = req.body;
    const offer = await marketplaceService.respondToOffer(
      req.params.id,
      accepted,
      declineReason,
    );
    res.json({
      success: true,
      data: offer,
      message: accepted ? "Offer accepted" : "Offer declined",
    });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CAREER PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/profile",
  asyncHandler(async (req: Request, res: Response) => {
    const employeeId = (req as any).user?.id;
    const profile =
      await marketplaceService.getOrCreateCareerProfile(employeeId);
    res.json({ success: true, data: profile });
  }),
);

router.get(
  "/profile/:employeeId",
  asyncHandler(async (req: Request, res: Response) => {
    const profile = await marketplaceService.getOrCreateCareerProfile(
      req.params.employeeId,
    );
    res.json({ success: true, data: profile });
  }),
);

router.put(
  "/profile",
  asyncHandler(async (req: Request, res: Response) => {
    const employeeId = (req as any).user?.id;
    const profile = await marketplaceService.updateCareerProfile(
      employeeId,
      req.body,
    );
    res.json({ success: true, data: profile, message: "Profile updated" });
  }),
);

router.post(
  "/profile/bookmark/:jobPostingId",
  asyncHandler(async (req: Request, res: Response) => {
    const employeeId = (req as any).user?.id;
    await marketplaceService.bookmarkJob(employeeId, req.params.jobPostingId);
    res.json({ success: true, message: "Job bookmarked" });
  }),
);

router.delete(
  "/profile/bookmark/:jobPostingId",
  asyncHandler(async (req: Request, res: Response) => {
    const employeeId = (req as any).user?.id;
    await marketplaceService.removeBookmark(
      employeeId,
      req.params.jobPostingId,
    );
    res.json({ success: true, message: "Bookmark removed" });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// RECOMMENDATIONS & MATCHING
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/recommendations/jobs",
  asyncHandler(async (req: Request, res: Response) => {
    const employeeId = (req as any).user?.id;
    const { limit = 10 } = req.query;
    const recommendations =
      await marketplaceService.getRecommendedJobsForEmployee(
        employeeId,
        parseInt(limit as string),
      );
    res.json({ success: true, data: recommendations });
  }),
);

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARDS
// ═══════════════════════════════════════════════════════════════════════════════

router.get(
  "/dashboard/employee",
  asyncHandler(async (req: Request, res: Response) => {
    const employeeId = (req as any).user?.id;
    const dashboard = await marketplaceService.getEmployeeDashboard(employeeId);
    res.json({ success: true, data: dashboard });
  }),
);

router.get(
  "/dashboard/manager",
  asyncHandler(async (req: Request, res: Response) => {
    const managerId = (req as any).user?.id;
    const dashboard = await marketplaceService.getManagerDashboard(managerId);
    res.json({ success: true, data: dashboard });
  }),
);

router.get(
  "/analytics",
  asyncHandler(async (req: Request, res: Response) => {
    const analytics = await marketplaceService.getMarketplaceAnalytics();
    res.json({ success: true, data: analytics });
  }),
);

// Error handling
router.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Marketplace API Error:", err);
  res
    .status(500)
    .json({ success: false, error: err.message || "Internal server error" });
});

export default router;
