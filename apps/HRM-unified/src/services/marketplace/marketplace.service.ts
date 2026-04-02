// src/services/marketplace/marketplace.service.ts
// Internal Job Marketplace Service

import { db } from "@/lib/db";
import type {
  MarketplacePostingStatus,
  InternalJobType,
  InternalApplicationStatus,
  MarketplaceVisibility,
} from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface CreatePostingInput {
  title: string;
  description: string;
  jobType: InternalJobType;
  departmentId: string;
  positionId?: string;
  requirements?: unknown[];
  preferredSkills?: string[];
  minExperienceYears?: number;
  applicationDeadline?: string;
  visibility?: MarketplaceVisibility;
  visibleToDepartmentIds?: string[];
}

export interface CreateApplicationInput {
  coverLetter?: string;
  resumeUrl?: string;
}

export interface UpdateProfileInput {
  headline?: string;
  summary?: string;
  skills?: string[];
  interests?: string[];
  careerGoals?: string;
  openToOpportunities?: boolean;
  preferredJobTypes?: string[];
  preferredDepartments?: string[];
}

// ═══════════════════════════════════════════════════════════════
// JOB POSTINGS
// ═══════════════════════════════════════════════════════════════

export async function createPosting(
  tenantId: string,
  createdById: string,
  input: CreatePostingInput,
) {
  return db.internalJobPosting.create({
    data: {
      tenantId,
      title: input.title,
      description: input.description,
      jobType: input.jobType,
      departmentId: input.departmentId,
      positionId: input.positionId,
      requirements: (input.requirements ?? []) as object,
      preferredSkills: input.preferredSkills ?? [],
      minExperienceYears: input.minExperienceYears,
      applicationDeadline: input.applicationDeadline
        ? new Date(input.applicationDeadline)
        : undefined,
      visibility: input.visibility ?? "ALL",
      visibleToDepartmentIds: input.visibleToDepartmentIds ?? [],
      hiringManagerId: createdById,
      createdById,
      status: "DRAFT",
    },
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
      hiringManager: { select: { id: true, fullName: true } },
    },
  });
}

