import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { UpdateClaimDto } from './dto/update-claim.dto';
import { ClaimQueryDto } from './dto/claim-query.dto';
import { ReviewClaimDto } from './dto/review-claim.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST CLAIMS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: ClaimQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      status,
      customerId,
      promotionId,
      dateFrom,
      dateTo,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.ClaimWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (promotionId) {
      where.promotionId = promotionId;
    }

    if (dateFrom || dateTo) {
      where.claimDate = {};
      if (dateFrom) {
        where.claimDate.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.claimDate.lte = new Date(dateTo);
      }
    }

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Build orderBy
    const validSortFields = ['createdAt', 'claimDate', 'amount', 'status', 'code'];
    const orderBy: Prisma.ClaimOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.claim.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          customer: {
            select: { id: true, name: true, code: true },
          },
          promotion: {
            select: { id: true, name: true, code: true },
          },
          reviewedBy: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { transactions: true, pops: true },
          },
        },
      }),
      this.prisma.claim.count({ where }),
    ]);

    // Transform data
    const transformedData = data.map((claim) => this.transformClaim(claim));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE CLAIM
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, name: true, code: true, channel: true, address: true },
        },
        promotion: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            startDate: true,
            endDate: true,
            tactics: true,
          },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
        settlement: true,
        transactions: true,
        pops: true,
      },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    return this.transformClaimDetail(claim);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE CLAIM
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateClaimDto, userId: string) {
    // Validate amount
    if (dto.amount <= 0) {
      throw new BadRequestException('Claim amount must be greater than 0');
    }

    // Validate customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });

    if (!customer) {
      throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);
    }

    // Validate promotion exists if provided
    if (dto.promotionId) {
      const promotion = await this.prisma.promotion.findUnique({
        where: { id: dto.promotionId },
      });

      if (!promotion) {
        throw new BadRequestException(`Promotion with ID ${dto.promotionId} not found`);
      }
    }

    // Generate unique code: CLM-{YYYY}-{NNNN}
    const code = await this.generateClaimCode();

    const claim = await this.prisma.claim.create({
      data: {
        code,
        amount: dto.amount,
        claimDate: new Date(dto.claimDate),
        description: dto.description,
        documents: dto.documents,
        status: 'PENDING',
        customerId: dto.customerId,
        promotionId: dto.promotionId,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        promotion: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`Claim created: ${claim.code} by user ${userId}`);

    return this.transformClaim(claim);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE CLAIM
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateClaimDto) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    // Only allow updates in PENDING status
    if (claim.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot update claim in ${claim.status} status. Only PENDING claims can be modified.`,
      );
    }

    // Validate amount if provided
    if (dto.amount !== undefined && dto.amount <= 0) {
      throw new BadRequestException('Claim amount must be greater than 0');
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

    // Validate promotion if changing
    if (dto.promotionId) {
      const promotion = await this.prisma.promotion.findUnique({
        where: { id: dto.promotionId },
      });
      if (!promotion) {
        throw new BadRequestException(`Promotion with ID ${dto.promotionId} not found`);
      }
    }

    const updated = await this.prisma.claim.update({
      where: { id },
      data: {
        customerId: dto.customerId,
        promotionId: dto.promotionId,
        amount: dto.amount,
        claimDate: dto.claimDate ? new Date(dto.claimDate) : undefined,
        description: dto.description,
        documents: dto.documents,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        promotion: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`Claim updated: ${updated.code}`);

    return this.transformClaim(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE CLAIM
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        _count: { select: { transactions: true } },
      },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    // Only allow deletion in PENDING status
    if (claim.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot delete claim in ${claim.status} status. Only PENDING claims can be deleted.`,
      );
    }

    // Check for linked transactions
    if (claim._count.transactions > 0) {
      throw new BadRequestException(
        'Cannot delete claim with linked transactions. Remove transactions first.',
      );
    }

    await this.prisma.claim.delete({
      where: { id },
    });

    this.logger.log(`Claim deleted: ${claim.code}`);

    return { success: true, message: 'Claim deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APPROVE CLAIM
  // ═══════════════════════════════════════════════════════════════════════════
  async approve(id: string, dto: ReviewClaimDto, userId: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    if (claim.status !== 'PENDING') {
      throw new BadRequestException(
        `Claim must be in PENDING status to approve. Current status: ${claim.status}`,
      );
    }

    const updated = await this.prisma.claim.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedById: userId,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        promotion: {
          select: { id: true, name: true, code: true },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(
      `Claim approved: ${claim.code} by user ${userId}${dto.comments ? `, comments: ${dto.comments}` : ''}`,
    );

    return this.transformClaim(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REJECT CLAIM
  // ═══════════════════════════════════════════════════════════════════════════
  async reject(id: string, dto: ReviewClaimDto, userId: string) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    if (claim.status !== 'PENDING') {
      throw new BadRequestException(
        `Claim must be in PENDING status to reject. Current status: ${claim.status}`,
      );
    }

    const updated = await this.prisma.claim.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: userId,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        promotion: {
          select: { id: true, name: true, code: true },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(
      `Claim rejected: ${claim.code} by user ${userId}${dto.comments ? `, comments: ${dto.comments}` : ''}`,
    );

    return this.transformClaim(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET CLAIM SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const claims = await this.prisma.claim.findMany({
      select: {
        amount: true,
        status: true,
      },
    });

    // Calculate totals
    const totalClaims = claims.length;
    const totalAmount = claims.reduce((sum, c) => sum + Number(c.amount), 0);

    // Count and sum by status
    const byStatus: Record<string, { count: number; amount: number }> = {};
    claims.forEach((c) => {
      if (!byStatus[c.status]) {
        byStatus[c.status] = { count: 0, amount: 0 };
      }
      byStatus[c.status].count += 1;
      byStatus[c.status].amount += Number(c.amount);
    });

    return {
      totalClaims,
      totalAmount,
      pendingCount: byStatus['PENDING']?.count || 0,
      pendingAmount: byStatus['PENDING']?.amount || 0,
      approvedCount: byStatus['APPROVED']?.count || 0,
      approvedAmount: byStatus['APPROVED']?.amount || 0,
      rejectedCount: byStatus['REJECTED']?.count || 0,
      rejectedAmount: byStatus['REJECTED']?.amount || 0,
      settledCount: byStatus['SETTLED']?.count || 0,
      settledAmount: byStatus['SETTLED']?.amount || 0,
      disputedCount: byStatus['DISPUTED']?.count || 0,
      disputedAmount: byStatus['DISPUTED']?.amount || 0,
      matchedCount: byStatus['MATCHED']?.count || 0,
      matchedAmount: byStatus['MATCHED']?.amount || 0,
      byStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Generate Claim Code (CLM-{YYYY}-{NNNN})
  // ═══════════════════════════════════════════════════════════════════════════
  private async generateClaimCode(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `CLM-${year}`;

    const lastClaim = await this.prisma.claim.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });

    let sequence = 1;
    if (lastClaim) {
      const parts = lastClaim.code.split('-');
      const lastNumber = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNumber)) {
        sequence = lastNumber + 1;
      }
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Claim for Response (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformClaim(claim: any) {
    return {
      id: claim.id,
      code: claim.code,
      amount: Number(claim.amount),
      status: claim.status,
      claimDate: claim.claimDate,
      description: claim.description,
      documents: claim.documents,
      customerId: claim.customerId,
      customer: claim.customer || null,
      promotionId: claim.promotionId,
      promotion: claim.promotion || null,
      reviewedById: claim.reviewedById,
      reviewedBy: claim.reviewedBy || null,
      transactionCount: claim._count?.transactions || 0,
      popCount: claim._count?.pops || 0,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Claim Detail for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformClaimDetail(claim: any) {
    const base = this.transformClaim(claim);

    return {
      ...base,
      settlement: claim.settlement
        ? {
            ...claim.settlement,
            amount: claim.settlement.amount ? Number(claim.settlement.amount) : null,
          }
        : null,
      transactions:
        claim.transactions?.map((t: any) => ({
          ...t,
          amount: Number(t.amount),
        })) || [],
      pops: claim.pops || [],
    };
  }
}
