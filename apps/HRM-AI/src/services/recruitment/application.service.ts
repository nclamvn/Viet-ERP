import { db } from "@/lib/db";
import { ApplicationSource, Prisma } from ".prisma/hrm-ai-client";
import { audit } from "@/lib/recruitment/utils";
import { APPLICATION_STATUS } from "@/lib/recruitment/constants";
import type { AuditContext } from "@/types/audit";

export async function generateApplicationCode(
  tenantId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.application.count({
    where: {
      tenantId,
      createdAt: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1),
      },
    },
  });
  return `APP-${year}-${String(count + 1).padStart(5, "0")}`;
}

export async function createApplication(
  tenantId: string,
  data: {
    candidateId: string;
    requisitionId: string;
    jobPostingId?: string;
    coverLetter?: string;
    source?: string;
    answers?: Record<string, unknown>;
  },
) {
  const applicationCode = await generateApplicationCode(tenantId);

  const application = await db.application.create({
    data: {
      tenantId,
      applicationCode,
      candidateId: data.candidateId,
      requisitionId: data.requisitionId,
      jobPostingId: data.jobPostingId,
      coverLetter: data.coverLetter,
      source:
        (data.source as ApplicationSource) || ApplicationSource.CAREERS_PAGE,
      answers: data.answers as Prisma.InputJsonValue,
      status: "NEW",
      stage: 1,
    },
    include: {
      candidate: true,
      requisition: { include: { department: true } },
    },
  });

  if (data.jobPostingId) {
    await db.jobPosting.update({
      where: { id: data.jobPostingId },
      data: { applicationCount: { increment: 1 } },
    });
  }

  await db.applicationActivity.create({
    data: {
      applicationId: application.id,
      action: "application_created",
      description: "Ứng viên đã nộp hồ sơ",
      newValue: "NEW",
    },
  });

  return application;
}

export async function getApplications(
  tenantId: string,
  filters?: {
    status?: string;
    requisitionId?: string;
    assignedToId?: string;
    source?: string;
    search?: string;
  },
  page = 1,
  limit = 20,
) {
  const where: Record<string, unknown> = { tenantId };

  if (filters?.status) where.status = filters.status;
  if (filters?.requisitionId) where.requisitionId = filters.requisitionId;
  if (filters?.assignedToId) where.assignedToId = filters.assignedToId;
  if (filters?.source) where.source = filters.source;
  if (filters?.search) {
    where.candidate = {
      OR: [
        { fullName: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
      ],
    };
  }

  const [applications, total] = await Promise.all([
    db.application.findMany({
      where,
      include: {
        candidate: true,
        requisition: { include: { department: true } },
        assignedTo: { select: { id: true, name: true } },
        _count: { select: { interviews: true, evaluations: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.application.count({ where }),
  ]);

  return { applications, total, page, limit };
}

export async function getApplicationById(id: string, tenantId: string) {
  return db.application.findFirst({
    where: { id, tenantId },
    include: {
      candidate: true,
      requisition: { include: { department: true } },
      jobPosting: true,
      assignedTo: { select: { id: true, name: true, email: true } },
      interviews: {
        orderBy: { scheduledAt: "desc" },
        include: {
          evaluations: {
            include: {
              evaluator: { select: { id: true, name: true } },
            },
          },
        },
      },
      evaluations: {
        include: {
          evaluator: { select: { id: true, name: true } },
          interview: true,
        },
      },
      offers: { orderBy: { createdAt: "desc" } },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          performedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function updateApplicationStatus(
  id: string,
  tenantId: string,
  newStatus: string,
  userId: string,
  data?: {
    rejectionReason?: string;
    screeningScore?: number;
    screeningNotes?: string;
  },
  ctx?: AuditContext,
) {
  const application = await db.application.findFirst({
    where: { id, tenantId },
    include: { candidate: true },
  });

  if (!application) return null;

  const oldStatus = application.status;
  const statusConfig = APPLICATION_STATUS[newStatus];
  const stage = statusConfig?.stage || application.stage;

  const updateData: Record<string, unknown> = {
    status: newStatus,
    stage,
  };

  if (newStatus === "REJECTED") {
    updateData.rejectionReason = data?.rejectionReason;
    updateData.rejectedAt = new Date();
    updateData.rejectedById = userId;
  }

  if (newStatus === "HIRED") {
    updateData.hiredAt = new Date();
    updateData.hiredById = userId;
  }

  if (data?.screeningScore !== undefined) {
    updateData.screeningScore = data.screeningScore;
  }

  if (data?.screeningNotes) {
    updateData.screeningNotes = data.screeningNotes;
  }

  const updated = await db.application.update({
    where: { id },
    data: updateData,
    include: { candidate: true, requisition: true },
  });

  await db.applicationActivity.create({
    data: {
      applicationId: id,
      action: "status_changed",
      description: `Trạng thái chuyển từ ${oldStatus} sang ${newStatus}`,
      oldValue: oldStatus,
      newValue: newStatus,
      performedById: userId,
    },
  });

  if (newStatus === "HIRED") {
    await db.jobRequisition.update({
      where: { id: application.requisitionId },
      data: { filledCount: { increment: 1 } },
    });
  }

  if (ctx) {
    await audit.update(ctx, "Application", id, {
      status: { old: oldStatus, new: newStatus },
    });
  }

  return updated;
}

export async function getPipelineData(
  tenantId: string,
  requisitionId?: string,
) {
  const where: Record<string, unknown> = {
    tenantId,
    status: { notIn: ["REJECTED", "WITHDRAWN", "HIRED"] },
  };
  if (requisitionId) where.requisitionId = requisitionId;

  const applications = await db.application.findMany({
    where,
    include: {
      candidate: true,
      requisition: { select: { id: true, title: true } },
      _count: { select: { interviews: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const pipeline: Record<string, typeof applications> = {
    NEW: [],
    SCREENING: [],
    PHONE_SCREEN: [],
    INTERVIEW: [],
    ASSESSMENT: [],
    OFFER: [],
  };

  applications.forEach((app) => {
    if (pipeline[app.status]) {
      pipeline[app.status].push(app);
    }
  });

  return pipeline;
}

export async function assignApplication(
  id: string,
  tenantId: string,
  assigneeId: string,
  userId: string,
) {
  const application = await db.application.findFirst({
    where: { id, tenantId },
  });

  if (!application) return null;

  const updated = await db.application.update({
    where: { id },
    data: { assignedToId: assigneeId },
    include: {
      assignedTo: { select: { id: true, name: true } },
    },
  });

  await db.applicationActivity.create({
    data: {
      applicationId: id,
      action: "assigned",
      description: `Hồ sơ được giao cho ${updated.assignedTo?.name}`,
      performedById: userId,
    },
  });

  return updated;
}
