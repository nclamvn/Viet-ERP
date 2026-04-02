import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-unified-client";

export async function createPIP(
  tenantId: string,
  data: {
    employeeId: string;
    managerId: string;
    hrContactId?: string;
    startDate: Date;
    endDate: Date;
    performanceIssues: string;
    impactDescription?: string;
    expectedOutcomes: string;
    supportProvided?: string;
    resources?: string;
    milestones?: {
      title: string;
      description?: string;
      dueDate: Date;
      order?: number;
    }[];
  },
) {
  return db.performanceImprovementPlan.create({
    data: {
      tenantId,
      employeeId: data.employeeId,
      managerId: data.managerId,
      hrContactId: data.hrContactId,
      startDate: data.startDate,
      endDate: data.endDate,
      performanceIssues: data.performanceIssues,
      impactDescription: data.impactDescription,
      expectedOutcomes: data.expectedOutcomes,
      supportProvided: data.supportProvided,
      resources: data.resources,
      status: "DRAFT",
      milestones: data.milestones
        ? {
            create: data.milestones.map((m, index) => ({
              title: m.title,
              description: m.description,
              dueDate: m.dueDate,
              order: m.order ?? index,
              status: "PENDING",
            })),
          }
        : undefined,
    },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      manager: {
        select: { id: true, fullName: true },
      },
      hrContact: {
        select: { id: true, name: true },
      },
      milestones: {
        orderBy: { order: "asc" },
      },
    },
  });
}

export async function getPIPs(
  tenantId: string,
  filters?: {
    employeeId?: string;
    managerId?: string;
    status?:
      | "DRAFT"
      | "ACTIVE"
      | "EXTENDED"
      | "COMPLETED_SUCCESS"
      | "COMPLETED_FAIL"
      | "CANCELLED";
    search?: string;
  },
  page = 1,
  limit = 20,
) {
  const where: Prisma.PerformanceImprovementPlanWhereInput = {
    tenantId,
    ...(filters?.employeeId && { employeeId: filters.employeeId }),
    ...(filters?.managerId && { managerId: filters.managerId }),
    ...(filters?.status && { status: filters.status }),
    ...(filters?.search && {
      employee: {
        OR: [
          {
            fullName: {
              contains: filters.search,
              mode: "insensitive" as const,
            },
          },
          {
            employeeCode: {
              contains: filters.search,
              mode: "insensitive" as const,
            },
          },
        ],
      },
    }),
  };

  const [data, total] = await Promise.all([
    db.performanceImprovementPlan.findMany({
      where,
      include: {
        employee: {
          select: { id: true, fullName: true, employeeCode: true },
        },
        manager: {
          select: { id: true, fullName: true },
        },
        _count: {
          select: { milestones: true, checkIns: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.performanceImprovementPlan.count({ where }),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getPIPById(id: string, tenantId: string) {
  return db.performanceImprovementPlan.findFirst({
    where: { id, tenantId },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      manager: {
        select: { id: true, fullName: true },
      },
      hrContact: {
        select: { id: true, name: true },
      },
      milestones: {
        orderBy: { order: "asc" },
      },
      checkIns: {
        include: {
          createdBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: { checkInDate: "desc" },
      },
    },
  });
}

export async function updatePIP(
  id: string,
  tenantId: string,
  data: {
    startDate?: Date;
    endDate?: Date;
    performanceIssues?: string;
    impactDescription?: string;
    expectedOutcomes?: string;
    supportProvided?: string;
    resources?: string;
    status?:
      | "DRAFT"
      | "ACTIVE"
      | "EXTENDED"
      | "COMPLETED_SUCCESS"
      | "COMPLETED_FAIL"
      | "CANCELLED";
    outcome?: string;
    completedAt?: Date;
    employeeAcknowledgedAt?: Date;
  },
) {
  const pip = await db.performanceImprovementPlan.findFirst({
    where: { id, tenantId },
  });

  if (!pip) {
    throw new Error("PIP not found");
  }

  return db.performanceImprovementPlan.update({
    where: { id },
    data: {
      ...(data.startDate !== undefined && { startDate: data.startDate }),
      ...(data.endDate !== undefined && { endDate: data.endDate }),
      ...(data.performanceIssues !== undefined && {
        performanceIssues: data.performanceIssues,
      }),
      ...(data.impactDescription !== undefined && {
        impactDescription: data.impactDescription,
      }),
      ...(data.expectedOutcomes !== undefined && {
        expectedOutcomes: data.expectedOutcomes,
      }),
      ...(data.supportProvided !== undefined && {
        supportProvided: data.supportProvided,
      }),
      ...(data.resources !== undefined && { resources: data.resources }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.outcome !== undefined && { outcome: data.outcome }),
      ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
      ...(data.employeeAcknowledgedAt !== undefined && {
        employeeAcknowledgedAt: data.employeeAcknowledgedAt,
      }),
    },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      manager: {
        select: { id: true, fullName: true },
      },
      milestones: {
        orderBy: { order: "asc" },
      },
    },
  });
}

export async function addMilestone(
  pipId: string,
  data: {
    title: string;
    description?: string;
    dueDate: Date;
    order?: number;
  },
) {
  // Get max order for this PIP
  const maxOrder = await db.pIPMilestone.aggregate({
    where: { pipId },
    _max: { order: true },
  });

  return db.pIPMilestone.create({
    data: {
      pipId,
      title: data.title,
      description: data.description,
      dueDate: data.dueDate,
      order: data.order ?? (maxOrder._max.order ?? -1) + 1,
      status: "PENDING",
    },
  });
}

export async function updateMilestone(
  id: string,
  data: {
    title?: string;
    description?: string;
    dueDate?: Date;
    status?: string;
    notes?: string;
    completedAt?: Date;
    order?: number;
  },
) {
  return db.pIPMilestone.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.dueDate !== undefined && { dueDate: data.dueDate }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
      ...(data.order !== undefined && { order: data.order }),
    },
  });
}

export async function addPIPCheckIn(
  pipId: string,
  userId: string,
  data: {
    checkInDate: Date;
    progressNotes: string;
    managerAssessment?: string;
    isOnTrack: boolean;
    nextSteps?: string;
  },
) {
  return db.pIPCheckIn.create({
    data: {
      pipId,
      checkInDate: data.checkInDate,
      progressNotes: data.progressNotes,
      managerAssessment: data.managerAssessment,
      isOnTrack: data.isOnTrack,
      nextSteps: data.nextSteps,
      createdById: userId,
    },
    include: {
      createdBy: {
        select: { id: true, name: true },
      },
    },
  });
}
