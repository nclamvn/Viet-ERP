// src/lib/recruitment/services/requisition.service.ts
// Job Requisition Service - Manage job requisition workflows

import { db } from "@/lib/db";
import {
  RequisitionStatus,
  JobType,
  WorkMode,
  Prisma,
  ApplicationStatus,
} from ".prisma/hrm-ai-client";

// Types
export interface CreateRequisitionInput {
  title: string;
  departmentId: string;
  reportingToId?: string;
  jobType?: JobType;
  workMode?: WorkMode;
  location?: string;
  headcount?: number;
  salaryMin?: number;
  salaryMax?: number;
  salaryDisplay?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
  priority?: string;
  targetHireDate?: Date;
}

export interface UpdateRequisitionInput extends Partial<CreateRequisitionInput> {
  status?: RequisitionStatus;
  approvalNote?: string;
}

export interface RequisitionFilters {
  status?: RequisitionStatus[];
  departmentId?: string;
  jobType?: JobType;
  requestedById?: string;
  search?: string;
  fromDate?: Date;
  toDate?: Date;
}

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

// Helper to generate requisition code
async function generateRequisitionCode(tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `REQ-${year}-`;

  const lastRequisition = await db.jobRequisition.findFirst({
    where: {
      tenantId,
      requisitionCode: { startsWith: prefix },
    },
    orderBy: { requisitionCode: "desc" },
  });

  let nextNumber = 1;
  if (lastRequisition) {
    const lastNumber = parseInt(
      lastRequisition.requisitionCode.replace(prefix, ""),
      10,
    );
    nextNumber = lastNumber + 1;
  }

  return `${prefix}${nextNumber.toString().padStart(4, "0")}`;
}

export class JobRequisitionService {
  constructor(private tenantId: string) {}

  /**
   * Create a new job requisition
   */
  async create(requestedById: string, input: CreateRequisitionInput) {
    const requisitionCode = await generateRequisitionCode(this.tenantId);

    const requisition = await db.jobRequisition.create({
      data: {
        tenantId: this.tenantId,
        requisitionCode,
        title: input.title,
        departmentId: input.departmentId,
        reportingToId: input.reportingToId,
        jobType: input.jobType || JobType.FULL_TIME,
        workMode: input.workMode || WorkMode.ONSITE,
        location: input.location,
        headcount: input.headcount || 1,
        salaryMin: input.salaryMin,
        salaryMax: input.salaryMax,
        salaryDisplay: input.salaryDisplay,
        description: input.description,
        requirements: input.requirements,
        benefits: input.benefits,
        priority: input.priority || "NORMAL",
        targetHireDate: input.targetHireDate,
        requestedById,
        status: RequisitionStatus.DRAFT,
      },
      include: {
        department: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
        reportingTo: { select: { id: true, fullName: true } },
      },
    });

    return requisition;
  }

