import { db } from "@/lib/db";
import { Prisma } from ".prisma/hrm-ai-client";
import type { JobType, WorkMode } from ".prisma/hrm-ai-client";
import { audit } from "@/lib/recruitment/utils";
import { emailService } from "@/services/email.service";
import type { AuditContext } from "@/types/audit";

export async function generateOfferCode(tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.offer.count({
    where: {
      tenantId,
      createdAt: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1),
      },
    },
  });
  return `OFFER-${year}-${String(count + 1).padStart(4, "0")}`;
}

export async function createOffer(
  tenantId: string,
  data: {
    applicationId: string;
    position: string;
    departmentId: string;
    reportingToId?: string;
    jobType: string;
    workMode: string;
    location?: string;
    baseSalary: number;
    allowances?: { name: string; amount: number }[];
    bonus?: string;
    benefits?: string;
    startDate: Date;
    probationMonths?: number;
    expiresAt: Date;
  },
  ctx: AuditContext,
) {
  const offerCode = await generateOfferCode(tenantId);

  const offer = await db.offer.create({
    data: {
      tenantId,
      offerCode,
      applicationId: data.applicationId,
      position: data.position,
      departmentId: data.departmentId,
      reportingToId: data.reportingToId,
      jobType: data.jobType as JobType,
      workMode: data.workMode as WorkMode,
      location: data.location,
      baseSalary: data.baseSalary,
      allowances: data.allowances as Prisma.InputJsonValue,
      bonus: data.bonus,
      benefits: data.benefits,
      startDate: data.startDate,
      probationMonths: data.probationMonths || 2,
      expiresAt: data.expiresAt,
      status: "DRAFT",
    },
    include: {
      application: { include: { candidate: true } },
      department: true,
    },
  });

  await audit.create(
    ctx,
    "Offer",
    offer.id,
    `${offer.offerCode} - ${offer.position}`,
  );

  return offer;
}

export async function getOffers(
  tenantId: string,
  filters?: {
    status?: string;
    applicationId?: string;
    departmentId?: string;
  },
  page = 1,
  limit = 20,
) {
  const where: Record<string, unknown> = { tenantId };

  if (filters?.status) where.status = filters.status;
  if (filters?.applicationId) where.applicationId = filters.applicationId;
  if (filters?.departmentId) where.departmentId = filters.departmentId;

  const [offers, total] = await Promise.all([
    db.offer.findMany({
      where,
      include: {
        application: {
          include: {
            candidate: true,
            requisition: { select: { id: true, title: true } },
          },
        },
        department: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.offer.count({ where }),
  ]);

  return { offers, total, page, limit };
}

export async function getOfferById(id: string, tenantId: string) {
  return db.offer.findFirst({
    where: { id, tenantId },
    include: {
      application: {
        include: {
          candidate: true,
          requisition: { include: { department: true } },
        },
      },
      department: true,
      reportingTo: { select: { id: true, fullName: true } },
      sentBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
    },
  });
}

export async function approveOffer(
  id: string,
  tenantId: string,
  userId: string,
  ctx: AuditContext,
) {
  const offer = await db.offer.findFirst({
    where: { id, tenantId, status: "PENDING_APPROVAL" },
  });

  if (!offer) return null;

  const updated = await db.offer.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedById: userId,
      approvedAt: new Date(),
    },
  });

  await audit.approve(ctx, "Offer", id, offer.offerCode);

  return updated;
}

export async function sendOffer(
  id: string,
  tenantId: string,
  userId: string,
  ctx: AuditContext,
) {
  const offer = await db.offer.findFirst({
    where: { id, tenantId, status: "APPROVED" },
    include: {
      application: { include: { candidate: true } },
      department: true,
    },
  });

  if (!offer) return null;

  const updated = await db.offer.update({
    where: { id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      sentById: userId,
    },
  });

  await db.application.update({
    where: { id: offer.applicationId },
    data: { status: "OFFER" },
  });

  try {
    await emailService.queueEmail(
      tenantId,
      offer.application.candidate.email,
      "offer_letter",
      {
        candidateName: offer.application.candidate.fullName,
        position: offer.position,
        department: offer.department.name,
        baseSalary: new Intl.NumberFormat("vi-VN").format(
          Number(offer.baseSalary),
        ),
        startDate: offer.startDate.toLocaleDateString("vi-VN"),
        expiresAt: offer.expiresAt.toLocaleDateString("vi-VN"),
      },
    );
  } catch (e) {
    console.error("Failed to queue offer email:", e);
  }

  await db.applicationActivity.create({
    data: {
      applicationId: offer.applicationId,
      action: "offer_sent",
      description: `Đã gửi offer letter (${offer.offerCode})`,
      performedById: userId,
    },
  });

  await audit.update(ctx, "Offer", id, {
    status: { old: "APPROVED", new: "SENT" },
  });

  return updated;
}

export async function respondToOffer(
  id: string,
  tenantId: string,
  accepted: boolean,
  note?: string,
) {
  const offer = await db.offer.findFirst({
    where: { id, tenantId, status: "SENT" },
  });

  if (!offer) return null;

  const newStatus = accepted ? "ACCEPTED" : "DECLINED";

  const updated = await db.offer.update({
    where: { id },
    data: {
      status: newStatus,
      respondedAt: new Date(),
      responseNote: note,
    },
  });

  if (accepted) {
    await db.application.update({
      where: { id: offer.applicationId },
      data: { status: "HIRED", hiredAt: new Date() },
    });

    const application = await db.application.findUnique({
      where: { id: offer.applicationId },
    });

    if (application) {
      await db.jobRequisition.update({
        where: { id: application.requisitionId },
        data: { filledCount: { increment: 1 } },
      });
    }
  }

  await db.applicationActivity.create({
    data: {
      applicationId: offer.applicationId,
      action: accepted ? "offer_accepted" : "offer_declined",
      description: accepted
        ? "Ứng viên đã chấp nhận offer"
        : "Ứng viên đã từ chối offer",
    },
  });

  return updated;
}
