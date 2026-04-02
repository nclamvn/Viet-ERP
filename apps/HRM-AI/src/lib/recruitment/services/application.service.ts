// src/lib/recruitment/services/application.service.ts
// Application Service - Manage job applications through the hiring pipeline

import { db } from "@/lib/db";
import {
  ApplicationStatus,
  ApplicationSource,
  RequisitionStatus,
  Prisma,
} from ".prisma/hrm-ai-client";
import {
  createCandidateService,
  CreateCandidateInput,
} from "./candidate.service";
import { createJobPostingService } from "./posting.service";

// Types
export interface CreateApplicationInput {
  requisitionId: string;
  jobPostingId?: string;
  candidate: CreateCandidateInput;
  coverLetter?: string;
  answers?: Record<string, string>;
  source?: ApplicationSource;
}

export interface UpdateApplicationInput {
  status?: ApplicationStatus;
  screeningScore?: number;
  screeningNotes?: string;
  assignedToId?: string;
}

export interface ApplicationFilters {
  status?: ApplicationStatus[];
  requisitionId?: string;
  jobPostingId?: string;
  candidateId?: string;
  assignedToId?: string;
  source?: ApplicationSource[];
  search?: string;
  fromDate?: Date;
  toDate?: Date;
}

export interface MoveToStageInput {
  applicationId: string;
  newStatus: ApplicationStatus;
  notes?: string;
  performedById: string;
}

// Helper to generate application code
async function generateApplicationCode(tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `APP-${year}-`;

  const lastApplication = await db.application.findFirst({
    where: { applicationCode: { startsWith: prefix } },
    orderBy: { applicationCode: "desc" },
  });

  let nextNumber = 1;
  if (lastApplication) {
    const lastNumber = parseInt(
      lastApplication.applicationCode.replace(prefix, ""),
      10,
    );
    nextNumber = lastNumber + 1;
  }

  return `${prefix}${nextNumber.toString().padStart(5, "0")}`;
}

// Status to stage mapping
const STATUS_STAGE_MAP: Record<ApplicationStatus, number> = {
  [ApplicationStatus.NEW]: 1,
  [ApplicationStatus.SCREENING]: 2,
  [ApplicationStatus.PHONE_SCREEN]: 3,
  [ApplicationStatus.INTERVIEW]: 4,
  [ApplicationStatus.ASSESSMENT]: 5,
  [ApplicationStatus.OFFER]: 6,
  [ApplicationStatus.HIRED]: 7,
  [ApplicationStatus.REJECTED]: -1,
  [ApplicationStatus.WITHDRAWN]: -1,
};

export class ApplicationService {
  constructor(private tenantId: string) {}

