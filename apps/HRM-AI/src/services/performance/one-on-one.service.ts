import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-ai-client";

export async function createOneOnOne(
  tenantId: string,
  data: {
    employeeId: string;
    managerId: string;
    scheduledAt: Date;
    duration?: number;
    agenda?: { topic: string; owner: "employee" | "manager"; notes?: string }[];
  },
) {
  return db.oneOnOne.create({
    data: {
      tenantId,
      employeeId: data.employeeId,
      managerId: data.managerId,
      scheduledAt: data.scheduledAt,
      duration: data.duration ?? 30,
      agenda: data.agenda as any,
    },
    include: {
      employee: {
        select: { id: true, fullName: true },
      },
      manager: {
        select: { id: true, fullName: true },
      },
    },
  });
}

export async function getOneOnOnes(
  tenantId: string,
  filters?: {
    employeeId?: string;
    managerId?: string;
    isCompleted?: boolean;
    startDate?: Date;
    endDate?: Date;
  },
  page = 1,
  limit = 20,
) {
  const where: Prisma.OneOnOneWhereInput = {
    tenantId,
    ...(filters?.employeeId && { employeeId: filters.employeeId }),
    ...(filters?.managerId && { managerId: filters.managerId }),
    ...(filters?.isCompleted !== undefined && {
      completedAt: filters.isCompleted ? { not: null } : null,
    }),
    ...(filters?.startDate &&
      filters?.endDate && {
        scheduledAt: {
          gte: filters.startDate,
          lte: filters.endDate,
        },
      }),
  };

  const [data, total] = await Promise.all([
    db.oneOnOne.findMany({
      where,
      include: {
        employee: {
          select: { id: true, fullName: true },
        },
        manager: {
          select: { id: true, fullName: true },
        },
      },
      orderBy: { scheduledAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.oneOnOne.count({ where }),
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

export async function getOneOnOneById(id: string, tenantId: string) {
  return db.oneOnOne.findFirst({
    where: { id, tenantId },
    include: {
      employee: {
        select: { id: true, fullName: true },
      },
      manager: {
        select: { id: true, fullName: true },
      },
    },
  });
}

export async function updateOneOnOne(
  id: string,
  tenantId: string,
  data: {
    scheduledAt?: Date;
    duration?: number;
    agenda?: { topic: string; owner: "employee" | "manager"; notes?: string }[];
    employeeNotes?: string;
    managerNotes?: string;
    actionItems?: {
      task: string;
      assignee: string;
      dueDate?: string;
      completed: boolean;
    }[];
    completedAt?: Date | null;
  },
) {
  const oneOnOne = await db.oneOnOne.findFirst({
    where: { id, tenantId },
  });

  if (!oneOnOne) {
    throw new Error("One-on-one not found");
  }

  return db.oneOnOne.update({
    where: { id },
    data: {
      ...(data.scheduledAt !== undefined && { scheduledAt: data.scheduledAt }),
      ...(data.duration !== undefined && { duration: data.duration }),
      ...(data.agenda !== undefined && { agenda: data.agenda as any }),
      ...(data.employeeNotes !== undefined && {
        employeeNotes: data.employeeNotes,
      }),
      ...(data.managerNotes !== undefined && {
        managerNotes: data.managerNotes,
      }),
      ...(data.actionItems !== undefined && {
        actionItems: data.actionItems as any,
      }),
      ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
    },
    include: {
      employee: {
        select: { id: true, fullName: true },
      },
      manager: {
        select: { id: true, fullName: true },
      },
    },
  });
}
