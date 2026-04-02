import { db } from "@/lib/db";
import type { JobType, WorkMode } from ".prisma/hrm-unified-client";
import { audit, generateUniqueSlug } from "@/lib/recruitment/utils";
import type { AuditContext } from "@/types/audit";

export async function createJobPosting(
  tenantId: string,
  data: {
    requisitionId: string;
    title: string;
    description: string;
    requirements: string;
    benefits?: string;
    location?: string;
    jobType?: string;
    workMode?: string;
    salaryDisplay?: string;
    isInternal?: boolean;
    isPublic?: boolean;
    expiresAt?: Date;
  },
  ctx: AuditContext,
) {
  const slug = await generateUniqueSlug(tenantId, data.title);

  const posting = await db.jobPosting.create({
    data: {
      tenantId,
      requisitionId: data.requisitionId,
      title: data.title,
      slug,
      description: data.description,
      requirements: data.requirements,
      benefits: data.benefits,
      location: data.location,
      jobType: (data.jobType as JobType) || "FULL_TIME",
      workMode: (data.workMode as WorkMode) || "ONSITE",
      salaryDisplay: data.salaryDisplay,
      isInternal: data.isInternal || false,
      isPublic: data.isPublic ?? true,
      expiresAt: data.expiresAt,
      status: "DRAFT",
    },
    include: {
      requisition: { include: { department: true } },
    },
  });

  await audit.create(ctx, "JobPosting", posting.id, posting.title);

  return posting;
}

export async function getJobPostings(
  tenantId: string,
  filters?: {
    status?: string;
    isPublic?: boolean;
    search?: string;
  },
  page = 1,
  limit = 20,
) {
  const where: Record<string, unknown> = { tenantId };

  if (filters?.status) where.status = filters.status;
  if (filters?.isPublic !== undefined) where.isPublic = filters.isPublic;
  if (filters?.search) {
    where.title = { contains: filters.search, mode: "insensitive" };
  }

  const [postings, total] = await Promise.all([
    db.jobPosting.findMany({
      where,
      include: {
        requisition: { include: { department: true } },
        _count: { select: { applications: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.jobPosting.count({ where }),
  ]);

  return { postings, total, page, limit };
}

export async function getJobPostingById(id: string, tenantId: string) {
  return db.jobPosting.findFirst({
    where: { id, tenantId },
    include: {
      requisition: { include: { department: true } },
      applications: {
        include: { candidate: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
}

export async function updateJobPosting(
  id: string,
  tenantId: string,
  data: Record<string, unknown>,
  ctx: AuditContext,
) {
  const existing = await db.jobPosting.findFirst({
    where: { id, tenantId },
  });

  if (!existing) return null;

  const updated = await db.jobPosting.update({
    where: { id },
    data,
    include: { requisition: { include: { department: true } } },
  });

  await audit.update(ctx, "JobPosting", id, data, existing.title);

  return updated;
}

export async function publishJobPosting(
  id: string,
  tenantId: string,
  ctx: AuditContext,
) {
  const posting = await db.jobPosting.findFirst({
    where: { id, tenantId, status: "DRAFT" },
  });

  if (!posting) return null;

  const updated = await db.jobPosting.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });

  // Also open the requisition if it's approved
  await db.jobRequisition.updateMany({
    where: { id: posting.requisitionId, status: "APPROVED" },
    data: { status: "OPEN" },
  });

  await audit.update(
    ctx,
    "JobPosting",
    id,
    { status: { old: "DRAFT", new: "PUBLISHED" } },
    posting.title,
  );

  return updated;
}

export async function closeJobPosting(
  id: string,
  tenantId: string,
  ctx: AuditContext,
) {
  const posting = await db.jobPosting.findFirst({
    where: { id, tenantId, status: "PUBLISHED" },
  });

  if (!posting) return null;

  const updated = await db.jobPosting.update({
    where: { id },
    data: { status: "CLOSED" },
  });

  await audit.update(
    ctx,
    "JobPosting",
    id,
    { status: { old: "PUBLISHED", new: "CLOSED" } },
    posting.title,
  );

  return updated;
}