  /**
   * Create a new application
   */
  async create(input: CreateApplicationInput) {
    // Verify requisition is accepting applications
    const requisition = await db.jobRequisition.findFirst({
      where: {
        id: input.requisitionId,
        tenantId: this.tenantId,
        status: { in: [RequisitionStatus.OPEN, RequisitionStatus.APPROVED] },
      },
    });

    if (!requisition) {
      throw new Error(
        "Job requisition not found or not accepting applications",
      );
    }

    // Create or update candidate
    const candidateService = createCandidateService(this.tenantId);
    const candidate = await candidateService.upsert({
      ...input.candidate,
      source: input.source || input.candidate.source,
    });

    // Check for existing application
    const existingApplication = await db.application.findFirst({
      where: {
        candidateId: candidate.id,
        requisitionId: input.requisitionId,
        status: {
          notIn: [ApplicationStatus.REJECTED, ApplicationStatus.WITHDRAWN],
        },
      },
    });

    if (existingApplication) {
      throw new Error(
        "Candidate already has an active application for this position",
      );
    }

    // Generate application code
    const applicationCode = await generateApplicationCode(this.tenantId);

    // Create application
    const application = await db.application.create({
      data: {
        tenantId: this.tenantId,
        candidateId: candidate.id,
        requisitionId: input.requisitionId,
        jobPostingId: input.jobPostingId,
        applicationCode,
        status: ApplicationStatus.NEW,
        stage: STATUS_STAGE_MAP[ApplicationStatus.NEW],
        coverLetter: input.coverLetter,
        answers: input.answers,
        source: input.source || ApplicationSource.CAREERS_PAGE,
      },
      include: {
        candidate: true,
        requisition: {
          select: {
            id: true,
            title: true,
            requisitionCode: true,
            department: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Create activity log
    await this.createActivity(
      application.id,
      "APPLICATION_CREATED",
      "Application submitted",
    );

    // Update job posting application count
    if (input.jobPostingId) {
      const postingService = createJobPostingService(this.tenantId);
      await postingService.incrementApplicationCount(input.jobPostingId);
    }

    return application;
  }

  /**
   * Get application by ID
   */
  async getById(id: string) {
    const application = await db.application.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        candidate: true,
        requisition: {
          select: {
            id: true,
            title: true,
            requisitionCode: true,
            headcount: true,
            filledCount: true,
            department: { select: { id: true, name: true } },
            reportingTo: { select: { id: true, fullName: true } },
          },
        },
        jobPosting: {
          select: {
            id: true,
            title: true,
            slug: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        interviews: {
          orderBy: { scheduledAt: "asc" },
          include: {
            evaluations: {
              include: {
                evaluator: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        evaluations: {
          orderBy: { createdAt: "desc" },
          include: {
            evaluator: {
              select: { id: true, name: true },
            },
          },
        },
        offers: {
          orderBy: { createdAt: "desc" },
        },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            performedBy: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    return application;
  }

  /**
   * List applications with filters
   */
  async list(
    filters: ApplicationFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.ApplicationWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    if (filters.requisitionId) {
      where.requisitionId = filters.requisitionId;
    }

    if (filters.jobPostingId) {
      where.jobPostingId = filters.jobPostingId;
    }

    if (filters.candidateId) {
      where.candidateId = filters.candidateId;
    }

    if (filters.assignedToId) {
      where.assignedToId = filters.assignedToId;
    }

    if (filters.source?.length) {
      where.source = { in: filters.source };
    }

    if (filters.search) {
      where.OR = [
        { applicationCode: { contains: filters.search, mode: "insensitive" } },
        {
          candidate: {
            fullName: { contains: filters.search, mode: "insensitive" },
          },
        },
        {
          candidate: {
            email: { contains: filters.search, mode: "insensitive" },
          },
        },
      ];
    }

    if (filters.fromDate) {
      where.createdAt = { gte: filters.fromDate };
    }

    if (filters.toDate) {
      where.createdAt = {
        ...((where.createdAt as object) || {}),
        lte: filters.toDate,
      };
    }

    const [applications, total] = await Promise.all([
      db.application.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          candidate: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
              currentPosition: true,
              currentCompany: true,
              cvUrl: true,
            },
          },
          requisition: {
            select: {
              id: true,
              title: true,
              requisitionCode: true,
              department: { select: { id: true, name: true } },
            },
          },
          assignedTo: {
            select: { id: true, name: true },
          },
          _count: {
            select: {
              interviews: true,
              evaluations: true,
            },
          },
        },
      }),
      db.application.count({ where }),
    ]);

    return {
      data: applications,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get applications by requisition (pipeline view)
   */
  async getByRequisition(requisitionId: string) {
    const applications = await db.application.findMany({
      where: {
        tenantId: this.tenantId,
        requisitionId,
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        candidate: {
          select: {
            id: true,
            fullName: true,
            email: true,
            currentPosition: true,
            currentCompany: true,
            yearsOfExperience: true,
            cvUrl: true,
          },
        },
        _count: {
          select: { interviews: true, evaluations: true },
        },
      },
    });

    // Group by status
    const pipeline: Record<string, typeof applications> = {};
    for (const status of Object.values(ApplicationStatus)) {
      pipeline[status] = applications.filter((a) => a.status === status);
    }

    return {
      applications,
      pipeline,
      total: applications.length,
    };
  }

  /**
   * Move application to new stage
   */
  async moveToStage(input: MoveToStageInput) {
    const application = await db.application.findFirst({
      where: {
        id: input.applicationId,
        tenantId: this.tenantId,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    const oldStatus = application.status;
    const newStage = STATUS_STAGE_MAP[input.newStatus];

    // Update application
    const updated = await db.application.update({
      where: { id: input.applicationId },
      data: {
        status: input.newStatus,
        stage: newStage,
      },
    });

    // Create activity log
    await this.createActivity(
      input.applicationId,
      "STATUS_CHANGED",
      `Status changed from ${oldStatus} to ${input.newStatus}`,
      input.performedById,
      oldStatus,
      input.newStatus,
    );

    return updated;
  }

  /**
   * Reject application
   */
  async reject(applicationId: string, rejectedById: string, reason: string) {
    const application = await db.application.findFirst({
      where: {
        id: applicationId,
        tenantId: this.tenantId,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    const terminalStatuses = [
      ApplicationStatus.HIRED,
      ApplicationStatus.REJECTED,
      ApplicationStatus.WITHDRAWN,
    ];
    if (terminalStatuses.some((s) => s === application.status)) {
      throw new Error("Cannot reject application in current status");
    }

    const oldStatus = application.status;

    const updated = await db.application.update({
      where: { id: applicationId },
      data: {
        status: ApplicationStatus.REJECTED,
        stage: STATUS_STAGE_MAP[ApplicationStatus.REJECTED],
        rejectionReason: reason,
        rejectedAt: new Date(),
        rejectedById,
      },
    });

    await this.createActivity(
      applicationId,
      "REJECTED",
      `Application rejected: ${reason}`,
      rejectedById,
      oldStatus,
      ApplicationStatus.REJECTED,
    );

    return updated;
  }

  /**
   * Hire candidate
   */
  async hire(applicationId: string, hiredById: string) {
    const application = await db.application.findFirst({
      where: {
        id: applicationId,
        tenantId: this.tenantId,
      },
      include: {
        requisition: true,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    if (application.status !== ApplicationStatus.OFFER) {
      throw new Error("Application must be in OFFER status to hire");
    }

    const oldStatus = application.status;

    // Update application
    const updated = await db.application.update({
      where: { id: applicationId },
      data: {
        status: ApplicationStatus.HIRED,
        stage: STATUS_STAGE_MAP[ApplicationStatus.HIRED],
        hiredAt: new Date(),
        hiredById,
      },
    });

    // Update requisition filled count
    await db.jobRequisition.update({
      where: { id: application.requisitionId },
      data: {
        filledCount: { increment: 1 },
      },
    });

    // Check if requisition is fully filled
    const requisition = await db.jobRequisition.findUnique({
      where: { id: application.requisitionId },
    });

    if (requisition && requisition.filledCount >= requisition.headcount) {
      await db.jobRequisition.update({
        where: { id: application.requisitionId },
        data: { status: RequisitionStatus.FILLED },
      });
    }

    await this.createActivity(
      applicationId,
      "HIRED",
      "Candidate hired",
      hiredById,
      oldStatus,
      ApplicationStatus.HIRED,
    );

    return updated;
  }

  /**
   * Withdraw application (by candidate)
   */
  async withdraw(applicationId: string, reason?: string) {
    const application = await db.application.findFirst({
      where: {
        id: applicationId,
        tenantId: this.tenantId,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    const terminalStatusList = [
      ApplicationStatus.HIRED,
      ApplicationStatus.REJECTED,
      ApplicationStatus.WITHDRAWN,
    ];
    if (terminalStatusList.some((s) => s === application.status)) {
      throw new Error("Cannot withdraw application in current status");
    }

    const oldStatus = application.status;

    const updated = await db.application.update({
      where: { id: applicationId },
      data: {
        status: ApplicationStatus.WITHDRAWN,
        stage: STATUS_STAGE_MAP[ApplicationStatus.WITHDRAWN],
        rejectionReason: reason
          ? `Withdrawn: ${reason}`
          : "Withdrawn by candidate",
      },
    });

    await this.createActivity(
      applicationId,
      "WITHDRAWN",
      reason
        ? `Application withdrawn: ${reason}`
        : "Application withdrawn by candidate",
      undefined,
      oldStatus,
      ApplicationStatus.WITHDRAWN,
    );

    return updated;
  }

  /**
   * Update screening score
   */
  async updateScreening(
    applicationId: string,
    score: number,
    notes: string,
    performedById: string,
  ) {
    const application = await db.application.findFirst({
      where: {
        id: applicationId,
        tenantId: this.tenantId,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    const updated = await db.application.update({
      where: { id: applicationId },
      data: {
        screeningScore: score,
        screeningNotes: notes,
      },
    });

    await this.createActivity(
      applicationId,
      "SCREENING_UPDATED",
      `Screening score: ${score}/100`,
      performedById,
    );

    return updated;
  }

  /**
   * Assign application to recruiter
   */
  async assign(
    applicationId: string,
    assignedToId: string,
    performedById: string,
  ) {
    const application = await db.application.findFirst({
      where: {
        id: applicationId,
        tenantId: this.tenantId,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    const assignee = await db.user.findUnique({
      where: { id: assignedToId },
      select: { name: true },
    });

    const updated = await db.application.update({
      where: { id: applicationId },
      data: { assignedToId },
    });

    await this.createActivity(
      applicationId,
      "ASSIGNED",
      `Assigned to ${assignee?.name || "Unknown"}`,
      performedById,
    );

    return updated;
  }

  /**
   * Get application statistics
   */
  async getStats(requisitionId?: string) {
    const where: Prisma.ApplicationWhereInput = {
      tenantId: this.tenantId,
    };

    if (requisitionId) {
      where.requisitionId = requisitionId;
    }

    const [byStatus, bySource, avgTimeInStage] = await Promise.all([
      db.application.groupBy({
        by: ["status"],
        where,
        _count: true,
      }),

      db.application.groupBy({
        by: ["source"],
        where,
        _count: true,
      }),

      // Recent applications with stage times
      db.application.findMany({
        where: {
          ...where,
          status: ApplicationStatus.HIRED,
          createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
        },
        select: {
          createdAt: true,
          hiredAt: true,
        },
      }),
    ]);

    // Calculate average time to hire
    let avgDaysToHire = 0;
    if (avgTimeInStage.length > 0) {
      const totalDays = avgTimeInStage.reduce((sum, app) => {
        if (app.hiredAt) {
          return (
            sum +
            Math.floor(
              (app.hiredAt.getTime() - app.createdAt.getTime()) /
                (1000 * 60 * 60 * 24),
            )
          );
        }
        return sum;
      }, 0);
      avgDaysToHire = Math.round(totalDays / avgTimeInStage.length);
    }

    // Calculate conversion rates
    const total = byStatus.reduce((sum, s) => sum + s._count, 0);
    const hired =
      byStatus.find((s) => s.status === ApplicationStatus.HIRED)?._count || 0;

    return {
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count,
        percentage: total > 0 ? Math.round((s._count / total) * 100) : 0,
      })),
      bySource: bySource.map((s) => ({
        source: s.source,
        count: s._count,
      })),
      total,
      hireRate: total > 0 ? Math.round((hired / total) * 100) : 0,
      avgDaysToHire,
    };
  }

  /**
   * Create activity log
   */
  private async createActivity(
    applicationId: string,
    action: string,
    description: string,
    performedById?: string,
    oldValue?: string,
    newValue?: string,
  ) {
    return db.applicationActivity.create({
      data: {
        applicationId,
        action,
        description,
        performedById,
        oldValue,
        newValue,
      },
    });
  }

  /**
   * Add note to application
   */
  async addNote(applicationId: string, note: string, performedById: string) {
    const application = await db.application.findFirst({
      where: {
        id: applicationId,
        tenantId: this.tenantId,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    return this.createActivity(
      applicationId,
      "NOTE_ADDED",
      note,
      performedById,
    );
  }
}

// Factory function
export function createApplicationService(tenantId: string): ApplicationService {
  return new ApplicationService(tenantId);
}
