import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-unified-client";

export async function createCalibrationSession(
  tenantId: string,
  data: {
    reviewCycleId: string;
    name: string;
    description?: string;
    departmentId?: string;
    scheduledAt: Date;
    facilitatorId: string;
    participantIds: string[];
    notes?: string;
  },
) {
  return db.calibrationSession.create({
    data: {
      tenantId,
      reviewCycleId: data.reviewCycleId,
      name: data.name,
      description: data.description,
      departmentId: data.departmentId,
      scheduledAt: data.scheduledAt,
      facilitatorId: data.facilitatorId,
      participantIds: data.participantIds as any,
      notes: data.notes,
    },
    include: {
      department: {
        select: { id: true, name: true },
      },
      facilitator: {
        select: { id: true, name: true },
      },
      reviewCycle: {
        select: { id: true, name: true, year: true },
      },
    },
  });
}

export async function getCalibrationSessions(
  tenantId: string,
  filters?: {
    reviewCycleId?: string;
    departmentId?: string;
    facilitatorId?: string;
    isCompleted?: boolean;
  },
) {
  const where: Prisma.CalibrationSessionWhereInput = {
    tenantId,
    ...(filters?.reviewCycleId && { reviewCycleId: filters.reviewCycleId }),
    ...(filters?.departmentId && { departmentId: filters.departmentId }),
    ...(filters?.facilitatorId && { facilitatorId: filters.facilitatorId }),
    ...(filters?.isCompleted !== undefined && {
      completedAt: filters.isCompleted ? { not: null } : null,
    }),
  };

  return db.calibrationSession.findMany({
    where,
    include: {
      department: {
        select: { id: true, name: true },
      },
      facilitator: {
        select: { id: true, name: true },
      },
      reviewCycle: {
        select: { id: true, name: true, year: true },
      },
      _count: {
        select: { decisions: true },
      },
    },
    orderBy: { scheduledAt: "desc" },
  });
}

export async function getCalibrationSessionById(id: string, tenantId: string) {
  return db.calibrationSession.findFirst({
    where: { id, tenantId },
    include: {
      department: {
        select: { id: true, name: true },
      },
      facilitator: {
        select: { id: true, name: true },
      },
      reviewCycle: {
        select: { id: true, name: true, year: true },
      },
      decisions: {
        include: {
          employee: {
            select: { id: true, fullName: true, employeeCode: true },
          },
          decidedBy: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function submitCalibrationDecision(
  sessionId: string,
  data: {
    employeeId: string;
    originalRating: number;
    calibratedRating: number;
    reason?: string;
    decidedById: string;
  },
) {
  return db.calibrationDecision.upsert({
    where: {
      sessionId_employeeId: {
        sessionId,
        employeeId: data.employeeId,
      },
    },
    update: {
      originalRating: data.originalRating,
      calibratedRating: data.calibratedRating,
      reason: data.reason,
      decidedById: data.decidedById,
    },
    create: {
      sessionId,
      employeeId: data.employeeId,
      originalRating: data.originalRating,
      calibratedRating: data.calibratedRating,
      reason: data.reason,
      decidedById: data.decidedById,
    },
    include: {
      employee: {
        select: { id: true, fullName: true, employeeCode: true },
      },
      decidedBy: {
        select: { id: true, name: true },
      },
    },
  });
}

export async function completeCalibration(sessionId: string, tenantId: string) {
  const session = await db.calibrationSession.findFirst({
    where: { id: sessionId, tenantId },
    include: {
      decisions: true,
    },
  });

  if (!session) {
    throw new Error("Calibration session not found");
  }

  // Apply calibrated ratings to performance reviews
  await db.$transaction([
    // Update each employee's performance review with calibrated rating
    ...session.decisions.map((decision) =>
      db.performanceReview.updateMany({
        where: {
          tenantId,
          reviewCycleId: session.reviewCycleId,
          employeeId: decision.employeeId,
        },
        data: {
          calibratedRating: decision.calibratedRating,
          finalRating: decision.calibratedRating,
          calibratedAt: new Date(),
          status: "COMPLETED",
        },
      }),
    ),
    // Mark session as completed
    db.calibrationSession.update({
      where: { id: sessionId },
      data: { completedAt: new Date() },
    }),
  ]);

  return db.calibrationSession.findFirst({
    where: { id: sessionId },
    include: {
      decisions: {
        include: {
          employee: {
            select: { id: true, fullName: true, employeeCode: true },
          },
        },
      },
    },
  });
}
