import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';
import { DeductionQueryDto } from './dto/deduction-query.dto';
import { CreateDeductionDto } from './dto/create-deduction.dto';
import { UpdateDeductionDto } from './dto/update-deduction.dto';
import { MatchDeductionDto } from './dto/match-deduction.dto';
import { ResolveDeductionDto } from './dto/resolve-deduction.dto';
import { WriteOffDeductionDto } from './dto/write-off-deduction.dto';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { UpdateDisputeDto } from './dto/update-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateDeductionDocumentDto } from './dto/create-deduction-document.dto';
import { CreateWriteOffRuleDto } from './dto/create-write-off-rule.dto';
import { UpdateWriteOffRuleDto } from './dto/update-write-off-rule.dto';

@Injectable()
export class DeductionsService {
  private readonly logger = new Logger(DeductionsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST DEDUCTIONS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: DeductionQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      status,
      category,
      source,
      customerId,
      dateFrom,
      dateTo,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.DeductionWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (category) {
      where.category = category;
    }

    if (source) {
      where.source = source;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (dateFrom || dateTo) {
      where.deductionDate = {};
      if (dateFrom) {
        where.deductionDate.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.deductionDate.lte = new Date(dateTo);
      }
    }

    if (search) {
      where.OR = [
        { deductionNumber: { contains: search, mode: 'insensitive' } },
        { externalRef: { contains: search, mode: 'insensitive' } },
        { reasonDescription: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Build orderBy
    const validSortFields = [
      'createdAt',
      'deductionDate',
      'amount',
      'status',
      'deductionNumber',
      'daysOutstanding',
    ];
    const orderBy: Prisma.DeductionOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.deduction.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          customer: {
            select: { id: true, name: true, code: true },
          },
          matchedPromotion: {
            select: { id: true, name: true, code: true },
          },
          matchedClaim: {
            select: { id: true, code: true },
          },
          matchedBy: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { disputes: true, documents: true, comments: true },
          },
        },
      }),
      this.prisma.deduction.count({ where }),
    ]);

    const transformedData = data.map((d) => this.transformDeduction(d));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET DEDUCTION SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const deductions = await this.prisma.deduction.findMany({
      select: {
        amount: true,
        status: true,
        category: true,
      },
    });

    const totalDeductions = deductions.length;
    const totalAmount = deductions.reduce((sum, d) => sum + Number(d.amount), 0);

    // Count and sum by status
    const byStatus: Record<string, { count: number; amount: number }> = {};
    deductions.forEach((d) => {
      if (!byStatus[d.status]) {
        byStatus[d.status] = { count: 0, amount: 0 };
      }
      byStatus[d.status].count += 1;
      byStatus[d.status].amount += Number(d.amount);
    });

    // Count and sum by category
    const byCategory: Record<string, { count: number; amount: number }> = {};
    deductions.forEach((d) => {
      if (!byCategory[d.category]) {
        byCategory[d.category] = { count: 0, amount: 0 };
      }
      byCategory[d.category].count += 1;
      byCategory[d.category].amount += Number(d.amount);
    });

    return {
      totalDeductions,
      totalAmount,
      pendingCount: byStatus['PENDING']?.count || 0,
      pendingAmount: byStatus['PENDING']?.amount || 0,
      matchedCount: byStatus['MATCHED']?.count || 0,
      matchedAmount: byStatus['MATCHED']?.amount || 0,
      approvedCount: byStatus['APPROVED']?.count || 0,
      approvedAmount: byStatus['APPROVED']?.amount || 0,
      disputedCount: byStatus['DISPUTED']?.count || 0,
      disputedAmount: byStatus['DISPUTED']?.amount || 0,
      resolvedCount: byStatus['RESOLVED']?.count || 0,
      resolvedAmount: byStatus['RESOLVED']?.amount || 0,
      writtenOffCount: byStatus['WRITTEN_OFF']?.count || 0,
      writtenOffAmount: byStatus['WRITTEN_OFF']?.amount || 0,
      byStatus,
      byCategory,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET DEDUCTION AGING BREAKDOWN
  // ═══════════════════════════════════════════════════════════════════════════
  async getAging() {
    const deductions = await this.prisma.deduction.findMany({
      where: {
        status: { in: ['PENDING', 'MATCHED', 'UNDER_REVIEW', 'DISPUTED'] },
      },
      select: {
        amount: true,
        daysOutstanding: true,
      },
    });

    const aging = {
      '0-30': { count: 0, amount: 0 },
      '31-60': { count: 0, amount: 0 },
      '61-90': { count: 0, amount: 0 },
      '90+': { count: 0, amount: 0 },
    };

    deductions.forEach((d) => {
      const amt = Number(d.amount);
      if (d.daysOutstanding <= 30) {
        aging['0-30'].count += 1;
        aging['0-30'].amount += amt;
      } else if (d.daysOutstanding <= 60) {
        aging['31-60'].count += 1;
        aging['31-60'].amount += amt;
      } else if (d.daysOutstanding <= 90) {
        aging['61-90'].count += 1;
        aging['61-90'].amount += amt;
      } else {
        aging['90+'].count += 1;
        aging['90+'].amount += amt;
      }
    });

    const totalOpen = deductions.length;
    const totalOpenAmount = deductions.reduce((sum, d) => sum + Number(d.amount), 0);

    return {
      totalOpen,
      totalOpenAmount,
      aging,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE DEDUCTION (with all relations)
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const deduction = await this.prisma.deduction.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, name: true, code: true, channel: true, address: true },
        },
        company: {
          select: { id: true, name: true, code: true },
        },
        matchedPromotion: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            startDate: true,
            endDate: true,
          },
        },
        matchedClaim: {
          select: { id: true, code: true, status: true, amount: true },
        },
        matchedBy: {
          select: { id: true, name: true, email: true },
        },
        resolvedBy: {
          select: { id: true, name: true, email: true },
        },
        writeOffApprovedBy: {
          select: { id: true, name: true, email: true },
        },
        disputes: {
          orderBy: { createdAt: 'desc' },
        },
        documents: {
          include: {
            uploadedBy: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { uploadedAt: 'desc' },
        },
        comments: {
          include: {
            createdBy: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        activities: {
          include: {
            createdBy: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${id} not found`);
    }

    return this.transformDeductionDetail(deduction);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE DEDUCTION
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateDeductionDto, userId: string) {
    // Validate customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) {
      throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);
    }

    // Validate company exists
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });
    if (!company) {
      throw new BadRequestException(`Company with ID ${dto.companyId} not found`);
    }

    const deduction = await this.prisma.deduction.create({
      data: {
        companyId: dto.companyId,
        deductionNumber: dto.deductionNumber,
        externalRef: dto.externalRef,
        source: dto.source,
        sourceDocument: dto.sourceDocument,
        sourceDate: dto.sourceDate ? new Date(dto.sourceDate) : undefined,
        customerId: dto.customerId,
        amount: dto.amount,
        currency: dto.currency || 'VND',
        deductionDate: new Date(dto.deductionDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        receivedDate: new Date(dto.receivedDate),
        reasonCode: dto.reasonCode,
        reasonDescription: dto.reasonDescription,
        category: dto.category || 'TRADE_PROMOTION',
        status: 'PENDING',
        daysOutstanding: 0,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        company: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    // Create activity log
    await this.createActivity(deduction.id, userId, 'CREATED', 'Deduction created');

    this.logger.log(`Deduction created: ${deduction.deductionNumber} by user ${userId}`);

    return this.transformDeduction(deduction);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE DEDUCTION (PENDING only)
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateDeductionDto, userId: string) {
    const deduction = await this.prisma.deduction.findUnique({ where: { id } });

    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${id} not found`);
    }

    if (deduction.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot update deduction in ${deduction.status} status. Only PENDING deductions can be modified.`,
      );
    }

    // Validate customer if changing
    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);
      }
    }

    const updated = await this.prisma.deduction.update({
      where: { id },
      data: {
        externalRef: dto.externalRef,
        source: dto.source,
        sourceDocument: dto.sourceDocument,
        sourceDate: dto.sourceDate ? new Date(dto.sourceDate) : undefined,
        customerId: dto.customerId,
        amount: dto.amount,
        currency: dto.currency,
        deductionDate: dto.deductionDate ? new Date(dto.deductionDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : undefined,
        reasonCode: dto.reasonCode,
        reasonDescription: dto.reasonDescription,
        category: dto.category,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    await this.createActivity(id, userId, 'UPDATED', 'Deduction updated');

    this.logger.log(`Deduction updated: ${updated.deductionNumber}`);

    return this.transformDeduction(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MATCH DEDUCTION (to promotion + claim)
  // ═══════════════════════════════════════════════════════════════════════════
  async match(id: string, dto: MatchDeductionDto, userId: string) {
    const deduction = await this.prisma.deduction.findUnique({ where: { id } });

    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${id} not found`);
    }

    if (!['PENDING', 'UNDER_REVIEW'].includes(deduction.status)) {
      throw new BadRequestException(
        `Cannot match deduction in ${deduction.status} status. Must be PENDING or UNDER_REVIEW.`,
      );
    }

    // Validate promotion exists
    const promotion = await this.prisma.promotion.findUnique({
      where: { id: dto.matchedPromotionId },
    });
    if (!promotion) {
      throw new BadRequestException(`Promotion with ID ${dto.matchedPromotionId} not found`);
    }

    // Validate claim if provided
    if (dto.matchedClaimId) {
      const claim = await this.prisma.claim.findUnique({
        where: { id: dto.matchedClaimId },
      });
      if (!claim) {
        throw new BadRequestException(`Claim with ID ${dto.matchedClaimId} not found`);
      }
    }

    const updated = await this.prisma.deduction.update({
      where: { id },
      data: {
        status: 'MATCHED',
        matchedPromotionId: dto.matchedPromotionId,
        matchedClaimId: dto.matchedClaimId,
        matchMethod: dto.matchMethod,
        matchScore: dto.matchScore,
        matchedAt: new Date(),
        matchedById: userId,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        matchedPromotion: {
          select: { id: true, name: true, code: true },
        },
        matchedClaim: {
          select: { id: true, code: true },
        },
        matchedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    await this.createActivity(id, userId, 'MATCHED', `Matched to promotion ${promotion.code}`, {
      oldValue: { status: deduction.status },
      newValue: { status: 'MATCHED', matchedPromotionId: dto.matchedPromotionId },
    });

    this.logger.log(
      `Deduction matched: ${deduction.deductionNumber} to promotion ${promotion.code}`,
    );

    return this.transformDeduction(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APPROVE DEDUCTION
  // ═══════════════════════════════════════════════════════════════════════════
  async approve(id: string, userId: string) {
    const deduction = await this.prisma.deduction.findUnique({ where: { id } });

    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${id} not found`);
    }

    if (deduction.status !== 'MATCHED') {
      throw new BadRequestException(
        `Cannot approve deduction in ${deduction.status} status. Must be MATCHED.`,
      );
    }

    const updated = await this.prisma.deduction.update({
      where: { id },
      data: {
        status: 'APPROVED',
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        matchedPromotion: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    await this.createActivity(id, userId, 'APPROVED', 'Deduction approved', {
      oldValue: { status: 'MATCHED' },
      newValue: { status: 'APPROVED' },
    });

    this.logger.log(`Deduction approved: ${deduction.deductionNumber} by user ${userId}`);

    return this.transformDeduction(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLVE DEDUCTION
  // ═══════════════════════════════════════════════════════════════════════════
  async resolve(id: string, dto: ResolveDeductionDto, userId: string) {
    const deduction = await this.prisma.deduction.findUnique({ where: { id } });

    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${id} not found`);
    }

    if (!['APPROVED', 'MATCHED', 'UNDER_REVIEW'].includes(deduction.status)) {
      throw new BadRequestException(
        `Cannot resolve deduction in ${deduction.status} status. Must be APPROVED, MATCHED, or UNDER_REVIEW.`,
      );
    }

    const varianceAmount =
      dto.varianceAmount !== undefined
        ? dto.varianceAmount
        : Number(deduction.amount) - dto.resolvedAmount;

    const updated = await this.prisma.deduction.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolutionType: dto.resolutionType,
        resolvedAmount: dto.resolvedAmount,
        varianceAmount,
        resolvedAt: new Date(),
        resolvedById: userId,
        resolutionNotes: dto.resolutionNotes,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        resolvedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    await this.createActivity(id, userId, 'RESOLVED', `Resolved as ${dto.resolutionType}`, {
      oldValue: { status: deduction.status },
      newValue: {
        status: 'RESOLVED',
        resolutionType: dto.resolutionType,
        resolvedAmount: dto.resolvedAmount,
      },
    });

    this.logger.log(`Deduction resolved: ${deduction.deductionNumber} as ${dto.resolutionType}`);

    return this.transformDeduction(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE OFF DEDUCTION
  // ═══════════════════════════════════════════════════════════════════════════
  async writeOff(id: string, dto: WriteOffDeductionDto, userId: string) {
    const deduction = await this.prisma.deduction.findUnique({ where: { id } });

    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${id} not found`);
    }

    if (['RESOLVED', 'WRITTEN_OFF'].includes(deduction.status)) {
      throw new BadRequestException(`Cannot write off deduction in ${deduction.status} status.`);
    }

    const updated = await this.prisma.deduction.update({
      where: { id },
      data: {
        status: 'WRITTEN_OFF',
        resolutionType: 'WRITE_OFF',
        resolvedAmount: deduction.amount,
        varianceAmount: 0,
        resolvedAt: new Date(),
        resolvedById: userId,
        writeOffReason: dto.writeOffReason,
        writeOffApprovedById: userId,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    await this.createActivity(id, userId, 'WRITTEN_OFF', `Written off: ${dto.writeOffReason}`, {
      oldValue: { status: deduction.status },
      newValue: { status: 'WRITTEN_OFF', writeOffReason: dto.writeOffReason },
    });

    this.logger.log(`Deduction written off: ${deduction.deductionNumber}`);

    return this.transformDeduction(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE DISPUTE
  // ═══════════════════════════════════════════════════════════════════════════
  async createDispute(deductionId: string, dto: CreateDisputeDto, userId: string) {
    const deduction = await this.prisma.deduction.findUnique({
      where: { id: deductionId },
    });

    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${deductionId} not found`);
    }

    // Generate dispute number
    const disputeNumber = await this.generateDisputeNumber();

    const dispute = await this.prisma.deductionDispute.create({
      data: {
        deductionId,
        disputeNumber,
        disputeReason: dto.disputeReason,
        disputeAmount: dto.disputeAmount,
        status: 'OPEN',
        customerContactName: dto.customerContactName,
        customerContactEmail: dto.customerContactEmail,
        createdById: userId,
      },
    });

    // Update deduction status to DISPUTED
    await this.prisma.deduction.update({
      where: { id: deductionId },
      data: {
        status: 'DISPUTED',
      },
    });

    await this.createActivity(
      deductionId,
      userId,
      'DISPUTE_CREATED',
      `Dispute ${disputeNumber} created`,
    );

    this.logger.log(`Dispute created: ${disputeNumber} for deduction ${deduction.deductionNumber}`);

    return this.transformDispute(dispute);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE DISPUTE
  // ═══════════════════════════════════════════════════════════════════════════
  async updateDispute(
    deductionId: string,
    disputeId: string,
    dto: UpdateDisputeDto,
    userId: string,
  ) {
    // Verify deduction exists
    const deduction = await this.prisma.deduction.findUnique({
      where: { id: deductionId },
    });
    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${deductionId} not found`);
    }

    const dispute = await this.prisma.deductionDispute.findFirst({
      where: { id: disputeId, deductionId },
    });

    if (!dispute) {
      throw new NotFoundException(`Dispute with ID ${disputeId} not found for this deduction`);
    }

    if (['RESOLVED', 'CLOSED'].includes(dispute.status)) {
      throw new BadRequestException(`Cannot update dispute in ${dispute.status} status.`);
    }

    const updated = await this.prisma.deductionDispute.update({
      where: { id: disputeId },
      data: {
        status: dto.status,
        customerResponse: dto.customerResponse,
        customerResponseDate: dto.customerResponseDate
          ? new Date(dto.customerResponseDate)
          : undefined,
        customerContactName: dto.customerContactName,
        customerContactEmail: dto.customerContactEmail,
      },
    });

    await this.createActivity(
      deductionId,
      userId,
      'DISPUTE_UPDATED',
      `Dispute ${dispute.disputeNumber} updated`,
    );

    this.logger.log(`Dispute updated: ${dispute.disputeNumber}`);

    return this.transformDispute(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLVE DISPUTE
  // ═══════════════════════════════════════════════════════════════════════════
  async resolveDispute(
    deductionId: string,
    disputeId: string,
    dto: ResolveDisputeDto,
    userId: string,
  ) {
    // Verify deduction exists
    const deduction = await this.prisma.deduction.findUnique({
      where: { id: deductionId },
    });
    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${deductionId} not found`);
    }

    const dispute = await this.prisma.deductionDispute.findFirst({
      where: { id: disputeId, deductionId },
    });

    if (!dispute) {
      throw new NotFoundException(`Dispute with ID ${disputeId} not found for this deduction`);
    }

    if (['RESOLVED', 'CLOSED'].includes(dispute.status)) {
      throw new BadRequestException(`Dispute is already ${dispute.status}.`);
    }

    const updated = await this.prisma.deductionDispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED',
        resolution: dto.resolution,
        resolvedAmount: dto.resolvedAmount,
        resolvedAt: new Date(),
        resolvedById: userId,
      },
    });

    // Check if all disputes are resolved - if so, move deduction back to UNDER_REVIEW
    const openDisputes = await this.prisma.deductionDispute.count({
      where: {
        deductionId,
        status: { notIn: ['RESOLVED', 'CLOSED'] },
      },
    });

    if (openDisputes === 0) {
      await this.prisma.deduction.update({
        where: { id: deductionId },
        data: { status: 'UNDER_REVIEW' },
      });
    }

    await this.createActivity(
      deductionId,
      userId,
      'DISPUTE_RESOLVED',
      `Dispute ${dispute.disputeNumber} resolved: ${dto.resolution}`,
    );

    this.logger.log(`Dispute resolved: ${dispute.disputeNumber}`);

    return this.transformDispute(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE COMMENT
  // ═══════════════════════════════════════════════════════════════════════════
  async createComment(deductionId: string, dto: CreateCommentDto, userId: string) {
    const deduction = await this.prisma.deduction.findUnique({
      where: { id: deductionId },
    });
    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${deductionId} not found`);
    }

    const comment = await this.prisma.deductionComment.create({
      data: {
        deductionId,
        content: dto.content,
        isInternal: dto.isInternal ?? true,
        createdById: userId,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`Comment added to deduction ${deduction.deductionNumber}`);

    return comment;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST COMMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  async listComments(deductionId: string) {
    const deduction = await this.prisma.deduction.findUnique({
      where: { id: deductionId },
    });
    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${deductionId} not found`);
    }

    const comments = await this.prisma.deductionComment.findMany({
      where: { deductionId },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return comments;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADD DOCUMENT METADATA
  // ═══════════════════════════════════════════════════════════════════════════
  async addDocument(deductionId: string, dto: CreateDeductionDocumentDto, userId: string) {
    const deduction = await this.prisma.deduction.findUnique({
      where: { id: deductionId },
    });
    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${deductionId} not found`);
    }

    const document = await this.prisma.deductionDocument.create({
      data: {
        deductionId,
        fileName: dto.fileName,
        fileType: dto.fileType,
        fileSize: dto.fileSize,
        filePath: dto.filePath,
        documentType: dto.documentType,
        uploadedById: userId,
      },
      include: {
        uploadedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    await this.createActivity(
      deductionId,
      userId,
      'DOCUMENT_ADDED',
      `Document uploaded: ${dto.fileName}`,
    );

    this.logger.log(`Document added to deduction ${deduction.deductionNumber}: ${dto.fileName}`);

    return document;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST DOCUMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  async listDocuments(deductionId: string) {
    const deduction = await this.prisma.deduction.findUnique({
      where: { id: deductionId },
    });
    if (!deduction) {
      throw new NotFoundException(`Deduction with ID ${deductionId} not found`);
    }

    const documents = await this.prisma.deductionDocument.findMany({
      where: { deductionId },
      include: {
        uploadedBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { uploadedAt: 'desc' },
    });

    return documents;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST WRITE-OFF RULES
  // ═══════════════════════════════════════════════════════════════════════════
  async listWriteOffRules() {
    const rules = await this.prisma.writeOffRule.findMany({
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rules.map((rule) => this.transformWriteOffRule(rule));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE WRITE-OFF RULE
  // ═══════════════════════════════════════════════════════════════════════════
  async createWriteOffRule(dto: CreateWriteOffRuleDto, userId: string) {
    // Validate company exists
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });
    if (!company) {
      throw new BadRequestException(`Company with ID ${dto.companyId} not found`);
    }

    const rule = await this.prisma.writeOffRule.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        description: dto.description,
        maxAmount: dto.maxAmount,
        minAgeDays: dto.minAgeDays ?? 90,
        categories: dto.categories || [],
        requiresApproval: dto.requiresApproval ?? true,
        approverRoleId: dto.approverRoleId,
        isActive: true,
        createdById: userId,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`Write-off rule created: ${rule.name}`);

    return this.transformWriteOffRule(rule);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE WRITE-OFF RULE
  // ═══════════════════════════════════════════════════════════════════════════
  async updateWriteOffRule(ruleId: string, dto: UpdateWriteOffRuleDto) {
    const rule = await this.prisma.writeOffRule.findUnique({
      where: { id: ruleId },
    });

    if (!rule) {
      throw new NotFoundException(`Write-off rule with ID ${ruleId} not found`);
    }

    const updated = await this.prisma.writeOffRule.update({
      where: { id: ruleId },
      data: {
        name: dto.name,
        description: dto.description,
        maxAmount: dto.maxAmount,
        minAgeDays: dto.minAgeDays,
        categories: dto.categories,
        requiresApproval: dto.requiresApproval,
        approverRoleId: dto.approverRoleId,
        isActive: dto.isActive,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`Write-off rule updated: ${updated.name}`);

    return this.transformWriteOffRule(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Create Activity Log
  // ═══════════════════════════════════════════════════════════════════════════
  private async createActivity(
    deductionId: string,
    userId: string,
    action: string,
    description: string,
    extra?: { oldValue?: any; newValue?: any },
  ) {
    await this.prisma.deductionActivity.create({
      data: {
        deductionId,
        action,
        description,
        oldValue: extra?.oldValue || undefined,
        newValue: extra?.newValue || undefined,
        createdById: userId,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Generate Dispute Number (DSP-{YYYY}-{NNNN})
  // ═══════════════════════════════════════════════════════════════════════════
  private async generateDisputeNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `DSP-${year}`;

    const lastDispute = await this.prisma.deductionDispute.findFirst({
      where: { disputeNumber: { startsWith: prefix } },
      orderBy: { disputeNumber: 'desc' },
      select: { disputeNumber: true },
    });

    let sequence = 1;
    if (lastDispute) {
      const parts = lastDispute.disputeNumber.split('-');
      const lastNumber = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNumber)) {
        sequence = lastNumber + 1;
      }
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Deduction for Response (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformDeduction(deduction: any) {
    return {
      id: deduction.id,
      companyId: deduction.companyId,
      company: deduction.company || null,
      deductionNumber: deduction.deductionNumber,
      externalRef: deduction.externalRef,
      source: deduction.source,
      sourceDocument: deduction.sourceDocument,
      sourceDate: deduction.sourceDate,
      customerId: deduction.customerId,
      customer: deduction.customer || null,
      amount: Number(deduction.amount),
      currency: deduction.currency,
      deductionDate: deduction.deductionDate,
      dueDate: deduction.dueDate,
      receivedDate: deduction.receivedDate,
      reasonCode: deduction.reasonCode,
      reasonDescription: deduction.reasonDescription,
      category: deduction.category,
      status: deduction.status,
      matchedPromotionId: deduction.matchedPromotionId,
      matchedPromotion: deduction.matchedPromotion || null,
      matchedClaimId: deduction.matchedClaimId,
      matchedClaim: deduction.matchedClaim
        ? {
            ...deduction.matchedClaim,
            amount: deduction.matchedClaim.amount ? Number(deduction.matchedClaim.amount) : null,
          }
        : null,
      matchScore: deduction.matchScore,
      matchMethod: deduction.matchMethod,
      matchedAt: deduction.matchedAt,
      matchedBy: deduction.matchedBy || null,
      resolutionType: deduction.resolutionType,
      resolvedAmount: deduction.resolvedAmount ? Number(deduction.resolvedAmount) : null,
      varianceAmount: deduction.varianceAmount ? Number(deduction.varianceAmount) : null,
      resolvedAt: deduction.resolvedAt,
      resolvedBy: deduction.resolvedBy || null,
      resolutionNotes: deduction.resolutionNotes,
      daysOutstanding: deduction.daysOutstanding,
      agingBucket: deduction.agingBucket,
      disputeCount: deduction._count?.disputes || 0,
      documentCount: deduction._count?.documents || 0,
      commentCount: deduction._count?.comments || 0,
      createdAt: deduction.createdAt,
      updatedAt: deduction.updatedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Deduction Detail (with nested relations)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformDeductionDetail(deduction: any) {
    const base = this.transformDeduction(deduction);

    return {
      ...base,
      writeOffReason: deduction.writeOffReason,
      writeOffApprovedBy: deduction.writeOffApprovedBy || null,
      disputes: deduction.disputes?.map((d: any) => this.transformDispute(d)) || [],
      documents: deduction.documents || [],
      comments: deduction.comments || [],
      activities: deduction.activities || [],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Dispute (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformDispute(dispute: any) {
    return {
      id: dispute.id,
      deductionId: dispute.deductionId,
      disputeNumber: dispute.disputeNumber,
      disputeDate: dispute.disputeDate,
      disputeReason: dispute.disputeReason,
      disputeAmount: Number(dispute.disputeAmount),
      status: dispute.status,
      customerResponse: dispute.customerResponse,
      customerResponseDate: dispute.customerResponseDate,
      customerContactName: dispute.customerContactName,
      customerContactEmail: dispute.customerContactEmail,
      resolution: dispute.resolution,
      resolvedAmount: dispute.resolvedAmount ? Number(dispute.resolvedAmount) : null,
      resolvedAt: dispute.resolvedAt,
      resolvedById: dispute.resolvedById,
      createdAt: dispute.createdAt,
      updatedAt: dispute.updatedAt,
      createdById: dispute.createdById,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Write-Off Rule (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformWriteOffRule(rule: any) {
    return {
      id: rule.id,
      companyId: rule.companyId,
      name: rule.name,
      description: rule.description,
      maxAmount: Number(rule.maxAmount),
      minAgeDays: rule.minAgeDays,
      categories: rule.categories,
      requiresApproval: rule.requiresApproval,
      approverRoleId: rule.approverRoleId,
      isActive: rule.isActive,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
      createdById: rule.createdById,
      createdBy: rule.createdBy || null,
    };
  }
}
