import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { UpdateSettlementDto } from './dto/update-settlement.dto';
import { SettlementQueryDto } from './dto/settlement-query.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST SETTLEMENTS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: SettlementQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { dateFrom, dateTo, search, sortBy = 'settledAt', sortOrder = 'desc' } = query;

    // Build where clause
    const where: Prisma.SettlementWhereInput = {};

    if (dateFrom || dateTo) {
      where.settledAt = {};
      if (dateFrom) {
        where.settledAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.settledAt.lte = new Date(dateTo);
      }
    }

    if (search) {
      where.OR = [
        { claim: { code: { contains: search, mode: 'insensitive' } } },
        {
          claim: {
            customer: { name: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    // Build orderBy with validated sort fields
    const validSortFields = ['settledAt', 'settledAmount', 'variance', 'createdAt'];
    const orderBy: Prisma.SettlementOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { settledAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.settlement.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          claim: {
            select: {
              id: true,
              code: true,
              amount: true,
              status: true,
              claimDate: true,
              customer: {
                select: { id: true, name: true, code: true },
              },
            },
          },
        },
      }),
      this.prisma.settlement.count({ where }),
    ]);

    // Transform data
    const transformedData = data.map((settlement) => this.transformSettlement(settlement));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE SETTLEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id },
      include: {
        claim: {
          select: {
            id: true,
            code: true,
            amount: true,
            status: true,
            claimDate: true,
            description: true,
            customer: {
              select: {
                id: true,
                name: true,
                code: true,
                channel: true,
                address: true,
              },
            },
            promotion: {
              select: {
                id: true,
                name: true,
                code: true,
                status: true,
                startDate: true,
                endDate: true,
              },
            },
          },
        },
      },
    });

    if (!settlement) {
      throw new NotFoundException(`Settlement with ID ${id} not found`);
    }

    return this.transformSettlement(settlement);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE SETTLEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateSettlementDto) {
    // Validate claim exists
    const claim = await this.prisma.claim.findUnique({
      where: { id: dto.claimId },
      include: { settlement: true },
    });

    if (!claim) {
      throw new NotFoundException(`Claim with ID ${dto.claimId} not found`);
    }

    // Validate claim status is APPROVED
    if (claim.status !== 'APPROVED') {
      throw new BadRequestException(
        `Claim must be in APPROVED status to create a settlement. Current status: ${claim.status}`,
      );
    }

    // Validate no existing settlement (claimId is unique)
    if (claim.settlement) {
      throw new ConflictException(`A settlement already exists for claim ${dto.claimId}`);
    }

    // Calculate variance = settledAmount - claim.amount
    const claimAmount = Number(claim.amount);
    const variance = dto.variance !== undefined ? dto.variance : dto.settledAmount - claimAmount;

    // Create settlement AND update claim status to SETTLED in a transaction
    const settlement = await this.prisma.$transaction(async (tx) => {
      const newSettlement = await tx.settlement.create({
        data: {
          claimId: dto.claimId,
          settledAmount: dto.settledAmount,
          variance,
          notes: dto.notes,
          settledAt: dto.settledAt ? new Date(dto.settledAt) : new Date(),
        },
        include: {
          claim: {
            select: {
              id: true,
              code: true,
              amount: true,
              status: true,
              claimDate: true,
              customer: {
                select: { id: true, name: true, code: true },
              },
            },
          },
        },
      });

      // Update claim status to SETTLED
      await tx.claim.update({
        where: { id: dto.claimId },
        data: { status: 'SETTLED' },
      });

      return newSettlement;
    });

    this.logger.log(
      `Settlement created for claim ${dto.claimId}: settled ${dto.settledAmount}, variance ${variance}`,
    );

    return this.transformSettlement(settlement);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE SETTLEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateSettlementDto) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id },
      include: {
        claim: { select: { id: true, amount: true } },
      },
    });

    if (!settlement) {
      throw new NotFoundException(`Settlement with ID ${id} not found`);
    }

    // Recalculate variance if settledAmount changes
    const updateData: Prisma.SettlementUpdateInput = {};

    if (dto.settledAmount !== undefined) {
      updateData.settledAmount = dto.settledAmount;
      const claimAmount = Number(settlement.claim.amount);
      updateData.variance = dto.settledAmount - claimAmount;
    }

    if (dto.variance !== undefined && dto.settledAmount === undefined) {
      // Only apply manual variance if settledAmount is NOT also being changed
      updateData.variance = dto.variance;
    }

    if (dto.notes !== undefined) {
      updateData.notes = dto.notes;
    }

    if (dto.settledAt !== undefined) {
      updateData.settledAt = new Date(dto.settledAt);
    }

    const updated = await this.prisma.settlement.update({
      where: { id },
      data: updateData,
      include: {
        claim: {
          select: {
            id: true,
            code: true,
            amount: true,
            status: true,
            claimDate: true,
            customer: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    this.logger.log(`Settlement updated: ${id}`);

    return this.transformSettlement(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE SETTLEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id },
      include: {
        claim: { select: { id: true, code: true, status: true } },
      },
    });

    if (!settlement) {
      throw new NotFoundException(`Settlement with ID ${id} not found`);
    }

    // Delete settlement AND revert claim status back to APPROVED
    await this.prisma.$transaction(async (tx) => {
      await tx.settlement.delete({ where: { id } });

      await tx.claim.update({
        where: { id: settlement.claimId },
        data: { status: 'APPROVED' },
      });
    });

    this.logger.log(
      `Settlement deleted: ${id}, claim ${settlement.claim.code} reverted to APPROVED`,
    );

    return { success: true, message: 'Settlement deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SETTLEMENT SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const settlements = await this.prisma.settlement.findMany({
      select: {
        settledAmount: true,
        variance: true,
        settledAt: true,
      },
    });

    const count = settlements.length;
    const totalSettled = settlements.reduce((sum, s) => sum + Number(s.settledAmount), 0);
    const totalVariance = settlements.reduce((sum, s) => sum + Number(s.variance || 0), 0);
    const averageSettlement = count > 0 ? totalSettled / count : 0;

    // Settlements by month
    const byMonth: Record<string, { count: number; totalSettled: number; totalVariance: number }> =
      {};
    settlements.forEach((s) => {
      const monthKey = `${s.settledAt.getFullYear()}-${String(s.settledAt.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[monthKey]) {
        byMonth[monthKey] = { count: 0, totalSettled: 0, totalVariance: 0 };
      }
      byMonth[monthKey].count += 1;
      byMonth[monthKey].totalSettled += Number(s.settledAmount);
      byMonth[monthKey].totalVariance += Number(s.variance || 0);
    });

    // Sort months chronologically
    const sortedMonths = Object.keys(byMonth).sort();
    const settlementsByMonth = sortedMonths.map((month) => ({
      month,
      ...byMonth[month],
    }));

    return {
      count,
      totalSettled,
      totalVariance,
      averageSettlement,
      settlementsByMonth,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Settlement for Response (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformSettlement(settlement: any) {
    return {
      id: settlement.id,
      settledAmount: Number(settlement.settledAmount),
      variance: settlement.variance !== null ? Number(settlement.variance) : null,
      notes: settlement.notes,
      settledAt: settlement.settledAt,
      createdAt: settlement.createdAt,
      updatedAt: settlement.updatedAt,
      claimId: settlement.claimId,
      claim: settlement.claim
        ? {
            ...settlement.claim,
            amount: Number(settlement.claim.amount),
          }
        : null,
    };
  }
}
