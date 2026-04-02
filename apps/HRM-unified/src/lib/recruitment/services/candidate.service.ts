// src/lib/recruitment/services/candidate.service.ts
// Candidate Service - Manage candidate pool and talent database

import { db } from "@/lib/db";
import { ApplicationSource, Prisma } from ".prisma/hrm-unified-client";

// Types
export interface CreateCandidateInput {
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
  education?: Education[];
  workHistory?: WorkHistory[];
  notes?: string;
  tags?: string[];
  source?: ApplicationSource;
  referredById?: string;
}

export interface Education {
  school: string;
  degree: string;
  field: string;
  startYear: number;
  endYear?: number;
  gpa?: number;
}

export interface WorkHistory {
  company: string;
  position: string;
  startDate: string;
  endDate?: string;
  description?: string;
  isCurrent?: boolean;
}

export interface UpdateCandidateInput extends Partial<CreateCandidateInput> {
  isBlacklisted?: boolean;
  blacklistReason?: string;
}

export interface CandidateFilters {
  search?: string;
  source?: ApplicationSource[];
  skills?: string[];
  minExperience?: number;
  maxExperience?: number;
  isBlacklisted?: boolean;
  hasActiveApplication?: boolean;
  tags?: string[];
}

export class CandidateService {
  constructor(private tenantId: string) {}

  /**
   * Create or update a candidate
   */
  async upsert(input: CreateCandidateInput) {
    // Check if candidate already exists by email
    const existing = await db.candidate.findUnique({
      where: {
        tenantId_email: {
          tenantId: this.tenantId,
          email: input.email,
        },
      },
    });

    if (existing) {
      // Update existing candidate
      return this.update(existing.id, input);
    }

    // Create new candidate
    return db.candidate.create({
      data: {
        tenantId: this.tenantId,
        email: input.email,
        fullName: input.fullName,
        phone: input.phone,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        address: input.address,
        cvUrl: input.cvUrl,
        cvFileName: input.cvFileName,
        portfolioUrl: input.portfolioUrl,
        linkedinUrl: input.linkedinUrl,
        currentCompany: input.currentCompany,
        currentPosition: input.currentPosition,
        currentSalary: input.currentSalary,
        expectedSalary: input.expectedSalary,
        yearsOfExperience: input.yearsOfExperience,
        skills: (input.skills || []) as unknown as Prisma.InputJsonValue,
        education: (input.education || []) as unknown as Prisma.InputJsonValue,
        workHistory: (input.workHistory ||
          []) as unknown as Prisma.InputJsonValue,
        notes: input.notes,
        tags: input.tags || [],
        source: input.source || ApplicationSource.CAREERS_PAGE,
        referredById: input.referredById,
      },
    });
  }

