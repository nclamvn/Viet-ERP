import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { PromotionQueryDto } from './dto/promotion-query.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST PROMOTIONS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: PromotionQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      status,
      customerId,
      fundId,
      search,
      startDateFrom,
      endDateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.PromotionWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (fundId) {
      where.fundId = fundId;
    }

    if (startDateFrom) {
      where.startDate = { gte: new Date(startDateFrom) };
    }

    if (endDateTo) {
      where.endDate = { lte: new Date(endDateTo) };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = [
      'createdAt',
      'name',
      'budget',
      'startDate',
      'endDate',
      'status',
      'code',
    ];
    const orderBy: Prisma.PromotionOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.promotion.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          customer: {
            select: { id: true, name: true, code: true },
          },
          fund: {
            select: { id: true, name: true, code: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { tactics: true, claims: true },
          },
        },
      }),
      this.prisma.promotion.count({ where }),
    ]);

    // Transform data
    const transformedData = data.map((promotion) => this.transformPromotion(promotion));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE PROMOTION
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const promotion = await this.prisma.promotion.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        fund: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        tactics: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        claims: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: { tactics: true, claims: true, transactions: true, poas: true },
        },
      },
    });

    if (!promotion) {
      throw new NotFoundException(`Promotion with ID ${id} not found`);
    }

    return this.transformPromotionDetail(promotion);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE PROMOTION
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreatePromotionDto, userId: string) {
    // Validate dates
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    // Validate customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) {
      throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);
    }

    // Validate fund exists
    const fund = await this.prisma.fund.findUnique({
      where: { id: dto.fundId },
    });
    if (!fund) {
      throw new BadRequestException(`Fund with ID ${dto.fundId} not found`);
    }

    // Generate unique code: PROMO-{YYYY}-{NNNN}
    const code = await this.generatePromotionCode(startDate.getFullYear());

    const promotion = await this.prisma.promotion.create({
      data: {
        code,
        name: dto.name,
        description: dto.description,
        status: 'DRAFT',
        startDate,
        endDate,
        budget: dto.budget,
        actualSpend: 0,
        customerId: dto.customerId,
        fundId: dto.fundId,
        createdById: userId,
        templateId: dto.templateId,
        clonedFromId: dto.clonedFromId,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        fund: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`Promotion created: ${promotion.code} by user ${userId}`);

    return this.transformPromotion(promotion);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE PROMOTION
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdatePromotionDto, userId: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } });

    if (!promotion) {
      throw new NotFoundException(`Promotion with ID ${id} not found`);
    }

    // Only allow updates in DRAFT or PLANNED status
    if (!['DRAFT', 'PLANNED'].includes(promotion.status)) {
      throw new BadRequestException(
        `Cannot update promotion in ${promotion.status} status. Only DRAFT or PLANNED promotions can be modified.`,
      );
    }

    // Validate dates if provided
    if (dto.startDate || dto.endDate) {
      const startDate = dto.startDate ? new Date(dto.startDate) : promotion.startDate;
      const endDate = dto.endDate ? new Date(dto.endDate) : promotion.endDate;

      if (endDate <= startDate) {
        throw new BadRequestException('End date must be after start date');
      }
    }

    // Validate customer if changing
    if (dto.customerId && dto.customerId !== promotion.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);
      }
    }

    // Validate fund if changing
    if (dto.fundId && dto.fundId !== promotion.fundId) {
      const fund = await this.prisma.fund.findUnique({
        where: { id: dto.fundId },
      });
      if (!fund) {
        throw new BadRequestException(`Fund with ID ${dto.fundId} not found`);
      }
    }

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        budget: dto.budget,
        customerId: dto.customerId,
        fundId: dto.fundId,
        templateId: dto.templateId,
        clonedFromId: dto.clonedFromId,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        fund: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`Promotion updated: ${updated.code} by user ${userId}`);

    return this.transformPromotion(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE PROMOTION
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string, userId: string) {
    const promotion = await this.prisma.promotion.findUnique({
      where: { id },
      include: {
        _count: { select: { claims: true, tactics: true } },
      },
    });

    if (!promotion) {
      throw new NotFoundException(`Promotion with ID ${id} not found`);
    }

    // Only allow deletion in DRAFT status
    if (promotion.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot delete promotion in ${promotion.status} status. Only DRAFT promotions can be deleted.`,
      );
    }

    // Check if promotion has claims
    if (promotion._count.claims > 0) {
      throw new BadRequestException(
        'Cannot delete promotion with linked claims. Remove claims first.',
      );
    }

    await this.prisma.promotion.delete({
      where: { id },
    });

    this.logger.log(`Promotion deleted: ${promotion.code} by user ${userId}`);

    return { success: true, message: 'Promotion deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIRM PROMOTION (PLANNED -> CONFIRMED)
  // ═══════════════════════════════════════════════════════════════════════════
  async confirm(id: string, userId: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } });

    if (!promotion) {
      throw new NotFoundException(`Promotion with ID ${id} not found`);
    }

    if (promotion.status !== 'PLANNED') {
      throw new BadRequestException(
        `Promotion must be in PLANNED status to confirm. Current status: ${promotion.status}`,
      );
    }

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: { status: 'CONFIRMED' },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        fund: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`Promotion confirmed: ${promotion.code} by user ${userId}`);

    return this.transformPromotion(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTE PROMOTION (CONFIRMED -> EXECUTING)
  // ═══════════════════════════════════════════════════════════════════════════
  async execute(id: string, userId: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } });

    if (!promotion) {
      throw new NotFoundException(`Promotion with ID ${id} not found`);
    }

    if (promotion.status !== 'CONFIRMED') {
      throw new BadRequestException(
        `Promotion must be in CONFIRMED status to execute. Current status: ${promotion.status}`,
      );
    }

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: { status: 'EXECUTING' },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        fund: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`Promotion execution started: ${promotion.code} by user ${userId}`);

    return this.transformPromotion(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE PROMOTION (EXECUTING -> COMPLETED)
  // ═══════════════════════════════════════════════════════════════════════════
  async complete(id: string, userId: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } });

    if (!promotion) {
      throw new NotFoundException(`Promotion with ID ${id} not found`);
    }

    if (promotion.status !== 'EXECUTING') {
      throw new BadRequestException(
        `Promotion must be in EXECUTING status to complete. Current status: ${promotion.status}`,
      );
    }

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: { status: 'COMPLETED' },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        fund: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`Promotion completed: ${promotion.code} by user ${userId}`);

    return this.transformPromotion(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CANCEL PROMOTION (any -> CANCELLED)
  // ═══════════════════════════════════════════════════════════════════════════
  async cancel(id: string, userId: string) {
    const promotion = await this.prisma.promotion.findUnique({ where: { id } });

    if (!promotion) {
      throw new NotFoundException(`Promotion with ID ${id} not found`);
    }

    if (['COMPLETED', 'CANCELLED'].includes(promotion.status)) {
      throw new BadRequestException(`Cannot cancel promotion in ${promotion.status} status.`);
    }

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        fund: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`Promotion cancelled: ${promotion.code} by user ${userId}`);

    return this.transformPromotion(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET PROMOTION SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const promotions = await this.prisma.promotion.findMany({
      select: {
        budget: true,
        actualSpend: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    });

    // Calculate totals
    const totalBudget = promotions.reduce((sum, p) => sum + Number(p.budget), 0);
    const totalActualSpend = promotions.reduce((sum, p) => sum + Number(p.actualSpend || 0), 0);
    const totalRemaining = totalBudget - totalActualSpend;

    // Count by status
    const byStatus: Record<string, number> = {};
    promotions.forEach((p) => {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    });

    // Budget by status
    const budgetByStatus: Record<string, number> = {};
    promotions.forEach((p) => {
      budgetByStatus[p.status] = (budgetByStatus[p.status] || 0) + Number(p.budget);
    });

    // Active promotions (currently executing)
    const now = new Date();
    const activeCount = promotions.filter(
      (p) => p.status === 'EXECUTING' && p.startDate <= now && p.endDate >= now,
    ).length;

    return {
      totalPromotions: promotions.length,
      totalBudget,
      totalActualSpend,
      totalRemaining,
      utilizationRate: totalBudget > 0 ? (totalActualSpend / totalBudget) * 100 : 0,
      activeCount,
      byStatus,
      budgetByStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Generate Promotion Code
  // ═══════════════════════════════════════════════════════════════════════════
  private async generatePromotionCode(year: number): Promise<string> {
    const prefix = `PROMO-${year}`;

    const lastPromotion = await this.prisma.promotion.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });

    let sequence = 1;
    if (lastPromotion) {
      const parts = lastPromotion.code.split('-');
      const lastNumber = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNumber)) {
        sequence = lastNumber + 1;
      }
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Promotion for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformPromotion(promotion: any) {
    const budget = Number(promotion.budget);
    const actualSpend = Number(promotion.actualSpend || 0);

    return {
      id: promotion.id,
      code: promotion.code,
      name: promotion.name,
      description: promotion.description,
      status: promotion.status,
      startDate: promotion.startDate,
      endDate: promotion.endDate,
      budget,
      actualSpend,
      remainingBudget: budget - actualSpend,
      utilizationRate: budget > 0 ? (actualSpend / budget) * 100 : 0,
      customerId: promotion.customerId,
      customer: promotion.customer || null,
      fundId: promotion.fundId,
      fund: promotion.fund || null,
      createdById: promotion.createdById,
      createdBy: promotion.createdBy || null,
      templateId: promotion.templateId,
      clonedFromId: promotion.clonedFromId,
      createdAt: promotion.createdAt,
      updatedAt: promotion.updatedAt,
      tacticCount: promotion._count?.tactics || 0,
      claimCount: promotion._count?.claims || 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Promotion Detail for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformPromotionDetail(promotion: any) {
    const base = this.transformPromotion(promotion);

    return {
      ...base,
      tactics:
        promotion.tactics?.map((t: any) => ({
          ...t,
          budget: Number(t.budget),
          actualSpend: Number(t.actualSpend || 0),
        })) || [],
      claims:
        promotion.claims?.map((c: any) => ({
          ...c,
          amount: Number(c.amount),
          approvedAmount: Number(c.approvedAmount || 0),
        })) || [],
      transactionCount: promotion._count?.transactions || 0,
      poaCount: promotion._count?.poas || 0,
    };
  }
}
