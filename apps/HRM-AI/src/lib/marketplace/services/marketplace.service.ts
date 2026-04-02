// @ts-nocheck - Prisma models not yet in schema (Phase 6)
// job-marketplace/services/marketplace.service.ts

/**
 * LAC VIET HR - Internal Job Marketplace Service
 * Business logic for internal mobility and career opportunities
 */

import { PrismaClient, Prisma } from ".prisma/hrm-ai-client";
import {
  InternalJobPosting,
  JobPostingStatus,
  JobType,
  JobApplication,
  ApplicationStatus,
  CareerProfile,
  JobMatch,
  TalentMatch,
  Interview,
  OfferDetails,
  MarketplaceAnalytics,
  MarketplaceDashboard,
  SkillMatchLevel,
  CreateJobPostingDto,
  SubmitApplicationDto,
  UpdateCareerProfileDto,
  ScheduleInterviewDto,
  SubmitInterviewFeedbackDto,
  CreateOfferDto,
  JobPostingFilters,
  ApplicationFilters,
} from "../types/marketplace.types";
import { v4 as uuidv4 } from "uuid";

export class MarketplaceService {
  constructor(private prisma: PrismaClient) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // JOB POSTINGS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createJobPosting(
    data: CreateJobPostingDto,
    createdBy: string,
  ): Promise<InternalJobPosting> {
    const code = await this.generatePostingCode();

    // Get department and hiring manager info
    const department = await this.prisma.department.findUnique({
      where: { id: data.departmentId },
    });
    const creator = await this.prisma.employee.findUnique({
      where: { id: createdBy },
    });

    const posting = await this.prisma.internalJobPosting.create({
      data: {
        code,
        title: data.title,
        description: data.description,
        jobType: data.jobType,
        departmentId: data.departmentId,
        departmentName: department?.name || "",
        locationId: data.locationId,
        positionId: data.positionId,
        gradeId: data.gradeId,
        requirements: data.requirements as unknown as Prisma.JsonArray,
        preferredSkills: data.preferredSkills || [],
        minExperienceYears: data.minExperienceYears,
        showCompensation: false,
        isTemporary: data.isTemporary,
        durationMonths: data.durationMonths,
        eligibilityCriteria:
          data.eligibilityCriteria as unknown as Prisma.JsonObject,
        status: JobPostingStatus.DRAFT,
        applicationDeadline: data.applicationDeadline,
        requiresApproval: true,
        viewCount: 0,
        applicationCount: 0,
        bookmarkCount: 0,
        hiringManagerId: createdBy,
        hiringManagerName: `${creator?.firstName} ${creator?.lastName}`,
        interviewerIds: [],
        visibility: data.visibility,
        visibleToDepartmentIds: data.visibleToDepartmentIds || [],
        tags: [],
        createdBy,
      },
    });

    return posting as unknown as InternalJobPosting;
  }

  async updateJobPosting(
    postingId: string,
    data: Partial<InternalJobPosting>,
  ): Promise<InternalJobPosting> {
    const posting = await this.prisma.internalJobPosting.update({
      where: { id: postingId },
      data: {
        ...data,
        requirements: data.requirements as unknown as Prisma.JsonArray,
        eligibilityCriteria:
          data.eligibilityCriteria as unknown as Prisma.JsonObject,
      },
    });

    return posting as unknown as InternalJobPosting;
  }

  async submitForApproval(postingId: string): Promise<InternalJobPosting> {
    return this.prisma.internalJobPosting.update({
      where: { id: postingId },
      data: { status: JobPostingStatus.PENDING_APPROVAL },
    }) as unknown as InternalJobPosting;
  }

  async approvePosting(
    postingId: string,
    approvedBy: string,
  ): Promise<InternalJobPosting> {
    return this.prisma.internalJobPosting.update({
      where: { id: postingId },
      data: {
        status: JobPostingStatus.PUBLISHED,
        approvedBy,
        approvedAt: new Date(),
        postedDate: new Date(),
      },
    }) as unknown as InternalJobPosting;
  }

  async closePosting(
    postingId: string,
    reason: "FILLED" | "CANCELLED",
  ): Promise<InternalJobPosting> {
    return this.prisma.internalJobPosting.update({
      where: { id: postingId },
      data: {
        status:
          reason === "FILLED"
            ? JobPostingStatus.FILLED
            : JobPostingStatus.CANCELLED,
      },
    }) as unknown as InternalJobPosting;
  }

  async getJobPosting(postingId: string): Promise<InternalJobPosting | null> {
    const posting = await this.prisma.internalJobPosting.findUnique({
      where: { id: postingId },
    });

    if (posting) {
      // Increment view count
      await this.prisma.internalJobPosting.update({
        where: { id: postingId },
        data: { viewCount: { increment: 1 } },
      });
    }

    return posting as unknown as InternalJobPosting;
  }

  async listJobPostings(
    filters: JobPostingFilters,
    page: number = 1,
    limit: number = 20,
  ) {
    const where: Prisma.InternalJobPostingWhereInput = {};

    if (filters.status) where.status = filters.status;
    if (filters.jobType) where.jobType = filters.jobType;
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.locationId) where.locationId = filters.locationId;
    if (filters.gradeId) where.gradeId = filters.gradeId;
    if (filters.searchTerm) {
      where.OR = [
        { title: { contains: filters.searchTerm, mode: "insensitive" } },
        { description: { contains: filters.searchTerm, mode: "insensitive" } },
      ];
    }

    const [postings, total] = await Promise.all([
      this.prisma.internalJobPosting.findMany({
        where,
        orderBy: { postedDate: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.internalJobPosting.count({ where }),
    ]);

    return {
      data: postings,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getActivePostingsForEmployee(
    employeeId: string,
  ): Promise<InternalJobPosting[]> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { department: true },
    });

    if (!employee) return [];

    // Get all published postings
    const postings = await this.prisma.internalJobPosting.findMany({
      where: {
        status: JobPostingStatus.PUBLISHED,
        applicationDeadline: { gte: new Date() },
      },
    });

    // Filter by visibility and eligibility
    return postings.filter((posting) => {
      // Check visibility
      if (
        posting.visibility === "DEPARTMENT" &&
        posting.departmentId !== employee.departmentId
      ) {
        return false;
      }
      if (
        posting.visibility === "CUSTOM" &&
        !posting.visibleToDepartmentIds.includes(employee.departmentId)
      ) {
        return false;
      }

      // Check eligibility criteria
      const criteria = posting.eligibilityCriteria as any;
      if (criteria) {
        // Check tenure
        if (criteria.minTenureMonths) {
          const tenureMonths = Math.floor(
            (Date.now() - new Date(employee.hireDate).getTime()) /
              (1000 * 60 * 60 * 24 * 30),
          );
          if (tenureMonths < criteria.minTenureMonths) return false;
        }

        // Check excluded employees
        if (criteria.excludedEmployeeIds?.includes(employeeId)) return false;

        // Check allowed departments
        if (
          criteria.allowedDepartmentIds?.length &&
          !criteria.allowedDepartmentIds.includes(employee.departmentId)
        ) {
          return false;
        }
      }

      return true;
    }) as unknown as InternalJobPosting[];
  }

  private async generatePostingCode(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.internalJobPosting.count({
      where: { createdAt: { gte: new Date(year, 0, 1) } },
    });
    return `IJP-${year}-${String(count + 1).padStart(5, "0")}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // APPLICATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  async submitApplication(
    data: SubmitApplicationDto,
    applicantId: string,
  ): Promise<JobApplication> {
    const applicant = await this.prisma.employee.findUnique({
      where: { id: applicantId },
      include: { department: true, position: true },
    });

    if (!applicant) throw new Error("Applicant not found");

    // Check for existing application
    const existing = await this.prisma.jobApplication.findFirst({
      where: {
        jobPostingId: data.jobPostingId,
        applicantId,
        status: { notIn: ["WITHDRAWN", "REJECTED"] },
      },
    });

    if (existing) throw new Error("You have already applied for this position");

    // Calculate skill match
    const posting = await this.prisma.internalJobPosting.findUnique({
      where: { id: data.jobPostingId },
    });
    const skillMatchScore = await this.calculateSkillMatch(
      applicantId,
      data.jobPostingId,
    );

    const applicationCode = await this.generateApplicationCode();

    const application = await this.prisma.jobApplication.create({
      data: {
        applicationCode,
        jobPostingId: data.jobPostingId,
        applicantId,
        applicantName: `${applicant.firstName} ${applicant.lastName}`,
        applicantEmail: applicant.email,
        currentDepartment: applicant.department?.name || "",
        currentPosition: applicant.position?.title || "",
        status: ApplicationStatus.SUBMITTED,
        statusHistory: [
          {
            status: ApplicationStatus.SUBMITTED,
            changedAt: new Date(),
            notes: "Application submitted",
          },
        ] as unknown as Prisma.JsonArray,
        coverLetter: data.coverLetter,
        motivationStatement: data.motivationStatement,
        skillMatchScore: skillMatchScore.overall,
        skillMatches: skillMatchScore.matches as unknown as Prisma.JsonArray,
        currentManagerId: applicant.managerId,
        currentManagerApproval: posting?.eligibilityCriteria
          ? "PENDING"
          : undefined,
        appliedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });

    // Update posting stats
    await this.prisma.internalJobPosting.update({
      where: { id: data.jobPostingId },
      data: { applicationCount: { increment: 1 } },
    });

    return application as unknown as JobApplication;
  }

  async updateApplicationStatus(
    applicationId: string,
    status: ApplicationStatus,
    updatedBy: string,
    notes?: string,
  ): Promise<JobApplication> {
    const application = await this.prisma.jobApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application) throw new Error("Application not found");

    const statusHistory = (application.statusHistory as any[]) || [];
    statusHistory.push({
      status,
      changedAt: new Date(),
      changedBy: updatedBy,
      notes,
    });

    return this.prisma.jobApplication.update({
      where: { id: applicationId },
      data: {
        status,
        statusHistory: statusHistory as unknown as Prisma.JsonArray,
        lastActivityAt: new Date(),
      },
    }) as unknown as JobApplication;
  }

  async withdrawApplication(
    applicationId: string,
    reason: string,
  ): Promise<JobApplication> {
    const application = await this.prisma.jobApplication.update({
      where: { id: applicationId },
      data: {
        status: ApplicationStatus.WITHDRAWN,
        withdrawnAt: new Date(),
        withdrawalReason: reason,
        finalDecision: "WITHDRAWN",
        decisionDate: new Date(),
      },
    });

    return application as unknown as JobApplication;
  }

  async approveByManager(
    applicationId: string,
    managerId: string,
    approved: boolean,
    comments?: string,
  ): Promise<JobApplication> {
    return this.prisma.jobApplication.update({
      where: { id: applicationId },
      data: {
        currentManagerApproval: approved ? "APPROVED" : "DECLINED",
        currentManagerComments: comments,
        currentManagerApprovedAt: new Date(),
        status: approved
          ? ApplicationStatus.UNDER_REVIEW
          : ApplicationStatus.REJECTED,
        decisionReason: !approved ? comments : undefined,
      },
    }) as unknown as JobApplication;
  }

  async listApplications(
    filters: ApplicationFilters,
    page: number = 1,
    limit: number = 50,
  ) {
    const where: Prisma.JobApplicationWhereInput = {};

    if (filters.jobPostingId) where.jobPostingId = filters.jobPostingId;
    if (filters.applicantId) where.applicantId = filters.applicantId;
    if (filters.status) where.status = filters.status;
    if (filters.hiringManagerId) {
      where.jobPosting = { hiringManagerId: filters.hiringManagerId };
    }

    const [applications, total] = await Promise.all([
      this.prisma.jobApplication.findMany({
        where,
        include: { jobPosting: true },
        orderBy: { appliedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.jobApplication.count({ where }),
    ]);

    return {
      data: applications,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getApplicationsForPosting(
    postingId: string,
  ): Promise<JobApplication[]> {
    return this.prisma.jobApplication.findMany({
      where: { jobPostingId: postingId },
      orderBy: [{ skillMatchScore: "desc" }, { appliedAt: "asc" }],
    }) as unknown as JobApplication[];
  }

  private async generateApplicationCode(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.jobApplication.count({
      where: { appliedAt: { gte: new Date(year, 0, 1) } },
    });
    return `APP-${year}-${String(count + 1).padStart(6, "0")}`;
  }

  private async calculateSkillMatch(
    employeeId: string,
    postingId: string,
  ): Promise<{ overall: number; matches: any[] }> {
    const posting = await this.prisma.internalJobPosting.findUnique({
      where: { id: postingId },
    });
    if (!posting) return { overall: 0, matches: [] };

    const profile = await this.prisma.careerProfile.findFirst({
      where: { employeeId },
    });
    const profileSkills = (profile?.skills as any[]) || [];
    const requirements = (posting.requirements as any[]) || [];

    const matches: any[] = [];
    let totalWeight = 0;
    let weightedScore = 0;

    for (const req of requirements) {
      const profileSkill = profileSkills.find(
        (s) => s.skillName?.toLowerCase() === req.name?.toLowerCase(),
      );
      const weight = req.weight || 1;
      totalWeight += weight;

      let matchLevel: SkillMatchLevel;
      let score: number;

      if (!profileSkill) {
        matchLevel = SkillMatchLevel.GAP;
        score = 0;
      } else if (profileSkill.proficiencyLevel >= (req.level || 3) + 1) {
        matchLevel = SkillMatchLevel.EXCEEDS;
        score = 100;
      } else if (profileSkill.proficiencyLevel >= (req.level || 3)) {
        matchLevel = SkillMatchLevel.MEETS;
        score = 80;
      } else if (profileSkill.proficiencyLevel >= (req.level || 3) - 1) {
        matchLevel = SkillMatchLevel.PARTIAL;
        score = 50;
      } else {
        matchLevel = SkillMatchLevel.DEVELOPING;
        score = 25;
      }

      weightedScore += score * weight;

      matches.push({
        requirementId: req.id,
        requirementName: req.name,
        requirementType: req.type,
        requiredLevel: req.level,
        applicantLevel: profileSkill?.proficiencyLevel,
        matchLevel,
        score,
      });
    }

    return {
      overall: totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0,
      matches,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // INTERVIEWS
  // ═══════════════════════════════════════════════════════════════════════════════

  async scheduleInterview(data: ScheduleInterviewDto): Promise<Interview> {
    const interviewers = await this.prisma.employee.findMany({
      where: { id: { in: data.interviewerIds } },
      select: { id: true, firstName: true, lastName: true },
    });

    const interview = await this.prisma.interview.create({
      data: {
        applicationId: data.applicationId,
        type: data.type,
        round: data.round,
        scheduledAt: data.scheduledAt,
        duration: data.duration,
        location: data.location,
        meetingLink: data.meetingLink,
        interviewerIds: data.interviewerIds,
        interviewerNames: interviewers.map(
          (i) => `${i.firstName} ${i.lastName}`,
        ),
        status: "SCHEDULED",
      },
    });

    // Update application status
    await this.updateApplicationStatus(
      data.applicationId,
      ApplicationStatus.INTERVIEW_SCHEDULED,
      "system",
    );

    return interview as unknown as Interview;
  }

  async submitInterviewFeedback(
    data: SubmitInterviewFeedbackDto,
    interviewerId: string,
  ): Promise<Interview> {
    const interviewer = await this.prisma.employee.findUnique({
      where: { id: interviewerId },
    });
    const interview = await this.prisma.interview.findUnique({
      where: { id: data.interviewId },
    });

    if (!interview) throw new Error("Interview not found");

    const existingFeedback = (interview.feedback as any[]) || [];

    const newFeedback = {
      interviewerId,
      interviewerName: `${interviewer?.firstName} ${interviewer?.lastName}`,
      ratings: data.ratings,
      overallRating: data.overallRating,
      recommendation: data.recommendation,
      strengths: data.strengths,
      concerns: data.concerns,
      additionalComments: data.additionalComments,
      submittedAt: new Date(),
    };

    existingFeedback.push(newFeedback);

    // Calculate overall rating
    const avgRating =
      existingFeedback.reduce((sum, f) => sum + f.overallRating, 0) /
      existingFeedback.length;

    const updated = await this.prisma.interview.update({
      where: { id: data.interviewId },
      data: {
        feedback: existingFeedback as unknown as Prisma.JsonArray,
        overallRating: avgRating,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    // Update application status if all feedback received
    if (existingFeedback.length >= interview.interviewerIds.length) {
      await this.updateApplicationStatus(
        interview.applicationId,
        ApplicationStatus.INTERVIEW_COMPLETED,
        "system",
      );
    }

    return updated as unknown as Interview;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // OFFERS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createOffer(
    data: CreateOfferDto,
    createdBy: string,
  ): Promise<OfferDetails> {
    const department = await this.prisma.department.findUnique({
      where: { id: data.newDepartmentId },
    });

    const offer = await this.prisma.offerDetails.create({
      data: {
        applicationId: data.applicationId,
        newPositionTitle: data.newPositionTitle,
        newDepartmentId: data.newDepartmentId,
        newDepartmentName: department?.name || "",
        newGradeId: data.newGradeId,
        newBaseSalary: data.newBaseSalary,
        proposedStartDate: data.proposedStartDate,
        transitionPeriodDays: data.transitionPeriodDays,
        assignmentEndDate: data.assignmentEndDate,
        status: "DRAFT",
        createdBy,
      },
    });

    return offer as unknown as OfferDetails;
  }

  async sendOffer(offerId: string): Promise<OfferDetails> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days to respond

    const offer = await this.prisma.offerDetails.update({
      where: { id: offerId },
      data: {
        status: "SENT",
        sentAt: new Date(),
        expiresAt,
      },
    });

    // Update application status
    await this.updateApplicationStatus(
      offer.applicationId,
      ApplicationStatus.OFFER_PENDING,
      "system",
    );

    return offer as unknown as OfferDetails;
  }

  async respondToOffer(
    offerId: string,
    accepted: boolean,
    declineReason?: string,
  ): Promise<OfferDetails> {
    const offer = await this.prisma.offerDetails.update({
      where: { id: offerId },
      data: {
        status: accepted ? "ACCEPTED" : "DECLINED",
        respondedAt: new Date(),
        declineReason,
      },
    });

    // Update application status
    await this.updateApplicationStatus(
      offer.applicationId,
      accepted
        ? ApplicationStatus.OFFER_ACCEPTED
        : ApplicationStatus.OFFER_DECLINED,
      "system",
    );

    // If accepted, close the posting
    if (accepted) {
      const application = await this.prisma.jobApplication.findUnique({
        where: { id: offer.applicationId },
      });
      if (application) {
        await this.closePosting(application.jobPostingId, "FILLED");
      }
    }

    return offer as unknown as OfferDetails;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CAREER PROFILE
  // ═══════════════════════════════════════════════════════════════════════════════

  async getOrCreateCareerProfile(employeeId: string): Promise<CareerProfile> {
    let profile = await this.prisma.careerProfile.findFirst({
      where: { employeeId },
    });

    if (!profile) {
      profile = await this.prisma.careerProfile.create({
        data: {
          employeeId,
          careerGoals: [],
          targetRoles: [],
          mobilityPreference: "BOTH",
          relocationWillingness: "SAME_CITY",
          openToOpportunities: true,
          interestedJobTypes: [],
          skills: [],
          keyExperiences: [],
          projectHighlights: [],
          learningInterests: [],
          certificationGoals: [],
          bookmarkedJobIds: [],
          lastActiveAt: new Date(),
          profileCompleteness: 10,
        },
      });
    }

    return profile as unknown as CareerProfile;
  }

  async updateCareerProfile(
    employeeId: string,
    data: UpdateCareerProfileDto,
  ): Promise<CareerProfile> {
    const profile = await this.getOrCreateCareerProfile(employeeId);

    // Add IDs to target roles and skills if not present
    const targetRoles = data.targetRoles?.map((r) => ({ ...r, id: uuidv4() }));
    const skills = data.skills?.map((s) => ({
      ...s,
      id: uuidv4(),
      isVerified: false,
      endorsements: 0,
    }));

    const updated = await this.prisma.careerProfile.update({
      where: { id: profile.id },
      data: {
        ...data,
        targetRoles: targetRoles as unknown as Prisma.JsonArray,
        skills: skills as unknown as Prisma.JsonArray,
        lastActiveAt: new Date(),
        profileCompleteness: this.calculateProfileCompleteness({
          ...profile,
          ...data,
        } as any),
      },
    });

    return updated as unknown as CareerProfile;
  }

  async bookmarkJob(employeeId: string, jobPostingId: string): Promise<void> {
    const profile = await this.getOrCreateCareerProfile(employeeId);
    const bookmarks = profile.bookmarkedJobIds || [];

    if (!bookmarks.includes(jobPostingId)) {
      bookmarks.push(jobPostingId);
      await this.prisma.careerProfile.update({
        where: { id: profile.id },
        data: { bookmarkedJobIds: bookmarks },
      });

      await this.prisma.internalJobPosting.update({
        where: { id: jobPostingId },
        data: { bookmarkCount: { increment: 1 } },
      });
    }
  }

  async removeBookmark(
    employeeId: string,
    jobPostingId: string,
  ): Promise<void> {
    const profile = await this.getOrCreateCareerProfile(employeeId);
    const bookmarks = (profile.bookmarkedJobIds || []).filter(
      (id) => id !== jobPostingId,
    );

    await this.prisma.careerProfile.update({
      where: { id: profile.id },
      data: { bookmarkedJobIds: bookmarks },
    });

    await this.prisma.internalJobPosting.update({
      where: { id: jobPostingId },
      data: { bookmarkCount: { decrement: 1 } },
    });
  }

  private calculateProfileCompleteness(profile: any): number {
    let score = 0;
    if (profile.careerGoals?.length) score += 15;
    if (profile.targetRoles?.length) score += 15;
    if (profile.skills?.length >= 5) score += 20;
    else if (profile.skills?.length) score += 10;
    if (profile.keyExperiences?.length) score += 15;
    if (profile.projectHighlights?.length) score += 15;
    if (profile.mobilityPreference) score += 5;
    if (profile.relocationWillingness) score += 5;
    if (profile.interestedJobTypes?.length) score += 10;
    return Math.min(score, 100);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MATCHING & RECOMMENDATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  async getRecommendedJobsForEmployee(
    employeeId: string,
    limit: number = 10,
  ): Promise<JobMatch[]> {
    const profile = await this.getOrCreateCareerProfile(employeeId);
    const postings = await this.getActivePostingsForEmployee(employeeId);

    const matches: JobMatch[] = [];

    for (const posting of postings) {
      const skillMatch = await this.calculateSkillMatch(employeeId, posting.id);

      // Calculate preference match
      let preferenceScore = 50;
      if (profile.interestedJobTypes?.includes(posting.jobType as JobType)) {
        preferenceScore += 30;
      }

      // Calculate overall score
      const overallScore = Math.round(
        skillMatch.overall * 0.6 + preferenceScore * 0.4,
      );

      matches.push({
        jobPostingId: posting.id,
        jobPosting: posting as unknown as InternalJobPosting,
        employeeId,
        matchScore: overallScore,
        skillMatchScore: skillMatch.overall,
        experienceMatchScore: 70, // Simplified
        preferenceMatchScore: preferenceScore,
        skillMatches: skillMatch.matches,
        matchReasons: this.generateMatchReasons(
          skillMatch.matches,
          overallScore,
        ),
        gapAreas: skillMatch.matches
          .filter(
            (m) => m.matchLevel === "GAP" || m.matchLevel === "DEVELOPING",
          )
          .map((m) => m.requirementName),
        rank: 0,
        calculatedAt: new Date(),
      });
    }

    // Sort by match score and assign ranks
    matches.sort((a, b) => b.matchScore - a.matchScore);
    matches.forEach((m, i) => (m.rank = i + 1));

    return matches.slice(0, limit);
  }

  async getTalentMatchesForPosting(
    postingId: string,
    limit: number = 20,
  ): Promise<TalentMatch[]> {
    const posting = await this.prisma.internalJobPosting.findUnique({
      where: { id: postingId },
    });
    if (!posting) return [];

    // Get all career profiles of employees open to opportunities
    const profiles = await this.prisma.careerProfile.findMany({
      where: { openToOpportunities: true },
      take: 100,
    });

    const matches: TalentMatch[] = [];

    for (const profile of profiles) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: profile.employeeId },
        include: { department: true, position: true },
      });

      if (!employee) continue;

      const skillMatch = await this.calculateSkillMatch(
        profile.employeeId,
        postingId,
      );
      const tenure = Math.floor(
        (Date.now() - new Date(employee.hireDate).getTime()) /
          (1000 * 60 * 60 * 24 * 365),
      );

      matches.push({
        employeeId: profile.employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        currentPosition: employee.position?.title || "",
        currentDepartment: employee.department?.name || "",
        matchScore: skillMatch.overall,
        skillMatchScore: skillMatch.overall,
        profileSummary: {
          yearsInCompany: tenure,
          skillHighlights:
            (profile.skills as any[])?.slice(0, 5).map((s) => s.skillName) ||
            [],
          openToOpportunities: profile.openToOpportunities,
        },
        matchReasons: this.generateMatchReasons(
          skillMatch.matches,
          skillMatch.overall,
        ),
        potentialConcerns: [],
        rank: 0,
      });
    }

    // Sort and rank
    matches.sort((a, b) => b.matchScore - a.matchScore);
    matches.forEach((m, i) => (m.rank = i + 1));

    return matches.slice(0, limit);
  }

  private generateMatchReasons(
    skillMatches: any[],
    overallScore: number,
  ): string[] {
    const reasons: string[] = [];
    const exceeds = skillMatches
      .filter((m) => m.matchLevel === "EXCEEDS")
      .map((m) => m.requirementName);
    const meets = skillMatches
      .filter((m) => m.matchLevel === "MEETS")
      .map((m) => m.requirementName);

    if (exceeds.length > 0) {
      reasons.push(
        `Exceeds requirements in: ${exceeds.slice(0, 3).join(", ")}`,
      );
    }
    if (meets.length > 0) {
      reasons.push(`Meets requirements in: ${meets.slice(0, 3).join(", ")}`);
    }
    if (overallScore >= 80) {
      reasons.push("Strong overall match for this role");
    }

    return reasons;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ANALYTICS & DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════════

  async getMarketplaceAnalytics(): Promise<MarketplaceAnalytics> {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisYear = new Date(now.getFullYear(), 0, 1);

    // Posting stats
    const [totalActive, totalThisMonth, postingsByType, postingsByDept] =
      await Promise.all([
        this.prisma.internalJobPosting.count({
          where: { status: JobPostingStatus.PUBLISHED },
        }),
        this.prisma.internalJobPosting.count({
          where: { createdAt: { gte: thisMonth } },
        }),
        this.prisma.internalJobPosting.groupBy({
          by: ["jobType"],
          where: { status: JobPostingStatus.PUBLISHED },
          _count: true,
        }),
        this.prisma.internalJobPosting.groupBy({
          by: ["departmentId", "departmentName"],
          where: { status: JobPostingStatus.PUBLISHED },
          _count: true,
        }),
      ]);

    // Application stats
    const [totalApplications, applicationsThisMonth, applicationsByStatus] =
      await Promise.all([
        this.prisma.jobApplication.count(),
        this.prisma.jobApplication.count({
          where: { appliedAt: { gte: thisMonth } },
        }),
        this.prisma.jobApplication.groupBy({
          by: ["status"],
          _count: true,
        }),
      ]);

    // Mobility stats
    const totalMoves = await this.prisma.jobApplication.count({
      where: { status: ApplicationStatus.OFFER_ACCEPTED },
    });

    // Engagement
    const [activeProfiles, openToOpportunities] = await Promise.all([
      this.prisma.careerProfile.count({
        where: { lastActiveAt: { gte: thisMonth } },
      }),
      this.prisma.careerProfile.count({ where: { openToOpportunities: true } }),
    ]);

    return {
      asOfDate: now,
      postingStats: {
        totalActive,
        totalThisMonth,
        byJobType: postingsByType.map((p) => ({
          type: p.jobType as JobType,
          count: p._count,
        })),
        byDepartment: postingsByDept.map((p) => ({
          departmentId: p.departmentId,
          departmentName: p.departmentName,
          count: p._count,
        })),
        avgTimeToFill: 30,
        fillRate:
          totalActive > 0 ? Math.round((totalMoves / totalActive) * 100) : 0,
      },
      applicationStats: {
        totalApplications,
        applicationsThisMonth,
        avgApplicationsPerPosting:
          totalActive > 0 ? Math.round(totalApplications / totalActive) : 0,
        byStatus: applicationsByStatus.map((a) => ({
          status: a.status as ApplicationStatus,
          count: a._count,
        })),
        conversionRate:
          totalApplications > 0
            ? Math.round((totalMoves / totalApplications) * 100)
            : 0,
      },
      mobilityStats: {
        totalMoves,
        movesThisYear: totalMoves,
        internalHireRate: 25,
        byMoveType: [],
        avgTenureBeforeMove: 24,
        retentionAfterMove: 85,
      },
      engagementStats: {
        activeProfiles,
        profileCompletionRate: 60,
        avgBookmarksPerEmployee: 3,
        employeesOpenToOpportunities: openToOpportunities,
      },
      trends: {
        postingsTrend: [],
        applicationsTrend: [],
        movesTrend: [],
      },
    };
  }

  async getEmployeeDashboard(
    employeeId: string,
  ): Promise<MarketplaceDashboard["employeeView"]> {
    const profile = await this.getOrCreateCareerProfile(employeeId);
    const recommendedJobs = await this.getRecommendedJobsForEmployee(
      employeeId,
      5,
    );

    const recentApplications = await this.prisma.jobApplication.findMany({
      where: { applicantId: employeeId },
      include: { jobPosting: true },
      orderBy: { appliedAt: "desc" },
      take: 5,
    });

    const bookmarkedJobs = profile.bookmarkedJobIds?.length
      ? await this.prisma.internalJobPosting.findMany({
          where: { id: { in: profile.bookmarkedJobIds } },
        })
      : [];

    return {
      recommendedJobs,
      recentApplications: recentApplications as unknown as JobApplication[],
      bookmarkedJobs: bookmarkedJobs as unknown as InternalJobPosting[],
      profileCompleteness: profile.profileCompleteness,
      suggestedSkills: ["Project Management", "Data Analysis", "Leadership"],
    };
  }

  async getManagerDashboard(
    managerId: string,
  ): Promise<MarketplaceDashboard["managerView"]> {
    const myPostings = await this.prisma.internalJobPosting.findMany({
      where: {
        hiringManagerId: managerId,
        status: {
          in: [JobPostingStatus.PUBLISHED, JobPostingStatus.PENDING_APPROVAL],
        },
      },
    });

    const pendingApplications = await this.prisma.jobApplication.findMany({
      where: {
        jobPosting: { hiringManagerId: managerId },
        status: {
          in: [
            ApplicationStatus.SUBMITTED,
            ApplicationStatus.UNDER_REVIEW,
            ApplicationStatus.SHORTLISTED,
          ],
        },
      },
      include: { jobPosting: true },
    });

    const scheduledInterviews = await this.prisma.interview.findMany({
      where: {
        interviewerIds: { has: managerId },
        status: "SCHEDULED",
        scheduledAt: { gte: new Date() },
      },
    });

    const teamMembersOpen = await this.prisma.careerProfile.count({
      where: {
        openToOpportunities: true,
        employee: { managerId },
      },
    });

    return {
      myPostings: myPostings as unknown as InternalJobPosting[],
      pendingApplications: pendingApplications as unknown as JobApplication[],
      scheduledInterviews: scheduledInterviews as unknown as Interview[],
      teamMembersOpenToMove: teamMembersOpen,
    };
  }
}

export default MarketplaceService;
