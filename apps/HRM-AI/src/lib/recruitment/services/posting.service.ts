// src/lib/recruitment/services/posting.service.ts
// Job Posting Service - Manage job postings and careers page

import { db } from "@/lib/db";
import {
  JobPostingStatus,
  RequisitionStatus,
  JobType,
  WorkMode,
  Prisma,
} from ".prisma/hrm-ai-client";
import { generateUniqueSlug } from "../utils";

// Types
export interface CreatePostingInput {
  requisitionId: string;
  title: string;
  description: string;
  requirements: string;
  benefits?: string;
  location?: string;
  jobType?: JobType;
  workMode?: WorkMode;
  salaryDisplay?: string;
  isInternal?: boolean;
  isPublic?: boolean;
  expiresAt?: Date;
}

export interface UpdatePostingInput extends Partial<
  Omit<CreatePostingInput, "requisitionId">
> {
  status?: JobPostingStatus;
}

export interface PostingFilters {
  status?: JobPostingStatus[];
  requisitionId?: string;
  isInternal?: boolean;
  isPublic?: boolean;
  jobType?: JobType;
  workMode?: WorkMode;
  search?: string;
}

export interface PublicJobFilters {
  departmentId?: string;
  jobType?: JobType;
  workMode?: WorkMode;
  location?: string;
  search?: string;
}

export class JobPostingService {
  constructor(private tenantId: string) {}

  /**
   * Create a new job posting
   */
  async create(input: CreatePostingInput) {
    // Verify requisition exists and is in valid status
    const requisition = await db.jobRequisition.findFirst({
      where: {
        id: input.requisitionId,
        tenantId: this.tenantId,
        status: { in: [RequisitionStatus.APPROVED, RequisitionStatus.OPEN] },
      },
    });

    if (!requisition) {
      throw new Error(
        "Requisition not found or not in valid status for posting",
      );
    }

    // Generate unique slug
    const slug = await generateUniqueSlug(this.tenantId, input.title);

    const posting = await db.jobPosting.create({
      data: {
        tenantId: this.tenantId,
        requisitionId: input.requisitionId,
        title: input.title,
        slug,
        description: input.description,
        requirements: input.requirements,
        benefits: input.benefits,
        location: input.location || requisition.location,
        jobType: input.jobType || requisition.jobType,
        workMode: input.workMode || requisition.workMode,
        salaryDisplay: input.salaryDisplay || requisition.salaryDisplay,
        isInternal: input.isInternal || false,
        isPublic: input.isPublic !== false,
        expiresAt: input.expiresAt,
        status: JobPostingStatus.DRAFT,
      },
      include: {
        requisition: {
          select: {
            id: true,
            requisitionCode: true,
            title: true,
            department: { select: { id: true, name: true } },
          },
        },
      },
    });

    return posting;
  }

