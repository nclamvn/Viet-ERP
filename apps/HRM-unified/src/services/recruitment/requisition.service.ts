import { db } from "@/lib/db";
import type { JobType, WorkMode } from ".prisma/hrm-unified-client";
import { audit } from "@/lib/recruitment/utils";
import type { AuditContext } from "@/types/audit";

export async function generateRequisitionCode(
  tenantId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.jobRequisition.count({
    where: {
      tenantId,
      createdAt: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1),
      },
    },
  });
  return `REQ-${year}-${String(count + 1).padStart(4, "0")}`;
}

export async function createRequisition(
  tenantId: string,
  userId: string,
  data: {
    title: string;
    departmentId: string;
    reportingToId?: string;
    jobType?: string;
    workMode?: string;
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
  },
  ctx: AuditContext,
) {
  const requisitionCode = await generateRequisitionCode(tenantId);

  const requisition = await db.jobRequisition.create({
    data: {
      tenantId,
      requisitionCode,
      title: data.title,
      departmentId: data.departmentId,
      reportingToId: data.reportingToId,
      jobType: (data.jobType as JobType) || "FULL_TIME",
      workMode: (data.workMode as WorkMode) || "ONSITE",
      location: data.location,
      headcount: data.headcount || 1,
      salaryMin: data.salaryMin,
      salaryMax: data.salaryMax,
      salaryDisplay: data.salaryDisplay,
      description: data.description,
      requirements: data.requirements,
      benefits: data.benefits,
      priority: data.priority || "NORMAL",
      targetHireDate: data.targetHireDate,
      requestedById: userId,
      status: "DRAFT",
    },
    include: {
      department: true,
      requestedBy: { select: { id: true, name: true } },
    },
  });

  await audit.create(ctx, "JobRequisition", requisition.id, requisition.title);

  return requisition;
}

export async function getRequisitions(
  tenantId: string,
  filters?: {
    status?: string;
    departmentId?: string;
    priority?: string;
    search?: string;
  },
  page = 1,
  limit = 20,
) {
  const where: Record<string, unknown> = { tenantId };

  if (filters?.status) where.status = filters.status;
  if (filters?.departmentId) where.departmentId = filters.departmentId;
  if (filters?.priority) where.priority = filters.priority;
  if (filters?.search) {
    where.OR = [
      { title: { contains: filters.search, mode: "insensitive" } },
      { requisitionCode: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const [requisitions, total] = await Promise.all([
    db.jobRequisition.findMany({
      where,
      include: {
        department: true,
        reportingTo: { select: { id: true, fullName: true } },
        requestedBy: { select: { id: true, name: true } },
        _count: { select: { applications: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.jobRequisition.count({ where }),
  ]);

  return { requisitions, total, page, limit };
}

export async function getRequisitionById(id: string, tenantId: string) {
  return db.jobRequisition.findFirst({
    where: { id, tenantId },
    include: {
      department: true,
      reportingTo: { select: { id: true, fullName: true } },
      requestedBy: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true } },
      jobPostings: true,
      applications: {
        include: { candidate: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
}

export async function updateRequisition(
  id: string,
  tenantId: string,
  data: Record<string, unknown>,
  ctx: AuditContext,
) {
  const existing = await db.jobRequisition.findFirst({
    where: { id, tenantId },
  });

  if (!existing) return null;

  const updated = await db.jobRequisition.update({
    where: { id },
    data,
    include: { department: true },
  });

  await audit.update(ctx, "JobRequisition", id, data, existing.title);

  return updated;
}

export async function submitForApproval(
  id: string,
  tenantId: string,
  ctx: AuditContext,
) {
  const requisition = await db.jobRequisition.findFirst({
    where: { id, tenantId, status: "DRAFT" },
  });

  if (!requisition) return null;

  const updated = await db.jobRequisition.update({
    where: { id },
    data: { status: "PENDING_APPROVAL" },
  });

  await audit.update(
    ctx,
    "JobRequisition",
    id,
    { status: { old: "DRAFT", new: "PENDING_APPROVAL" } },
    requisition.title,
  );

  return updated;
}

export async function approveRequisition(
  id: string,
  tenantId: string,
  userId: string,
  approved: boolean,
  note?: string,
  ctx?: AuditContext,
) {
  const requisition = await db.jobRequisition.findFirst({
    where: { id, tenantId, status: "PENDING_APPROVAL" },
  });

  if (!requisition) return null;

  const newStatus = approved ? "APPROVED" : "REJECTED";

  const updated = await db.jobRequisition.update({
    where: { id },
    data: {
      status: newStatus,
      approvedById: userId,
      approvedAt: new Date(),
      approvalNote: note,
    },
  });

  if (ctx) {
    if (approved) {
      await audit.approve(ctx, "JobRequisition", id, requisition.title);
    } else {
      await audit.reject(ctx, "JobRequisition", id, requisition.title);
    }
  }

  return updated;
}

export async function openRequisition(
  id: string,
  tenantId: string,
  ctx: AuditContext,
) {
  const requisition = await db.jobRequisition.findFirst({
    where: { id, tenantId, status: "APPROVED" },
  });

  if (!requisition) return null;

  const updated = await db.jobRequisition.update({
    where: { id },
    data: { status: "OPEN" },
  });

  await audit.update(
    ctx,
    "JobRequisition",
    id,
    { status: { old: "APPROVED", new: "OPEN" } },
    requisition.title,
  );

  return updated;
}