export async function listPostings(
  tenantId: string,
  filters?: {
    status?: MarketplacePostingStatus;
    departmentId?: string;
    jobType?: InternalJobType;
    page?: number;
    limit?: number;
  },
) {
  const page = filters?.page || 1;
  const limit = filters?.limit || 20;
  const where: Record<string, unknown> = { tenantId };
  if (filters?.status) where.status = filters.status;
  if (filters?.departmentId) where.departmentId = filters.departmentId;
  if (filters?.jobType) where.jobType = filters.jobType;

  const [postings, total] = await Promise.all([
    db.internalJobPosting.findMany({
      where,
      include: {
        department: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
        hiringManager: { select: { id: true, fullName: true } },
        _count: { select: { applications: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.internalJobPosting.count({ where }),
  ]);

  return { postings, total, page, limit };
}

export async function getPosting(tenantId: string, postingId: string) {
  return db.internalJobPosting.findFirst({
    where: { id: postingId, tenantId },
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
      hiringManager: { select: { id: true, fullName: true } },
      applications: {
        include: {
          applicant: {
            select: { id: true, fullName: true, employeeCode: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function updatePosting(
  tenantId: string,
  postingId: string,
  input: Partial<CreatePostingInput>,
) {
  const existing = await db.internalJobPosting.findFirst({
    where: { id: postingId, tenantId },
  });
  if (!existing) throw new Error("Posting not found");

  const data: Record<string, unknown> = {};
  if (input.title) data.title = input.title;
  if (input.description) data.description = input.description;
  if (input.jobType) data.jobType = input.jobType;
  if (input.departmentId)
    data.department = { connect: { id: input.departmentId } };
  if (input.positionId !== undefined)
    data.position = input.positionId
      ? { connect: { id: input.positionId } }
      : { disconnect: true };
  if (input.requirements) data.requirements = input.requirements as object;
  if (input.preferredSkills) data.preferredSkills = input.preferredSkills;
  if (input.minExperienceYears !== undefined)
    data.minExperienceYears = input.minExperienceYears;
  if (input.applicationDeadline)
    data.applicationDeadline = new Date(input.applicationDeadline);
  if (input.visibility) data.visibility = input.visibility;
  if (input.visibleToDepartmentIds)
    data.visibleToDepartmentIds = input.visibleToDepartmentIds;

  return db.internalJobPosting.update({
    where: { id: postingId },
    data,
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
  });
}

export async function updatePostingStatus(
  tenantId: string,
  postingId: string,
  status: MarketplacePostingStatus,
  reason?: string,
) {
  const posting = await db.internalJobPosting.findFirst({
    where: { id: postingId, tenantId },
  });
  if (!posting) throw new Error("Posting not found");

  const validTransitions: Record<string, string[]> = {
    DRAFT: ["PENDING_APPROVAL", "OPEN"],
    PENDING_APPROVAL: ["OPEN", "DRAFT"],
    OPEN: ["CLOSED", "FILLED", "CANCELLED"],
    CLOSED: ["OPEN"],
  };

  if (!validTransitions[posting.status]?.includes(status)) {
    throw new Error(`Cannot transition from ${posting.status} to ${status}`);
  }

  return db.internalJobPosting.update({
    where: { id: postingId },
    data: {
      status,
      ...(["CLOSED", "FILLED", "CANCELLED"].includes(status) && {
        closedAt: new Date(),
        closedReason: reason,
      }),
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// APPLICATIONS
// ═══════════════════════════════════════════════════════════════

export async function submitApplication(
  tenantId: string,
  postingId: string,
  applicantId: string,
  input: CreateApplicationInput,
) {
  const posting = await db.internalJobPosting.findFirst({
    where: { id: postingId, tenantId, status: "OPEN" },
  });
  if (!posting) throw new Error("Posting not found or not open");

  // Check deadline
  if (posting.applicationDeadline && new Date() > posting.applicationDeadline) {
    throw new Error("Application deadline has passed");
  }

  const app = await db.internalApplication.create({
    data: {
      tenantId,
      postingId,
      applicantId,
      coverLetter: input.coverLetter,
      resumeUrl: input.resumeUrl,
      status: "SUBMITTED",
    },
    include: {
      posting: { select: { id: true, title: true } },
      applicant: { select: { id: true, fullName: true } },
    },
  });

  // Increment application count
  await db.internalJobPosting.update({
    where: { id: postingId },
    data: { applicationCount: { increment: 1 } },
  });

  return app;
}

export async function listApplications(
  tenantId: string,
  filters?: {
    applicantId?: string;
    postingId?: string;
    status?: InternalApplicationStatus;
    page?: number;
    limit?: number;
  },
) {
  const page = filters?.page || 1;
  const limit = filters?.limit || 20;
  const where: Record<string, unknown> = { tenantId };
  if (filters?.applicantId) where.applicantId = filters.applicantId;
  if (filters?.postingId) where.postingId = filters.postingId;
  if (filters?.status) where.status = filters.status;

  const [applications, total] = await Promise.all([
    db.internalApplication.findMany({
      where,
      include: {
        posting: {
          select: {
            id: true,
            title: true,
            department: { select: { name: true } },
          },
        },
        applicant: { select: { id: true, fullName: true, employeeCode: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.internalApplication.count({ where }),
  ]);

  return { applications, total, page, limit };
}

export async function getApplication(tenantId: string, applicationId: string) {
  return db.internalApplication.findFirst({
    where: { id: applicationId, tenantId },
    include: {
      posting: {
        include: {
          department: { select: { id: true, name: true } },
          position: { select: { id: true, name: true } },
        },
      },
      applicant: { select: { id: true, fullName: true, employeeCode: true } },
    },
  });
}

export async function updateApplicationStatus(
  tenantId: string,
  applicationId: string,
  status: InternalApplicationStatus,
  notes?: string,
) {
  const app = await db.internalApplication.findFirst({
    where: { id: applicationId, tenantId },
  });
  if (!app) throw new Error("Application not found");

  return db.internalApplication.update({
    where: { id: applicationId },
    data: {
      status,
      ...(status === "REJECTED" && notes && { rejectionReason: notes }),
      ...(status === "INTERVIEW" && notes && { interviewNotes: notes }),
    },
  });
}

export async function withdrawApplication(
  tenantId: string,
  applicationId: string,
  applicantId: string,
  reason: string,
) {
  const app = await db.internalApplication.findFirst({
    where: { id: applicationId, tenantId, applicantId },
  });
  if (!app) throw new Error("Application not found");
  if (["WITHDRAWN", "REJECTED", "ACCEPTED"].includes(app.status)) {
    throw new Error("Cannot withdraw in current status");
  }

  return db.internalApplication.update({
    where: { id: applicationId },
    data: {
      status: "WITHDRAWN",
      withdrawnAt: new Date(),
      withdrawnReason: reason,
    },
  });
}

export async function managerApproval(
  tenantId: string,
  applicationId: string,
  approved: boolean,
  notes?: string,
) {
  const app = await db.internalApplication.findFirst({
    where: { id: applicationId, tenantId },
  });
  if (!app) throw new Error("Application not found");

  return db.internalApplication.update({
    where: { id: applicationId },
    data: {
      status: approved ? "MANAGER_APPROVED" : "MANAGER_REJECTED",
      managerApproval: approved,
      managerApprovalAt: new Date(),
      managerNotes: notes,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// CAREER PROFILE
// ═══════════════════════════════════════════════════════════════

export async function getOrCreateProfile(tenantId: string, employeeId: string) {
  let profile = await db.careerProfile.findUnique({ where: { employeeId } });
  if (!profile) {
    profile = await db.careerProfile.create({
      data: {
        tenantId,
        employeeId,
        skills: [],
        interests: [],
        preferredJobTypes: [],
        preferredDepartments: [],
        bookmarkedPostings: [],
      },
    });
  }
  return profile;
}

export async function updateProfile(
  tenantId: string,
  employeeId: string,
  input: UpdateProfileInput,
) {
  // Ensure profile exists
  await getOrCreateProfile(tenantId, employeeId);

  return db.careerProfile.update({
    where: { employeeId },
    data: {
      ...(input.headline !== undefined && { headline: input.headline }),
      ...(input.summary !== undefined && { summary: input.summary }),
      ...(input.skills && { skills: input.skills }),
      ...(input.interests && { interests: input.interests }),
      ...(input.careerGoals !== undefined && {
        careerGoals: input.careerGoals,
      }),
      ...(input.openToOpportunities !== undefined && {
        openToOpportunities: input.openToOpportunities,
      }),
      ...(input.preferredJobTypes && {
        preferredJobTypes: input.preferredJobTypes,
      }),
      ...(input.preferredDepartments && {
        preferredDepartments: input.preferredDepartments,
      }),
    },
  });
}

export async function toggleBookmark(
  tenantId: string,
  employeeId: string,
  postingId: string,
) {
  const profile = await getOrCreateProfile(tenantId, employeeId);
  const bookmarks = profile.bookmarkedPostings || [];
  const index = bookmarks.indexOf(postingId);

  let updated: string[];
  if (index >= 0) {
    updated = bookmarks.filter((id) => id !== postingId);
  } else {
    updated = [...bookmarks, postingId];
  }

  await db.careerProfile.update({
    where: { employeeId },
    data: { bookmarkedPostings: updated },
  });

  return { bookmarked: index < 0 };
}

// ═══════════════════════════════════════════════════════════════
// RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════

export async function getRecommendations(tenantId: string, employeeId: string) {
  const profile = await db.careerProfile.findUnique({ where: { employeeId } });
  const employee = await db.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { departmentId: true, positionId: true },
  });

  // Get open postings
  const postings = await db.internalJobPosting.findMany({
    where: {
      tenantId,
      status: "OPEN",
      // Exclude postings already applied to
      applications: { none: { applicantId: employeeId } },
    },
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
      hiringManager: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Simple skill-based scoring
  return postings
    .map((p) => {
      let matchScore = 50; // Base score

      if (profile?.preferredDepartments?.includes(p.departmentId)) {
        matchScore += 20;
      }
      if (profile?.preferredJobTypes?.includes(p.jobType)) {
        matchScore += 15;
      }
      if (p.preferredSkills.some((s) => profile?.skills?.includes(s))) {
        matchScore += 15;
      }

      return { ...p, matchScore: Math.min(matchScore, 100) };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

export async function getMarketplaceDashboard(tenantId: string) {
  const [openPostings, totalPostings, totalApplications, recentPostings] =
    await Promise.all([
      db.internalJobPosting.count({ where: { tenantId, status: "OPEN" } }),
      db.internalJobPosting.count({ where: { tenantId } }),
      db.internalApplication.count({ where: { tenantId } }),
      db.internalJobPosting.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          department: { select: { name: true } },
          _count: { select: { applications: true } },
        },
      }),
    ]);

  const filledPostings = await db.internalJobPosting.count({
    where: { tenantId, status: "FILLED" },
  });
  const pendingApplications = await db.internalApplication.count({
    where: { tenantId, status: "SUBMITTED" },
  });

  return {
    overview: {
      openPostings,
      totalPostings,
      filledPostings,
      totalApplications,
      pendingApplications,
    },
    recentPostings: recentPostings.map((p) => ({
      id: p.id,
      title: p.title,
      department: p.department.name,
      status: p.status,
      applicationCount: p._count.applications,
      createdAt: p.createdAt,
    })),
  };
}