  /**
   * Get posting by ID
   */
  async getById(id: string) {
    const posting = await db.jobPosting.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        requisition: {
          select: {
            id: true,
            requisitionCode: true,
            title: true,
            headcount: true,
            filledCount: true,
            department: { select: { id: true, name: true } },
            reportingTo: { select: { id: true, fullName: true } },
          },
        },
        _count: {
          select: { applications: true },
        },
      },
    });

    if (!posting) {
      throw new Error("Job posting not found");
    }

    return posting;
  }

  /**
   * Get posting by slug (for public careers page)
   */
  async getBySlug(slug: string) {
    const posting = await db.jobPosting.findFirst({
      where: {
        tenantId: this.tenantId,
        slug,
        status: JobPostingStatus.PUBLISHED,
        isPublic: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        requisition: {
          select: {
            id: true,
            department: { select: { id: true, name: true } },
            reportingTo: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    if (!posting) {
      throw new Error("Job posting not found");
    }

    // Increment view count
    await db.jobPosting.update({
      where: { id: posting.id },
      data: { viewCount: { increment: 1 } },
    });

    return posting;
  }

  /**
   * List postings with filters
   */
  async list(
    filters: PostingFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.JobPostingWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    if (filters.requisitionId) {
      where.requisitionId = filters.requisitionId;
    }

    if (filters.isInternal !== undefined) {
      where.isInternal = filters.isInternal;
    }

    if (filters.isPublic !== undefined) {
      where.isPublic = filters.isPublic;
    }

    if (filters.jobType) {
      where.jobType = filters.jobType;
    }

    if (filters.workMode) {
      where.workMode = filters.workMode;
    }

    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
        { location: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const [postings, total] = await Promise.all([
      db.jobPosting.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          requisition: {
            select: {
              id: true,
              requisitionCode: true,
              department: { select: { id: true, name: true } },
            },
          },
          _count: {
            select: { applications: true },
          },
        },
      }),
      db.jobPosting.count({ where }),
    ]);

    return {
      data: postings,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * List public job postings (for careers page)
   */
  async listPublic(
    filters: PublicJobFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.JobPostingWhereInput = {
      tenantId: this.tenantId,
      status: JobPostingStatus.PUBLISHED,
      isPublic: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };

    if (filters.jobType) {
      where.jobType = filters.jobType;
    }

    if (filters.workMode) {
      where.workMode = filters.workMode;
    }

    if (filters.location) {
      where.location = { contains: filters.location, mode: "insensitive" };
    }

    if (filters.departmentId) {
      where.requisition = { departmentId: filters.departmentId };
    }

    if (filters.search) {
      where.AND = [
        {
          OR: [
            { title: { contains: filters.search, mode: "insensitive" } },
            { description: { contains: filters.search, mode: "insensitive" } },
            { requirements: { contains: filters.search, mode: "insensitive" } },
          ],
        },
      ];
    }

    const [postings, total] = await Promise.all([
      db.jobPosting.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          location: true,
          jobType: true,
          workMode: true,
          salaryDisplay: true,
          publishedAt: true,
          requisition: {
            select: {
              department: { select: { id: true, name: true } },
            },
          },
        },
      }),
      db.jobPosting.count({ where }),
    ]);

    return {
      data: postings.map((p) => ({
        ...p,
        departmentName: p.requisition?.department?.name || null,
        requisition: undefined,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Update a posting
   */
  async update(id: string, input: UpdatePostingInput) {
    const posting = await db.jobPosting.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!posting) {
      throw new Error("Job posting not found");
    }

    // Generate new slug if title changed
    let slug = posting.slug;
    if (input.title && input.title !== posting.title) {
      slug = await generateUniqueSlug(this.tenantId, input.title);
    }

    return db.jobPosting.update({
      where: { id },
      data: {
        title: input.title,
        slug,
        description: input.description,
        requirements: input.requirements,
        benefits: input.benefits,
        location: input.location,
        jobType: input.jobType,
        workMode: input.workMode,
        salaryDisplay: input.salaryDisplay,
        isInternal: input.isInternal,
        isPublic: input.isPublic,
        expiresAt: input.expiresAt,
        status: input.status,
      },
      include: {
        requisition: {
          select: {
            id: true,
            requisitionCode: true,
            department: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /**
   * Publish a posting
   */
  async publish(id: string) {
    const posting = await db.jobPosting.findFirst({
      where: { id, tenantId: this.tenantId },
      include: {
        requisition: true,
      },
    });

    if (!posting) {
      throw new Error("Job posting not found");
    }

    if (posting.status !== JobPostingStatus.DRAFT) {
      throw new Error("Only draft postings can be published");
    }

    // Verify requisition is open
    if (posting.requisition.status !== RequisitionStatus.OPEN) {
      // Auto-open if approved
      if (posting.requisition.status === RequisitionStatus.APPROVED) {
        await db.jobRequisition.update({
          where: { id: posting.requisitionId },
          data: { status: RequisitionStatus.OPEN },
        });
      } else {
        throw new Error(
          "Requisition must be approved or open to publish posting",
        );
      }
    }

    return db.jobPosting.update({
      where: { id },
      data: {
        status: JobPostingStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
  }

  /**
   * Close a posting
   */
  async close(id: string) {
    const posting = await db.jobPosting.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!posting) {
      throw new Error("Job posting not found");
    }

    if (posting.status !== JobPostingStatus.PUBLISHED) {
      throw new Error("Only published postings can be closed");
    }

    return db.jobPosting.update({
      where: { id },
      data: { status: JobPostingStatus.CLOSED },
    });
  }

  /**
   * Archive a posting
   */
  async archive(id: string) {
    const posting = await db.jobPosting.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!posting) {
      throw new Error("Job posting not found");
    }

    return db.jobPosting.update({
      where: { id },
      data: { status: JobPostingStatus.ARCHIVED },
    });
  }

  /**
   * Clone a posting
   */
  async clone(id: string) {
    const posting = await db.jobPosting.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!posting) {
      throw new Error("Job posting not found");
    }

    const newSlug = await generateUniqueSlug(
      this.tenantId,
      `${posting.title} (Copy)`,
    );

    return db.jobPosting.create({
      data: {
        tenantId: this.tenantId,
        requisitionId: posting.requisitionId,
        title: `${posting.title} (Copy)`,
        slug: newSlug,
        description: posting.description,
        requirements: posting.requirements,
        benefits: posting.benefits,
        location: posting.location,
        jobType: posting.jobType,
        workMode: posting.workMode,
        salaryDisplay: posting.salaryDisplay,
        isInternal: posting.isInternal,
        isPublic: posting.isPublic,
        status: JobPostingStatus.DRAFT,
      },
    });
  }

  /**
   * Get posting statistics
   */
  async getStats() {
    const [byStatus, topPerforming, expiringSoon] = await Promise.all([
      // By status
      db.jobPosting.groupBy({
        by: ["status"],
        where: { tenantId: this.tenantId },
        _count: true,
        _sum: { viewCount: true, applicationCount: true },
      }),

      // Top performing (by applications)
      db.jobPosting.findMany({
        where: {
          tenantId: this.tenantId,
          status: JobPostingStatus.PUBLISHED,
        },
        orderBy: { applicationCount: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          viewCount: true,
          applicationCount: true,
          publishedAt: true,
        },
      }),

      // Expiring soon (within 7 days)
      db.jobPosting.findMany({
        where: {
          tenantId: this.tenantId,
          status: JobPostingStatus.PUBLISHED,
          expiresAt: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        },
        select: {
          id: true,
          title: true,
          expiresAt: true,
        },
      }),
    ]);

    return {
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count,
        totalViews: s._sum.viewCount || 0,
        totalApplications: s._sum.applicationCount || 0,
      })),
      topPerforming,
      expiringSoon,
    };
  }

  /**
   * Increment application count
   */
  async incrementApplicationCount(id: string) {
    return db.jobPosting.update({
      where: { id },
      data: { applicationCount: { increment: 1 } },
    });
  }
}

// Factory function
export function createJobPostingService(tenantId: string): JobPostingService {
  return new JobPostingService(tenantId);
}
