import { db } from "@/lib/db";
import type {
  InterviewType,
  InterviewResult,
} from ".prisma/hrm-unified-client";

export async function createInterview(
  tenantId: string,
  data: {
    applicationId: string;
    interviewType: string;
    round?: number;
    scheduledAt: Date;
    duration?: number;
    location?: string;
    interviewerIds: string[];
  },
  userId: string,
) {
  const existingInterviews = await db.interview.count({
    where: { applicationId: data.applicationId },
  });

  const round = data.round || existingInterviews + 1;

  const interview = await db.interview.create({
    data: {
      tenantId,
      applicationId: data.applicationId,
      interviewType: data.interviewType as InterviewType,
      round,
      scheduledAt: data.scheduledAt,
      duration: data.duration || 60,
      location: data.location,
      interviewerIds: data.interviewerIds,
      result: "PENDING",
    },
  });

  await db.applicationActivity.create({
    data: {
      applicationId: data.applicationId,
      action: "interview_scheduled",
      description: `Đã lên lịch phỏng vấn vòng ${round}`,
      performedById: userId,
    },
  });

  return interview;
}

export async function getInterviews(
  tenantId: string,
  filters?: {
    applicationId?: string;
    interviewerId?: string;
    startDate?: Date;
    endDate?: Date;
    result?: string;
  },
) {
  const where: Record<string, unknown> = { tenantId };

  if (filters?.applicationId) where.applicationId = filters.applicationId;
  if (filters?.result) where.result = filters.result;

  if (filters?.startDate || filters?.endDate) {
    const scheduledAt: { gte?: Date; lte?: Date } = {};
    if (filters.startDate) scheduledAt.gte = filters.startDate;
    if (filters.endDate) scheduledAt.lte = filters.endDate;
    where.scheduledAt = scheduledAt;
  }

  const interviews = await db.interview.findMany({
    where,
    include: {
      application: {
        include: {
          candidate: true,
          requisition: { select: { id: true, title: true } },
        },
      },
      evaluations: {
        include: {
          evaluator: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });

  if (filters?.interviewerId) {
    return interviews.filter((i) =>
      (i.interviewerIds as string[]).includes(filters.interviewerId!),
    );
  }

  return interviews;
}

export async function getInterviewById(id: string, tenantId: string) {
  return db.interview.findFirst({
    where: { id, tenantId },
    include: {
      application: {
        include: {
          candidate: true,
          requisition: { include: { department: true } },
        },
      },
      evaluations: {
        include: {
          evaluator: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
}

export async function updateInterviewResult(
  id: string,
  tenantId: string,
  result: string,
  notes?: string,
  userId?: string,
) {
  const interview = await db.interview.findFirst({
    where: { id, tenantId },
  });

  if (!interview) return null;

  const updated = await db.interview.update({
    where: { id },
    data: { result: result as InterviewResult, notes },
  });

  if (userId) {
    await db.applicationActivity.create({
      data: {
        applicationId: interview.applicationId,
        action: "interview_result",
        description: `Kết quả phỏng vấn vòng ${interview.round}: ${result}`,
        performedById: userId,
      },
    });
  }

  return updated;
}

export async function rescheduleInterview(
  id: string,
  tenantId: string,
  newScheduledAt: Date,
  reason?: string,
  userId?: string,
) {
  const interview = await db.interview.findFirst({
    where: { id, tenantId },
  });

  if (!interview) return null;

  const updated = await db.interview.update({
    where: { id },
    data: {
      scheduledAt: newScheduledAt,
      result: "RESCHEDULED",
    },
  });

  if (userId) {
    await db.applicationActivity.create({
      data: {
        applicationId: interview.applicationId,
        action: "interview_rescheduled",
        description: `Dời lịch phỏng vấn vòng ${interview.round}${reason ? `: ${reason}` : ""}`,
        performedById: userId,
      },
    });
  }

  return updated;
}

export async function getCalendarEvents(
  tenantId: string,
  userId: string,
  startDate: Date,
  endDate: Date,
) {
  const interviews = await db.interview.findMany({
    where: {
      tenantId,
      scheduledAt: { gte: startDate, lte: endDate },
    },
    include: {
      application: {
        include: {
          candidate: { select: { fullName: true, email: true } },
          requisition: { select: { title: true } },
        },
      },
    },
  });

  return interviews
    .filter((i) => (i.interviewerIds as string[]).includes(userId))
    .map((i) => ({
      id: i.id,
      title: `PV: ${i.application.candidate.fullName} - ${i.application.requisition.title}`,
      start: i.scheduledAt,
      end: new Date(i.scheduledAt.getTime() + i.duration * 60000),
      type: i.interviewType,
      round: i.round,
      location: i.location,
      candidate: i.application.candidate,
      result: i.result,
    }));
}
