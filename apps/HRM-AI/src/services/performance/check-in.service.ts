import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-ai-client";

export async function createCheckIn(
  tenantId: string,
  data: {
    employeeId: string;
    managerId: string;
    checkInDate: Date;
    accomplishments?: string;
    challenges?: string;
    priorities?: string;
    supportNeeded?: string;
    moodRating?: number;
  },
) {
  return db.checkIn.create({
    data: {
      tenantId,
      employeeId: data.employeeId,
      managerId: data.managerId,
      checkInDate: data.checkInDate,
      accomplishments: data.accomplishments,
      challenges: data.challenges,
      priorities: data.priorities,
      supportNeeded: data.supportNeeded,
      moodRating: data.moodRating,
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

export async function getCheckIns(
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
  const where: Prisma.CheckInWhereInput = {
    tenantId,
    ...(filters?.employeeId && { employeeId: filters.employeeId }),
    ...(filters?.managerId && { managerId: filters.managerId }),
    ...(filters?.isCompleted !== undefined && {
      isCompleted: filters.isCompleted,
    }),
    ...(filters?.startDate &&
      filters?.endDate && {
        checkInDate: {
          gte: filters.startDate,
          lte: filters.endDate,
        },
      }),
  };

  const [data, total] = await Promise.all([
    db.checkIn.findMany({
      where,
      include: {
        employee: {
          select: { id: true, fullName: true },
        },
        manager: {
          select: { id: true, fullName: true },
        },
      },
      orderBy: { checkInDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.checkIn.count({ where }),
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

export async function getCheckInById(id: string, tenantId: string) {
  return db.checkIn.findFirst({
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

export async function updateCheckIn(
  id: string,
  tenantId: string,
  data: {
    accomplishments?: string;
    challenges?: string;
    priorities?: string;
    supportNeeded?: string;
    moodRating?: number;
    managerNotes?: string;
    actionItems?: {
      task: string;
      assignee: string;
      dueDate?: string;
      completed: boolean;
    }[];
    isCompleted?: boolean;
  },
) {
  const checkIn = await db.checkIn.findFirst({
    where: { id, tenantId },
  });

  if (!checkIn) {
    throw new Error("Check-in not found");
  }

  return db.checkIn.update({
    where: { id },
    data: {
      ...(data.accomplishments !== undefined && {
        accomplishments: data.accomplishments,
      }),
      ...(data.challenges !== undefined && { challenges: data.challenges }),
      ...(data.priorities !== undefined && { priorities: data.priorities }),
      ...(data.supportNeeded !== undefined && {
        supportNeeded: data.supportNeeded,
      }),
      ...(data.moodRating !== undefined && { moodRating: data.moodRating }),
      ...(data.managerNotes !== undefined && {
        managerNotes: data.managerNotes,
      }),
      ...(data.actionItems !== undefined && {
        actionItems: data.actionItems as any,
      }),
      ...(data.isCompleted !== undefined && { isCompleted: data.isCompleted }),
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
