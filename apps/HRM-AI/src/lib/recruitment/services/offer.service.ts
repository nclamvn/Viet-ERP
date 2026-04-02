// src/lib/recruitment/services/offer.service.ts
// Offer Service - Manage job offers and acceptance workflow

import { db } from "@/lib/db";
import {
  OfferStatus,
  ApplicationStatus,
  JobType,
  WorkMode,
  Prisma,
} from ".prisma/hrm-ai-client";

// Types
export interface CreateOfferInput {
  applicationId: string;
  position: string;
  departmentId: string;
  reportingToId?: string;
  jobType: JobType;
  workMode: WorkMode;
  location?: string;
  baseSalary: number;
  allowances?: Record<string, number>;
  bonus?: string;
  benefits?: string;
  startDate: Date;
  probationMonths?: number;
  expiresAt: Date;
}

export interface UpdateOfferInput extends Partial<
  Omit<CreateOfferInput, "applicationId">
> {
  status?: OfferStatus;
}

export interface OfferFilters {
  status?: OfferStatus[];
  applicationId?: string;
  departmentId?: string;
  fromDate?: Date;
  toDate?: Date;
}

// Helper to generate offer code
async function generateOfferCode(tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `OFF-${year}-`;

  const lastOffer = await db.offer.findFirst({
    where: { offerCode: { startsWith: prefix } },
    orderBy: { offerCode: "desc" },
  });

  let nextNumber = 1;
  if (lastOffer) {
    const lastNumber = parseInt(lastOffer.offerCode.replace(prefix, ""), 10);
    nextNumber = lastNumber + 1;
  }

  return `${prefix}${nextNumber.toString().padStart(4, "0")}`;
}

export class OfferService {
  constructor(private tenantId: string) {}

  /**
   * Create a new offer
   */
  async create(input: CreateOfferInput) {
    // Verify application exists and is in valid status
    const application = await db.application.findFirst({
      where: {
        id: input.applicationId,
        tenantId: this.tenantId,
        status: {
          notIn: [
            ApplicationStatus.REJECTED,
            ApplicationStatus.WITHDRAWN,
            ApplicationStatus.HIRED,
          ],
        },
      },
      include: {
        candidate: true,
        offers: {
          where: {
            status: {
              notIn: [
                OfferStatus.DECLINED,
                OfferStatus.EXPIRED,
                OfferStatus.WITHDRAWN,
              ],
            },
          },
        },
      },
    });

    if (!application) {
      throw new Error("Application not found or not in valid status");
    }

    // Check for existing active offer
    if (application.offers.length > 0) {
      throw new Error("Application already has an active offer");
    }

    const offerCode = await generateOfferCode(this.tenantId);

    const offer = await db.offer.create({
      data: {
        tenantId: this.tenantId,
        applicationId: input.applicationId,
        offerCode,
        position: input.position,
        departmentId: input.departmentId,
        reportingToId: input.reportingToId,
        jobType: input.jobType,
        workMode: input.workMode,
        location: input.location,
        baseSalary: input.baseSalary,
        allowances: input.allowances,
        bonus: input.bonus,
        benefits: input.benefits,
        startDate: input.startDate,
        probationMonths: input.probationMonths || 2,
        expiresAt: input.expiresAt,
        status: OfferStatus.DRAFT,
      },
      include: {
        application: {
          include: {
            candidate: {
              select: { id: true, fullName: true, email: true },
            },
          },
        },
        department: { select: { id: true, name: true } },
        reportingTo: { select: { id: true, fullName: true } },
      },
    });

    // Create activity
    await db.applicationActivity.create({
      data: {
        applicationId: input.applicationId,
        action: "OFFER_CREATED",
        description: `Offer created: ${input.position}`,
      },
    });

    return offer;
  }

