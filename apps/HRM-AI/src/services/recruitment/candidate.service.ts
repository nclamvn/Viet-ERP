import { db } from "@/lib/db";
import { ApplicationSource, Prisma } from ".prisma/hrm-ai-client";

export async function createCandidate(
  tenantId: string,
  data: {
    email: string;
    fullName: string;
    phone?: string;
    dateOfBirth?: Date;
    gender?: string;
    address?: string;
    cvUrl?: string;
    cvFileName?: string;
    portfolioUrl?: string;
    linkedinUrl?: string;
    currentCompany?: string;
    currentPosition?: string;
    currentSalary?: number;
    expectedSalary?: number;
    yearsOfExperience?: number;
    skills?: string[];
    education?: Record<string, unknown>[];
    workHistory?: Record<string, unknown>[];
    notes?: string;
    tags?: string[];
    source?: string;
    referredById?: string;
  },
) {
  return db.candidate.create({
    data: {
      tenantId,
      email: data.email,
      fullName: data.fullName,
      phone: data.phone,
      dateOfBirth: data.dateOfBirth,
      gender: data.gender,
      address: data.address,
      cvUrl: data.cvUrl,
      cvFileName: data.cvFileName,
      portfolioUrl: data.portfolioUrl,
      linkedinUrl: data.linkedinUrl,
      currentCompany: data.currentCompany,
      currentPosition: data.currentPosition,
      currentSalary: data.currentSalary,
      expectedSalary: data.expectedSalary,
      yearsOfExperience: data.yearsOfExperience,
      skills: data.skills as Prisma.InputJsonValue,
      education: data.education as Prisma.InputJsonValue,
      workHistory: data.workHistory as Prisma.InputJsonValue,
      notes: data.notes,
      tags: data.tags as Prisma.InputJsonValue,
      source:
        (data.source as ApplicationSource) || ApplicationSource.CAREERS_PAGE,
      referredById: data.referredById,
    },
  });
}

export async function getCandidates(
  tenantId: string,
  filters?: {
    search?: string;
    source?: string;
    isBlacklisted?: boolean;
  },
  page = 1,
  limit = 20,
) {
  const where: Record<string, unknown> = { tenantId };

  if (filters?.source) where.source = filters.source;
  if (filters?.isBlacklisted !== undefined)
    where.isBlacklisted = filters.isBlacklisted;
  if (filters?.search) {
    where.OR = [
      { fullName: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
      { phone: { contains: filters.search } },
    ];
  }

  const [candidates, total] = await Promise.all([
    db.candidate.findMany({
      where,
      include: {
        _count: { select: { applications: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.candidate.count({ where }),
  ]);

  return { candidates, total, page, limit };
}

export async function getCandidateById(id: string, tenantId: string) {
  return db.candidate.findFirst({
    where: { id, tenantId },
    include: {
      applications: {
        include: {
          requisition: { select: { id: true, title: true } },
          _count: { select: { interviews: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      referredBy: { select: { id: true, fullName: true } },
    },
  });
}

export async function updateCandidate(
  id: string,
  tenantId: string,
  data: Record<string, unknown>,
) {
  const existing = await db.candidate.findFirst({
    where: { id, tenantId },
  });

  if (!existing) return null;

  return db.candidate.update({
    where: { id },
    data,
  });
}

export async function findOrCreateCandidate(
  tenantId: string,
  data: {
    email: string;
    fullName: string;
    phone?: string;
    cvUrl?: string;
    cvFileName?: string;
    expectedSalary?: number;
    yearsOfExperience?: number;
    linkedinUrl?: string;
    portfolioUrl?: string;
    source?: string;
  },
) {
  let candidate = await db.candidate.findUnique({
    where: { tenantId_email: { tenantId, email: data.email } },
  });

  if (!candidate) {
    candidate = await db.candidate.create({
      data: {
        tenantId,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        cvUrl: data.cvUrl,
        cvFileName: data.cvFileName,
        expectedSalary: data.expectedSalary,
        yearsOfExperience: data.yearsOfExperience,
        linkedinUrl: data.linkedinUrl,
        portfolioUrl: data.portfolioUrl,
        source:
          (data.source as ApplicationSource) || ApplicationSource.CAREERS_PAGE,
      },
    });
  } else {
    candidate = await db.candidate.update({
      where: { id: candidate.id },
      data: {
        fullName: data.fullName,
        phone: data.phone,
        cvUrl: data.cvUrl || candidate.cvUrl,
        cvFileName: data.cvFileName || candidate.cvFileName,
        expectedSalary: data.expectedSalary || candidate.expectedSalary,
        yearsOfExperience:
          data.yearsOfExperience || candidate.yearsOfExperience,
        linkedinUrl: data.linkedinUrl || candidate.linkedinUrl,
        portfolioUrl: data.portfolioUrl || candidate.portfolioUrl,
      },
    });
  }

  return candidate;
}