  /**
   * Get requisition by ID
   */
  async getById(id: string) {
    const requisition = await db.jobRequisition.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        department: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        reportingTo: { select: { id: true, fullName: true, avatar: true } },
        jobPostings: {
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            applicationCount: true,
          },
        },
        _count: {
          select: {
            applications: true,
            jobPostings: true,
          },
        },
      },
    });

    if (!requisition) {
      throw new Error("Requisition not found");
    }

    // Get application stats
    const applications = await db.application.findMany({
      where: { requisitionId: id },
      select: { status: true },
    });

    const applicationStats = applications.reduce(
      (acc: Record<string, number>, app) => {
        acc[app.status] = (acc[app.status] || 0) + 1;
        return acc;
      },
      {},
    );

    return {
      ...requisition,
      applicationStats,
    };
  }

  /**
   * List requisitions with filters and pagination
   */
  async list(
    filters: RequisitionFilters = {},
    pagination: PaginationOptions = {},
  ) {
    const {
      page = 1,
      pageSize = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = pagination;
    const skip = (page - 1) * pageSize;

    const where: Prisma.JobRequisitionWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    if (filters.departmentId) {
      where.departmentId = filters.departmentId;
    }

    if (filters.jobType) {
      where.jobType = filters.jobType;
    }

    if (filters.requestedById) {
      where.requestedById = filters.requestedById;
    }

    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
        { requisitionCode: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
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

    const [requisitions, total] = await Promise.all([
      db.jobRequisition.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
        include: {
          department: { select: { id: true, name: true } },
          requestedBy: { select: { id: true, name: true } },
          _count: {
            select: {
              applications: true,
              jobPostings: true,
            },
          },
        },
      }),
      db.jobRequisition.count({ where }),
    ]);

    return {
      data: requisitions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Update a requisition
   */
  async update(id: string, userId: string, input: UpdateRequisitionInput) {
    const requisition = await db.jobRequisition.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!requisition) {
      throw new Error("Requisition not found");
    }

    // Check if status change is allowed
    if (
      input.status &&
      !this.isStatusTransitionAllowed(requisition.status, input.status)
    ) {
      throw new Error(
        `Cannot transition from ${requisition.status} to ${input.status}`,
      );
    }

    const updateData: Prisma.JobRequisitionUpdateInput = {};

    // Only allow editing in DRAFT or REJECTED status
    if (
      requisition.status === RequisitionStatus.DRAFT ||
      requisition.status === RequisitionStatus.REJECTED
    ) {
      if (input.title) updateData.title = input.title;
      if (input.departmentId)
        updateData.department = { connect: { id: input.departmentId } };
      if (input.reportingToId !== undefined) {
        updateData.reportingTo = input.reportingToId
          ? { connect: { id: input.reportingToId } }
          : { disconnect: true };
      }
      if (input.jobType) updateData.jobType = input.jobType;
      if (input.workMode) updateData.workMode = input.workMode;
      if (input.location !== undefined) updateData.location = input.location;
      if (input.headcount) updateData.headcount = input.headcount;
      if (input.salaryMin !== undefined) updateData.salaryMin = input.salaryMin;
      if (input.salaryMax !== undefined) updateData.salaryMax = input.salaryMax;
      if (input.salaryDisplay !== undefined)
        updateData.salaryDisplay = input.salaryDisplay;
      if (input.description !== undefined)
        updateData.description = input.description;
      if (input.requirements !== undefined)
        updateData.requirements = input.requirements;
      if (input.benefits !== undefined) updateData.benefits = input.benefits;
      if (input.priority) updateData.priority = input.priority;
      if (input.targetHireDate !== undefined)
        updateData.targetHireDate = input.targetHireDate;
    }

    if (input.status) {
      updateData.status = input.status;
    }

    if (input.approvalNote) {
      updateData.approvalNote = input.approvalNote;
    }

    return db.jobRequisition.update({
      where: { id },
      data: updateData,
      include: {
        department: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Submit requisition for approval
   */
  async submitForApproval(id: string, userId: string) {
    const requisition = await db.jobRequisition.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!requisition) {
      throw new Error("Requisition not found");
    }

    if (requisition.status !== RequisitionStatus.DRAFT) {
      throw new Error("Only draft requisitions can be submitted for approval");
    }

    return db.jobRequisition.update({
      where: { id },
      data: { status: RequisitionStatus.PENDING_APPROVAL },
    });
  }

  /**
   * Approve a requisition
   */
  async approve(id: string, approvedById: string, note?: string) {
    const requisition = await db.jobRequisition.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!requisition) {
      throw new Error("Requisition not found");
    }

    if (requisition.status !== RequisitionStatus.PENDING_APPROVAL) {
      throw new Error("Only pending requisitions can be approved");
    }

    return db.jobRequisition.update({
      where: { id },
      data: {
        status: RequisitionStatus.APPROVED,
        approvedById,
        approvedAt: new Date(),
        approvalNote: note,
      },
    });
  }

  /**
   * Reject a requisition
   */
  async reject(id: string, rejectedById: string, reason: string) {
    const requisition = await db.jobRequisition.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!requisition) {
      throw new Error("Requisition not found");
    }

    if (requisition.status !== RequisitionStatus.PENDING_APPROVAL) {
      throw new Error("Only pending requisitions can be rejected");
    }

    return db.jobRequisition.update({
      where: { id },
      data: {
        status: RequisitionStatus.REJECTED,
        approvedById: rejectedById,
        approvedAt: new Date(),
        approvalNote: reason,
      },
    });
  }

  /**
   * Open requisition for hiring
   */
  async open(id: string) {
    const requisition = await db.jobRequisition.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!requisition) {
      throw new Error("Requisition not found");
    }

    if (requisition.status !== RequisitionStatus.APPROVED) {
      throw new Error("Only approved requisitions can be opened");
    }

    return db.jobRequisition.update({
      where: { id },
      data: { status: RequisitionStatus.OPEN },
    });
  }

  /**
   * Put requisition on hold
   */
  async hold(id: string, reason?: string) {
    const requisition = await db.jobRequisition.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!requisition) {
      throw new Error("Requisition not found");
    }

    if (requisition.status !== RequisitionStatus.OPEN) {
      throw new Error("Only open requisitions can be put on hold");
    }

    return db.jobRequisition.update({
      where: { id },
      data: {
        status: RequisitionStatus.ON_HOLD,
        approvalNote: reason ? `On Hold: ${reason}` : requisition.approvalNote,
      },
    });
  }

  /**
   * Cancel a requisition
   */
  async cancel(id: string, reason: string) {
    const requisition = await db.jobRequisition.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!requisition) {
      throw new Error("Requisition not found");
    }

    if (requisition.status === RequisitionStatus.FILLED) {
      throw new Error("Cannot cancel a filled requisition");
    }

    return db.jobRequisition.update({
      where: { id },
      data: {
        status: RequisitionStatus.CANCELLED,
        approvalNote: `Cancelled: ${reason}`,
      },
    });
  }

  /**
   * Mark as filled when headcount is met
   */
  async updateFilledCount(id: string, increment: number = 1) {
    const requisition = await db.jobRequisition.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!requisition) {
      throw new Error("Requisition not found");
    }

    const newFilledCount = requisition.filledCount + increment;
    const isFilled = newFilledCount >= requisition.headcount;

    return db.jobRequisition.update({
      where: { id },
      data: {
        filledCount: newFilledCount,
        status: isFilled ? RequisitionStatus.FILLED : requisition.status,
      },
    });
  }

  /**
   * Get requisition statistics
   */
  async getStats() {
    const [byStatus, byDepartment, byJobType, avgTimeToFill] =
      await Promise.all([
        // By status
        db.jobRequisition.groupBy({
          by: ["status"],
          where: { tenantId: this.tenantId },
          _count: true,
        }),

        // By department
        db.jobRequisition.groupBy({
          by: ["departmentId"],
          where: {
            tenantId: this.tenantId,
            status: {
              in: [RequisitionStatus.OPEN, RequisitionStatus.APPROVED],
            },
          },
          _count: true,
          _sum: { headcount: true },
        }),

        // By job type
        db.jobRequisition.groupBy({
          by: ["jobType"],
          where: {
            tenantId: this.tenantId,
            status: {
              notIn: [RequisitionStatus.CANCELLED, RequisitionStatus.REJECTED],
            },
          },
          _count: true,
        }),

        // Average time to fill (for filled requisitions)
        db.jobRequisition.findMany({
          where: {
            tenantId: this.tenantId,
            status: RequisitionStatus.FILLED,
          },
          select: {
            approvedAt: true,
            updatedAt: true,
          },
        }),
      ]);

    // Calculate average time to fill
    let avgDaysToFill = 0;
    if (avgTimeToFill.length > 0) {
      const totalDays = avgTimeToFill.reduce((sum, req) => {
        if (req.approvedAt) {
          const days = Math.floor(
            (req.updatedAt.getTime() - req.approvedAt.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          return sum + days;
        }
        return sum;
      }, 0);
      avgDaysToFill = Math.round(totalDays / avgTimeToFill.length);
    }

    // Get department names
    const departmentIds = byDepartment.map((d) => d.departmentId);
    const departments = await db.department.findMany({
      where: { id: { in: departmentIds } },
      select: { id: true, name: true },
    });
    const deptMap = new Map(departments.map((d) => [d.id, d.name]));

    return {
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count,
      })),
      byDepartment: byDepartment.map((d) => ({
        departmentId: d.departmentId,
        departmentName: deptMap.get(d.departmentId) || "Unknown",
        count: d._count,
        totalHeadcount: d._sum.headcount || 0,
      })),
      byJobType: byJobType.map((j) => ({
        jobType: j.jobType,
        count: j._count,
      })),
      avgDaysToFill,
    };
  }

  /**
   * Check if status transition is allowed
   */
  private isStatusTransitionAllowed(
    from: RequisitionStatus,
    to: RequisitionStatus,
  ): boolean {
    const allowedTransitions: Record<RequisitionStatus, RequisitionStatus[]> = {
      [RequisitionStatus.DRAFT]: [
        RequisitionStatus.PENDING_APPROVAL,
        RequisitionStatus.CANCELLED,
      ],
      [RequisitionStatus.PENDING_APPROVAL]: [
        RequisitionStatus.APPROVED,
        RequisitionStatus.REJECTED,
      ],
      [RequisitionStatus.APPROVED]: [
        RequisitionStatus.OPEN,
        RequisitionStatus.CANCELLED,
      ],
      [RequisitionStatus.REJECTED]: [RequisitionStatus.DRAFT],
      [RequisitionStatus.OPEN]: [
        RequisitionStatus.ON_HOLD,
        RequisitionStatus.FILLED,
        RequisitionStatus.CANCELLED,
      ],
      [RequisitionStatus.ON_HOLD]: [
        RequisitionStatus.OPEN,
        RequisitionStatus.CANCELLED,
      ],
      [RequisitionStatus.FILLED]: [],
      [RequisitionStatus.CANCELLED]: [],
    };

    return allowedTransitions[from]?.includes(to) || false;
  }
}

// Factory function
export function createJobRequisitionService(
  tenantId: string,
): JobRequisitionService {
  return new JobRequisitionService(tenantId);
}