  /**
   * Get offer by ID
   */
  async getById(id: string) {
    const offer = await db.offer.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        application: {
          include: {
            candidate: true,
            requisition: {
              select: {
                id: true,
                title: true,
                requisitionCode: true,
              },
            },
          },
        },
        department: { select: { id: true, name: true } },
        reportingTo: { select: { id: true, fullName: true, avatar: true } },
        sentBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    if (!offer) {
      throw new Error("Offer not found");
    }

    return offer;
  }

  /**
   * List offers with filters
   */
  async list(
    filters: OfferFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.OfferWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    if (filters.applicationId) {
      where.applicationId = filters.applicationId;
    }

    if (filters.departmentId) {
      where.departmentId = filters.departmentId;
    }

    if (filters.fromDate) {
      where.createdAt = { gte: filters.fromDate };
    }

    if (filters.toDate) {
      where.createdAt = {
        ...((where.createdAt as object) || {}),
        lte: filters.toDate,
      };
    }

    const [offers, total] = await Promise.all([
      db.offer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          application: {
            include: {
              candidate: {
                select: { id: true, fullName: true, email: true },
              },
            },
          },
          department: { select: { id: true, name: true } },
        },
      }),
      db.offer.count({ where }),
    ]);

    return {
      data: offers,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Update an offer
   */
  async update(id: string, input: UpdateOfferInput) {
    const offer = await db.offer.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!offer) {
      throw new Error("Offer not found");
    }

    // Only allow editing in DRAFT status
    if (offer.status !== OfferStatus.DRAFT && !input.status) {
      throw new Error("Can only edit offers in draft status");
    }

    return db.offer.update({
      where: { id },
      data: {
        position: input.position,
        departmentId: input.departmentId,
        reportingToId: input.reportingToId,
        jobType: input.jobType,
        workMode: input.workMode,
        location: input.location,
        baseSalary:
          input.baseSalary !== undefined ? input.baseSalary : undefined,
        allowances: input.allowances,
        bonus: input.bonus,
        benefits: input.benefits,
        startDate: input.startDate,
        probationMonths: input.probationMonths,
        expiresAt: input.expiresAt,
        status: input.status,
      },
      include: {
        application: {
          include: {
            candidate: {
              select: { id: true, fullName: true, email: true },
            },
          },
        },
        department: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Submit offer for approval
   */
  async submitForApproval(id: string) {
    const offer = await db.offer.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!offer) {
      throw new Error("Offer not found");
    }

    if (offer.status !== OfferStatus.DRAFT) {
      throw new Error("Only draft offers can be submitted for approval");
    }

    return db.offer.update({
      where: { id },
      data: { status: OfferStatus.PENDING_APPROVAL },
    });
  }

  /**
   * Approve an offer
   */
  async approve(id: string, approvedById: string) {
    const offer = await db.offer.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!offer) {
      throw new Error("Offer not found");
    }

    if (offer.status !== OfferStatus.PENDING_APPROVAL) {
      throw new Error("Only pending offers can be approved");
    }

    const updated = await db.offer.update({
      where: { id },
      data: {
        status: OfferStatus.APPROVED,
        approvedById,
        approvedAt: new Date(),
      },
    });

    await db.applicationActivity.create({
      data: {
        applicationId: offer.applicationId,
        action: "OFFER_APPROVED",
        description: "Offer approved",
        performedById: approvedById,
      },
    });

    return updated;
  }

  /**
   * Send offer to candidate
   */
  async send(id: string, sentById: string) {
    const offer = await db.offer.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!offer) {
      throw new Error("Offer not found");
    }

    if (offer.status !== OfferStatus.APPROVED) {
      throw new Error("Only approved offers can be sent");
    }

    // Check if offer has expired
    if (offer.expiresAt < new Date()) {
      throw new Error("Offer has expired, please update the expiry date");
    }

    const updated = await db.offer.update({
      where: { id },
      data: {
        status: OfferStatus.SENT,
        sentAt: new Date(),
        sentById,
      },
    });

    // Update application status to OFFER
    await db.application.update({
      where: { id: offer.applicationId },
      data: { status: ApplicationStatus.OFFER, stage: 6 },
    });

    await db.applicationActivity.create({
      data: {
        applicationId: offer.applicationId,
        action: "OFFER_SENT",
        description: "Offer sent to candidate",
        performedById: sentById,
      },
    });

    return updated;
  }

  /**
   * Record offer acceptance
   */
  async accept(id: string, responseNote?: string) {
    const offer = await db.offer.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!offer) {
      throw new Error("Offer not found");
    }

    if (offer.status !== OfferStatus.SENT) {
      throw new Error("Only sent offers can be accepted");
    }

    // Check if offer has expired
    if (offer.expiresAt < new Date()) {
      await this.expire(id);
      throw new Error("Offer has expired");
    }

    const updated = await db.offer.update({
      where: { id },
      data: {
        status: OfferStatus.ACCEPTED,
        respondedAt: new Date(),
        responseNote,
      },
    });

    await db.applicationActivity.create({
      data: {
        applicationId: offer.applicationId,
        action: "OFFER_ACCEPTED",
        description: "Candidate accepted the offer",
      },
    });

    return updated;
  }

  /**
   * Record offer decline
   */
  async decline(id: string, reason?: string) {
    const offer = await db.offer.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!offer) {
      throw new Error("Offer not found");
    }

    if (offer.status !== OfferStatus.SENT) {
      throw new Error("Only sent offers can be declined");
    }

    const updated = await db.offer.update({
      where: { id },
      data: {
        status: OfferStatus.DECLINED,
        respondedAt: new Date(),
        responseNote: reason,
      },
    });

    await db.applicationActivity.create({
      data: {
        applicationId: offer.applicationId,
        action: "OFFER_DECLINED",
        description: `Candidate declined the offer${reason ? `: ${reason}` : ""}`,
      },
    });

    return updated;
  }

  /**
   * Withdraw an offer
   */
  async withdraw(id: string, reason: string, withdrawnById: string) {
    const offer = await db.offer.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!offer) {
      throw new Error("Offer not found");
    }

    const terminalStatuses = [
      OfferStatus.ACCEPTED,
      OfferStatus.DECLINED,
      OfferStatus.EXPIRED,
    ];
    if (terminalStatuses.some((s) => s === offer.status)) {
      throw new Error("Cannot withdraw offer in current status");
    }

    const updated = await db.offer.update({
      where: { id },
      data: {
        status: OfferStatus.WITHDRAWN,
        responseNote: `Withdrawn: ${reason}`,
      },
    });

    await db.applicationActivity.create({
      data: {
        applicationId: offer.applicationId,
        action: "OFFER_WITHDRAWN",
        description: `Offer withdrawn: ${reason}`,
        performedById: withdrawnById,
      },
    });

    return updated;
  }

  /**
   * Expire an offer
   */
  async expire(id: string) {
    const offer = await db.offer.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!offer) {
      throw new Error("Offer not found");
    }

    if (offer.status !== OfferStatus.SENT) {
      throw new Error("Only sent offers can expire");
    }

    const updated = await db.offer.update({
      where: { id },
      data: { status: OfferStatus.EXPIRED },
    });

    await db.applicationActivity.create({
      data: {
        applicationId: offer.applicationId,
        action: "OFFER_EXPIRED",
        description: "Offer expired",
      },
    });

    return updated;
  }

  /**
   * Check for expired offers (for scheduled job)
   */
  async checkExpiredOffers() {
    const expiredOffers = await db.offer.findMany({
      where: {
        tenantId: this.tenantId,
        status: OfferStatus.SENT,
        expiresAt: { lt: new Date() },
      },
    });

    for (const offer of expiredOffers) {
      await this.expire(offer.id);
    }

    return expiredOffers.length;
  }

  /**
   * Extend offer expiry
   */
  async extendExpiry(id: string, newExpiresAt: Date) {
    const offer = await db.offer.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!offer) {
      throw new Error("Offer not found");
    }

    if (
      offer.status !== OfferStatus.SENT &&
      offer.status !== OfferStatus.EXPIRED
    ) {
      throw new Error("Can only extend sent or expired offers");
    }

    const updated = await db.offer.update({
      where: { id },
      data: {
        expiresAt: newExpiresAt,
        status: OfferStatus.SENT, // Reactivate if expired
      },
    });

    await db.applicationActivity.create({
      data: {
        applicationId: offer.applicationId,
        action: "OFFER_EXTENDED",
        description: `Offer expiry extended to ${newExpiresAt.toISOString()}`,
        oldValue: offer.expiresAt.toISOString(),
        newValue: newExpiresAt.toISOString(),
      },
    });

    return updated;
  }

  /**
   * Clone offer for counter-offer
   */
  async clone(id: string, adjustments?: Partial<CreateOfferInput>) {
    const original = await db.offer.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!original) {
      throw new Error("Offer not found");
    }

    const newOfferCode = await generateOfferCode(this.tenantId);

    const cloned = await db.offer.create({
      data: {
        tenantId: this.tenantId,
        applicationId: original.applicationId,
        offerCode: newOfferCode,
        position: adjustments?.position || original.position,
        departmentId: adjustments?.departmentId || original.departmentId,
        reportingToId: adjustments?.reportingToId || original.reportingToId,
        jobType: adjustments?.jobType || original.jobType,
        workMode: adjustments?.workMode || original.workMode,
        location: adjustments?.location || original.location,
        baseSalary: adjustments?.baseSalary
          ? adjustments.baseSalary
          : original.baseSalary,
        allowances: (adjustments?.allowances ||
          original.allowances) as Prisma.InputJsonValue,
        bonus: adjustments?.bonus || original.bonus,
        benefits: adjustments?.benefits || original.benefits,
        startDate: adjustments?.startDate || original.startDate,
        probationMonths:
          adjustments?.probationMonths || original.probationMonths,
        expiresAt:
          adjustments?.expiresAt ||
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: OfferStatus.DRAFT,
      },
    });

    return cloned;
  }

  /**
   * Get offer statistics
   */
  async getStats(dateRange?: { from: Date; to: Date }) {
    const where: Prisma.OfferWhereInput = {
      tenantId: this.tenantId,
    };

    if (dateRange) {
      where.createdAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    const [byStatus, avgSalary, acceptanceRate] = await Promise.all([
      db.offer.groupBy({
        by: ["status"],
        where,
        _count: true,
      }),

      db.offer.aggregate({
        where: {
          ...where,
          status: OfferStatus.ACCEPTED,
        },
        _avg: { baseSalary: true },
        _min: { baseSalary: true },
        _max: { baseSalary: true },
      }),

      // Calculate acceptance rate
      Promise.all([
        db.offer.count({ where: { ...where, status: OfferStatus.ACCEPTED } }),
        db.offer.count({
          where: {
            ...where,
            status: { in: [OfferStatus.ACCEPTED, OfferStatus.DECLINED] },
          },
        }),
      ]),
    ]);

    const [accepted, responded] = acceptanceRate;
    const rate = responded > 0 ? Math.round((accepted / responded) * 100) : 0;

    return {
      byStatus: byStatus.map((s) => ({
        status: s.status,
        count: s._count,
      })),
      salaryStats: {
        average: avgSalary._avg.baseSalary
          ? Number(avgSalary._avg.baseSalary)
          : 0,
        min: avgSalary._min.baseSalary ? Number(avgSalary._min.baseSalary) : 0,
        max: avgSalary._max.baseSalary ? Number(avgSalary._max.baseSalary) : 0,
      },
      acceptanceRate: rate,
      pending: byStatus.find((s) => s.status === OfferStatus.SENT)?._count || 0,
    };
  }
}

// Factory function
export function createOfferService(tenantId: string): OfferService {
  return new OfferService(tenantId);
}