  /**
   * Get candidate by ID
   */
  async getById(id: string) {
    const candidate = await db.candidate.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        referredBy: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
          },
        },
        applications: {
          orderBy: { createdAt: "desc" },
          include: {
            requisition: {
              select: {
                id: true,
                title: true,
                requisitionCode: true,
                department: { select: { id: true, name: true } },
              },
            },
            interviews: {
              orderBy: { scheduledAt: "desc" },
              take: 5,
            },
            evaluations: {
              orderBy: { createdAt: "desc" },
              take: 5,
            },
            offers: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    if (!candidate) {
      throw new Error("Candidate not found");
    }

    return candidate;
  }

  /**
   * Get candidate by email
   */
  async getByEmail(email: string) {
    return db.candidate.findUnique({
      where: {
        tenantId_email: {
          tenantId: this.tenantId,
          email,
        },
      },
    });
  }

  /**
   * List candidates with filters
   */
  async list(
    filters: CandidateFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.CandidateWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.search) {
      where.OR = [
        { fullName: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
        { phone: { contains: filters.search, mode: "insensitive" } },
        { currentCompany: { contains: filters.search, mode: "insensitive" } },
        { currentPosition: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    if (filters.source?.length) {
      where.source = { in: filters.source };
    }

    if (filters.isBlacklisted !== undefined) {
      where.isBlacklisted = filters.isBlacklisted;
    }

    if (filters.minExperience !== undefined) {
      where.yearsOfExperience = { gte: filters.minExperience };
    }

    if (filters.maxExperience !== undefined) {
      where.yearsOfExperience = {
        ...((where.yearsOfExperience as object) || {}),
        lte: filters.maxExperience,
      };
    }

    // Note: Skills and tags filtering requires post-query filtering for JSON fields
    // This will be done after fetching candidates if filters are specified

    if (filters.hasActiveApplication) {
      where.applications = {
        some: {
          status: { notIn: ["HIRED", "REJECTED", "WITHDRAWN"] },
        },
      };
    }

    const [candidates, total] = await Promise.all([
      db.candidate.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
        include: {
          _count: {
            select: { applications: true },
          },
          applications: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: {
              status: true,
              createdAt: true,
              requisition: {
                select: { title: true },
              },
            },
          },
        },
      }),
      db.candidate.count({ where }),
    ]);

    return {
      data: candidates.map((c) => ({
        ...c,
        latestApplication: c.applications[0] || null,
        applications: undefined,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Update a candidate
   */
  async update(id: string, input: UpdateCandidateInput) {
    const candidate = await db.candidate.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!candidate) {
      throw new Error("Candidate not found");
    }

    return db.candidate.update({
      where: { id },
      data: {
        fullName: input.fullName,
        phone: input.phone,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        address: input.address,
        cvUrl: input.cvUrl,
        cvFileName: input.cvFileName,
        portfolioUrl: input.portfolioUrl,
        linkedinUrl: input.linkedinUrl,
        currentCompany: input.currentCompany,
        currentPosition: input.currentPosition,
        currentSalary: input.currentSalary,
        expectedSalary: input.expectedSalary,
        yearsOfExperience: input.yearsOfExperience,
        skills: input.skills as unknown as Prisma.InputJsonValue,
        education: input.education as unknown as Prisma.InputJsonValue,
        workHistory: input.workHistory as unknown as Prisma.InputJsonValue,
        notes: input.notes,
        tags: input.tags as unknown as Prisma.InputJsonValue,
        source: input.source,
        referredById: input.referredById,
        isBlacklisted: input.isBlacklisted,
        blacklistReason: input.blacklistReason,
      },
    });
  }

  /**
   * Add tags to candidate
   */
  async addTags(id: string, tags: string[]) {
    const candidate = await db.candidate.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!candidate) {
      throw new Error("Candidate not found");
    }

    const existingTags = (candidate.tags as string[]) || [];
    const newTags = Array.from(new Set([...existingTags, ...tags]));

    return db.candidate.update({
      where: { id },
      data: { tags: newTags },
    });
  }

  /**
   * Remove tags from candidate
   */
  async removeTags(id: string, tags: string[]) {
    const candidate = await db.candidate.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!candidate) {
      throw new Error("Candidate not found");
    }

    const existingTags = (candidate.tags as string[]) || [];
    const newTags = existingTags.filter((t) => !tags.includes(t));

    return db.candidate.update({
      where: { id },
      data: { tags: newTags },
    });
  }

  /**
   * Blacklist a candidate
   */
  async blacklist(id: string, reason: string) {
    const candidate = await db.candidate.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!candidate) {
      throw new Error("Candidate not found");
    }

    return db.candidate.update({
      where: { id },
      data: {
        isBlacklisted: true,
        blacklistReason: reason,
      },
    });
  }

  /**
   * Remove from blacklist
   */
  async unblacklist(id: string) {
    const candidate = await db.candidate.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!candidate) {
      throw new Error("Candidate not found");
    }

    return db.candidate.update({
      where: { id },
      data: {
        isBlacklisted: false,
        blacklistReason: null,
      },
    });
  }

  /**
   * Merge duplicate candidates
   */
  async merge(primaryId: string, duplicateId: string) {
    const [primary, duplicate] = await Promise.all([
      db.candidate.findFirst({
        where: { id: primaryId, tenantId: this.tenantId },
      }),
      db.candidate.findFirst({
        where: { id: duplicateId, tenantId: this.tenantId },
      }),
    ]);

    if (!primary || !duplicate) {
      throw new Error("Candidates not found");
    }

    // Move all applications to primary
    await db.application.updateMany({
      where: { candidateId: duplicateId },
      data: { candidateId: primaryId },
    });

    // Merge tags and skills
    const mergedTags = Array.from(
      new Set([
        ...((primary.tags as string[]) || []),
        ...((duplicate.tags as string[]) || []),
      ]),
    );
    const mergedSkills = Array.from(
      new Set([
        ...((primary.skills as string[]) || []),
        ...((duplicate.skills as string[]) || []),
      ]),
    );

    // Update primary with merged data
    await db.candidate.update({
      where: { id: primaryId },
      data: {
        tags: mergedTags,
        skills: mergedSkills,
        // Fill in missing data from duplicate
        phone: primary.phone || duplicate.phone,
        cvUrl: primary.cvUrl || duplicate.cvUrl,
        cvFileName: primary.cvFileName || duplicate.cvFileName,
        linkedinUrl: primary.linkedinUrl || duplicate.linkedinUrl,
        portfolioUrl: primary.portfolioUrl || duplicate.portfolioUrl,
        notes: primary.notes
          ? `${primary.notes}\n\n--- Merged from ${duplicate.email} ---\n${duplicate.notes || ""}`
          : duplicate.notes,
      },
    });

    // Delete duplicate
    await db.candidate.delete({ where: { id: duplicateId } });

    return db.candidate.findUnique({ where: { id: primaryId } });
  }

  /**
   * Search candidates by skills
   */
  async searchBySkills(skills: string[], minMatch: number = 1) {
    const candidates = await db.candidate.findMany({
      where: {
        tenantId: this.tenantId,
        isBlacklisted: false,
      },
      include: {
        _count: { select: { applications: true } },
      },
    });

    // Calculate match score
    return candidates
      .map((c) => {
        const candidateSkills = (c.skills as string[]) || [];
        const matchedSkills = skills.filter((s) =>
          candidateSkills.some((cs) => cs.toLowerCase() === s.toLowerCase()),
        );
        return {
          ...c,
          matchedSkills,
          matchScore: matchedSkills.length,
        };
      })
      .filter((c) => c.matchScore >= minMatch)
      .sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * Get candidate statistics
   */
  async getStats() {
    const [total, bySource, recentCandidates] = await Promise.all([
      db.candidate.count({ where: { tenantId: this.tenantId } }),

      db.candidate.groupBy({
        by: ["source"],
        where: { tenantId: this.tenantId },
        _count: true,
      }),

      db.candidate.count({
        where: {
          tenantId: this.tenantId,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return {
      total,
      bySource: bySource.map((s) => ({
        source: s.source,
        count: s._count,
      })),
      recentCandidates,
      blacklisted: await db.candidate.count({
        where: { tenantId: this.tenantId, isBlacklisted: true },
      }),
    };
  }

  /**
   * Get all unique tags used
   */
  async getAllTags() {
    const candidates = await db.candidate.findMany({
      where: { tenantId: this.tenantId },
      select: { tags: true },
    });

    const allTags = candidates.flatMap((c) => (c.tags as string[]) || []);
    return Array.from(new Set(allTags)).sort();
  }

  /**
   * Get all unique skills used
   */
  async getAllSkills() {
    const candidates = await db.candidate.findMany({
      where: { tenantId: this.tenantId },
      select: { skills: true },
    });

    const allSkills = candidates.flatMap((c) => (c.skills as string[]) || []);
    return Array.from(new Set(allSkills)).sort();
  }
}

// Factory function
export function createCandidateService(tenantId: string): CandidateService {
  return new CandidateService(tenantId);
}
