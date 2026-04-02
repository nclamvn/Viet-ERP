import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateFundDto } from './dto/create-fund.dto';
import { UpdateFundDto } from './dto/update-fund.dto';
import { FundQueryDto } from './dto/fund-query.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class FundsService {
  private readonly logger = new Logger(FundsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST FUNDS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: FundQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      type,
      year,
      isActive,
      companyId,
      customerId,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.FundWhereInput = {};

    if (type) {
      where.type = type;
    }

    if (year !== undefined) {
      where.year = year;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (companyId) {
      where.companyId = companyId;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = [
      'createdAt',
      'updatedAt',
      'name',
      'code',
      'type',
      'year',
      'totalBudget',
      'committed',
      'available',
    ];
    const orderBy: Prisma.FundOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.fund.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          company: {
            select: { id: true, name: true, code: true },
          },
          customer: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: { promotions: true, transactions: true },
          },
        },
      }),
      this.prisma.fund.count({ where }),
    ]);

    // Transform data
    const transformedData = data.map((fund) => this.transformFund(fund));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE FUND
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const fund = await this.prisma.fund.findUnique({
      where: { id },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        customer: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { promotions: true, transactions: true },
        },
        transactions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            amount: true,
            description: true,
            createdAt: true,
            promotionId: true,
            claimId: true,
          },
        },
      },
    });

    if (!fund) {
      throw new NotFoundException(`Fund with ID ${id} not found`);
    }

    return this.transformFund(fund);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE FUND
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateFundDto, userId?: string) {
    // Validate company exists
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });

    if (!company) {
      throw new BadRequestException(`Company with ID ${dto.companyId} not found`);
    }

    // Validate customer exists if provided
    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });

      if (!customer) {
        throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);
      }
    }

    // Validate unique [companyId, code, year]
    const existing = await this.prisma.fund.findUnique({
      where: {
        companyId_code_year: {
          companyId: dto.companyId,
          code: dto.code,
          year: dto.year,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Fund with code "${dto.code}" and year ${dto.year} already exists for this company`,
      );
    }

    const fund = await this.prisma.fund.create({
      data: {
        code: dto.code,
        name: dto.name,
        type: dto.type || 'FIXED',
        year: dto.year,
        totalBudget: dto.totalBudget,
        committed: 0,
        available: dto.totalBudget,
        companyId: dto.companyId,
        customerId: dto.customerId || null,
      },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        customer: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { promotions: true, transactions: true },
        },
      },
    });

    this.logger.log(`Fund created: ${fund.code} - ${fund.name} (year: ${fund.year})`);

    return this.transformFund(fund);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE FUND
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateFundDto) {
    const fund = await this.prisma.fund.findUnique({ where: { id } });

    if (!fund) {
      throw new NotFoundException(`Fund with ID ${id} not found`);
    }

    // Validate customer exists if changing customerId
    if (dto.customerId !== undefined && dto.customerId !== null) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });

      if (!customer) {
        throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);
      }
    }

    // If totalBudget changes, recalculate available = newTotalBudget - committed
    const updateData: Prisma.FundUpdateInput = {};

    if (dto.name !== undefined) {
      updateData.name = dto.name;
    }

    if (dto.type !== undefined) {
      updateData.type = dto.type;
    }

    if (dto.customerId !== undefined) {
      if (dto.customerId === null) {
        updateData.customer = { disconnect: true };
      } else {
        updateData.customer = { connect: { id: dto.customerId } };
      }
    }

    if (dto.totalBudget !== undefined) {
      const committed = Number(fund.committed);
      if (dto.totalBudget < committed) {
        throw new BadRequestException(
          `Cannot reduce totalBudget below committed amount (${committed}). Current committed: ${committed}`,
        );
      }
      updateData.totalBudget = dto.totalBudget;
      updateData.available = dto.totalBudget - committed;
    }

    const updated = await this.prisma.fund.update({
      where: { id },
      data: updateData,
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        customer: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { promotions: true, transactions: true },
        },
      },
    });

    this.logger.log(`Fund updated: ${updated.code} - ${updated.name}`);

    return this.transformFund(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMOVE FUND
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const fund = await this.prisma.fund.findUnique({
      where: { id },
      include: {
        _count: {
          select: { promotions: true, transactions: true },
        },
      },
    });

    if (!fund) {
      throw new NotFoundException(`Fund with ID ${id} not found`);
    }

    // Can't delete if promotions or transactions exist -- soft-delete instead
    if (fund._count.promotions > 0 || fund._count.transactions > 0) {
      throw new BadRequestException(
        `Cannot delete fund with ${fund._count.promotions} promotion(s) and ${fund._count.transactions} transaction(s). ` +
          `Deactivate the fund instead using PATCH /:id/toggle-active.`,
      );
    }

    await this.prisma.fund.delete({ where: { id } });

    this.logger.log(`Fund deleted: ${fund.code} - ${fund.name}`);

    return { success: true, message: 'Fund deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOGGLE ACTIVE STATUS
  // ═══════════════════════════════════════════════════════════════════════════
  async toggleActive(id: string) {
    const fund = await this.prisma.fund.findUnique({
      where: { id },
      include: {
        promotions: {
          where: {
            status: { in: ['DRAFT', 'PLANNED', 'CONFIRMED', 'EXECUTING'] },
          },
          select: { id: true },
        },
      },
    });

    if (!fund) {
      throw new NotFoundException(`Fund with ID ${id} not found`);
    }

    // If currently active and trying to deactivate, check for active promotions
    if (fund.isActive && fund.promotions.length > 0) {
      throw new BadRequestException(
        `Cannot deactivate fund with ${fund.promotions.length} active promotion(s). ` +
          `Complete or cancel all promotions first.`,
      );
    }

    const updated = await this.prisma.fund.update({
      where: { id },
      data: { isActive: !fund.isActive },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        customer: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { promotions: true, transactions: true },
        },
      },
    });

    this.logger.log(
      `Fund ${updated.isActive ? 'activated' : 'deactivated'}: ${updated.code} - ${updated.name}`,
    );

    return this.transformFund(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SUMMARY (aggregated stats by type and year)
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary(companyId?: string) {
    const where: Prisma.FundWhereInput = {};
    if (companyId) {
      where.companyId = companyId;
    }

    // Aggregate by type
    const byType = await this.prisma.fund.groupBy({
      by: ['type'],
      where,
      _sum: {
        totalBudget: true,
        committed: true,
        available: true,
      },
      _count: {
        id: true,
      },
    });

    // Aggregate by year
    const byYear = await this.prisma.fund.groupBy({
      by: ['year'],
      where,
      _sum: {
        totalBudget: true,
        committed: true,
        available: true,
      },
      _count: {
        id: true,
      },
      orderBy: { year: 'desc' },
    });

    // Overall totals
    const totals = await this.prisma.fund.aggregate({
      where,
      _sum: {
        totalBudget: true,
        committed: true,
        available: true,
      },
      _count: {
        id: true,
      },
    });

    return {
      totals: {
        totalBudget: Number(totals._sum.totalBudget || 0),
        committed: Number(totals._sum.committed || 0),
        available: Number(totals._sum.available || 0),
        fundCount: totals._count.id,
        utilizationRate:
          totals._sum.totalBudget && Number(totals._sum.totalBudget) > 0
            ? Number(
                ((Number(totals._sum.committed) / Number(totals._sum.totalBudget)) * 100).toFixed(
                  2,
                ),
              )
            : 0,
      },
      byType: byType.map((row) => ({
        type: row.type,
        totalBudget: Number(row._sum.totalBudget || 0),
        committed: Number(row._sum.committed || 0),
        available: Number(row._sum.available || 0),
        fundCount: row._count.id,
      })),
      byYear: byYear.map((row) => ({
        year: row.year,
        totalBudget: Number(row._sum.totalBudget || 0),
        committed: Number(row._sum.committed || 0),
        available: Number(row._sum.available || 0),
        fundCount: row._count.id,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET AVAILABLE YEARS
  // ═══════════════════════════════════════════════════════════════════════════
  async getAvailableYears(companyId?: string) {
    const where: Prisma.FundWhereInput = {};
    if (companyId) {
      where.companyId = companyId;
    }

    const result = await this.prisma.fund.findMany({
      where,
      select: { year: true },
      distinct: ['year'],
      orderBy: { year: 'desc' },
    });

    return result.map((r) => r.year);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Fund for Response (Decimal -> Number + computed fields)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformFund(fund: any) {
    const totalBudget = Number(fund.totalBudget || 0);
    const committed = Number(fund.committed || 0);
    const available = Number(fund.available || 0);

    const utilizationRate =
      totalBudget > 0 ? Number(((committed / totalBudget) * 100).toFixed(2)) : 0;

    return {
      id: fund.id,
      code: fund.code,
      name: fund.name,
      type: fund.type,
      year: fund.year,
      totalBudget,
      committed,
      available,
      utilizationRate,
      isActive: fund.isActive,
      companyId: fund.companyId,
      customerId: fund.customerId,
      company: fund.company || null,
      customer: fund.customer || null,
      createdAt: fund.createdAt,
      updatedAt: fund.updatedAt,
      promotionCount: fund._count?.promotions || 0,
      transactionCount: fund._count?.transactions || 0,
      // Include recent transactions if present (findOne)
      ...(fund.transactions
        ? {
            recentTransactions: fund.transactions.map((tx: any) => ({
              ...tx,
              amount: Number(tx.amount || 0),
            })),
          }
        : {}),
    };
  }
}
