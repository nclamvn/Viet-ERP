import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateTransactionDto, TransactionTypeEnum } from './dto/create-transaction.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST TRANSACTIONS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: TransactionQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      type,
      fundId,
      promotionId,
      claimId,
      dateFrom,
      dateTo,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.TransactionWhereInput = {};

    if (type) {
      where.type = type;
    }

    if (fundId) {
      where.fundId = fundId;
    }

    if (promotionId) {
      where.promotionId = promotionId;
    }

    if (claimId) {
      where.claimId = claimId;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo);
      }
    }

    if (search) {
      where.OR = [{ description: { contains: search, mode: 'insensitive' } }];
    }

    // Build orderBy
    const validSortFields = ['createdAt', 'amount', 'type'];
    const orderBy: Prisma.TransactionOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          fund: {
            select: { id: true, code: true, name: true },
          },
          promotion: {
            select: { id: true, code: true, name: true },
          },
          claim: {
            select: { id: true, code: true },
          },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    // Transform data (Decimal -> Number)
    const transformedData = data.map((txn) => this.transformTransaction(txn));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE TRANSACTION
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        fund: {
          include: {
            company: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        promotion: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            startDate: true,
            endDate: true,
          },
        },
        claim: {
          include: {
            customer: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    return this.transformTransaction(transaction);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE TRANSACTION
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateTransactionDto, userId: string) {
    // Validate fund exists and is active
    const fund = await this.prisma.fund.findUnique({
      where: { id: dto.fundId },
    });

    if (!fund) {
      throw new NotFoundException(`Fund with ID ${dto.fundId} not found`);
    }

    if (!fund.isActive) {
      throw new BadRequestException(
        `Fund "${fund.name}" (${fund.code}) is not active. Cannot record transactions against inactive funds.`,
      );
    }

    // Validate promotion exists if provided
    if (dto.promotionId) {
      const promotion = await this.prisma.promotion.findUnique({
        where: { id: dto.promotionId },
      });
      if (!promotion) {
        throw new NotFoundException(`Promotion with ID ${dto.promotionId} not found`);
      }
    }

    // Validate claim exists if provided
    if (dto.claimId) {
      const claim = await this.prisma.claim.findUnique({
        where: { id: dto.claimId },
      });
      if (!claim) {
        throw new NotFoundException(`Claim with ID ${dto.claimId} not found`);
      }
    }

    // Create transaction and update fund balances atomically
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the transaction record
      const transaction = await tx.transaction.create({
        data: {
          type: dto.type,
          amount: dto.amount,
          description: dto.description,
          fundId: dto.fundId,
          promotionId: dto.promotionId,
          claimId: dto.claimId,
        },
        include: {
          fund: {
            select: { id: true, code: true, name: true },
          },
          promotion: {
            select: { id: true, code: true, name: true },
          },
          claim: {
            select: { id: true, code: true },
          },
        },
      });

      // Update fund balances based on transaction type
      const fundUpdate: Prisma.FundUpdateInput = {};

      switch (dto.type) {
        case TransactionTypeEnum.COMMITMENT:
          // Commitment: lock funds from available into committed
          fundUpdate.committed = { increment: dto.amount };
          fundUpdate.available = { decrement: dto.amount };
          break;

        case TransactionTypeEnum.RELEASE:
          // Release: return committed funds back to available
          fundUpdate.committed = { decrement: dto.amount };
          fundUpdate.available = { increment: dto.amount };
          break;

        case TransactionTypeEnum.CLAIM_SETTLEMENT:
          // Settlement: reduce committed (funds leave the system)
          fundUpdate.committed = { decrement: dto.amount };
          break;

        case TransactionTypeEnum.ADJUSTMENT:
          // Adjustment: directly adjust available balance
          fundUpdate.available = { increment: dto.amount };
          break;

        case TransactionTypeEnum.BUDGET_ALLOCATION:
          // Budget allocation: increase available balance
          fundUpdate.available = { increment: dto.amount };
          break;
      }

      await tx.fund.update({
        where: { id: dto.fundId },
        data: fundUpdate,
      });

      return transaction;
    });

    this.logger.log(
      `Transaction created: ${result.id} [${dto.type}] amount=${dto.amount} fund=${dto.fundId} by user ${userId}`,
    );

    return this.transformTransaction(result);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE TRANSACTION (ADJUSTMENT only)
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    // Only allow deletion of ADJUSTMENT transactions
    if (transaction.type !== 'ADJUSTMENT') {
      throw new BadRequestException(
        `Only ADJUSTMENT transactions can be deleted. This transaction is of type ${transaction.type}. ` +
          'To correct other transaction types, create a new ADJUSTMENT transaction.',
      );
    }

    // Delete transaction and reverse fund impact atomically
    await this.prisma.$transaction(async (tx) => {
      // Reverse the adjustment: if the adjustment added to available, we subtract it back
      const amount = Number(transaction.amount);
      await tx.fund.update({
        where: { id: transaction.fundId },
        data: {
          available: { decrement: amount },
        },
      });

      await tx.transaction.delete({
        where: { id },
      });
    });

    this.logger.log(
      `Transaction deleted: ${id} [ADJUSTMENT] amount=${transaction.amount} fund=${transaction.fundId}`,
    );

    return {
      success: true,
      message: 'ADJUSTMENT transaction deleted and fund impact reversed',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET TRANSACTIONS BY FUND
  // ═══════════════════════════════════════════════════════════════════════════
  async getByFund(fundId: string) {
    // Validate fund exists
    const fund = await this.prisma.fund.findUnique({
      where: { id: fundId },
      select: {
        id: true,
        code: true,
        name: true,
        totalBudget: true,
        committed: true,
        available: true,
      },
    });

    if (!fund) {
      throw new NotFoundException(`Fund with ID ${fundId} not found`);
    }

    const transactions = await this.prisma.transaction.findMany({
      where: { fundId },
      orderBy: { createdAt: 'desc' },
      include: {
        promotion: {
          select: { id: true, code: true, name: true },
        },
        claim: {
          select: { id: true, code: true },
        },
      },
    });

    return {
      fund: {
        id: fund.id,
        code: fund.code,
        name: fund.name,
        totalBudget: Number(fund.totalBudget),
        committed: Number(fund.committed),
        available: Number(fund.available),
      },
      transactions: transactions.map((txn) => this.transformTransaction(txn)),
      totalTransactions: transactions.length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET TRANSACTION SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const transactions = await this.prisma.transaction.findMany({
      select: {
        type: true,
        amount: true,
        createdAt: true,
        fundId: true,
        fund: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    // Aggregate by type
    const byType: Record<string, { count: number; totalAmount: number }> = {};
    for (const txn of transactions) {
      if (!byType[txn.type]) {
        byType[txn.type] = { count: 0, totalAmount: 0 };
      }
      byType[txn.type].count += 1;
      byType[txn.type].totalAmount += Number(txn.amount);
    }

    // Aggregate by fund
    const fundMap: Record<
      string,
      { fundId: string; fundCode: string; fundName: string; totalAmount: number; count: number }
    > = {};
    for (const txn of transactions) {
      const fid = txn.fundId;
      if (!fundMap[fid]) {
        fundMap[fid] = {
          fundId: txn.fund.id,
          fundCode: txn.fund.code,
          fundName: txn.fund.name,
          totalAmount: 0,
          count: 0,
        };
      }
      fundMap[fid].totalAmount += Number(txn.amount);
      fundMap[fid].count += 1;
    }

    // Date range
    let dateRange: { earliest: Date | null; latest: Date | null } = {
      earliest: null,
      latest: null,
    };
    if (transactions.length > 0) {
      const dates = transactions.map((t) => t.createdAt);
      dateRange = {
        earliest: new Date(Math.min(...dates.map((d) => d.getTime()))),
        latest: new Date(Math.max(...dates.map((d) => d.getTime()))),
      };
    }

    return {
      totalTransactions: transactions.length,
      byType,
      byFund: Object.values(fundMap),
      dateRange,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Transaction (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformTransaction(transaction: any) {
    return {
      ...transaction,
      amount: Number(transaction.amount),
      fund: transaction.fund
        ? {
            ...transaction.fund,
            ...(transaction.fund.totalBudget !== undefined
              ? { totalBudget: Number(transaction.fund.totalBudget) }
              : {}),
            ...(transaction.fund.committed !== undefined
              ? { committed: Number(transaction.fund.committed) }
              : {}),
            ...(transaction.fund.available !== undefined
              ? { available: Number(transaction.fund.available) }
              : {}),
          }
        : null,
      claim: transaction.claim
        ? {
            ...transaction.claim,
            ...(transaction.claim.amount !== undefined
              ? { amount: Number(transaction.claim.amount) }
              : {}),
            ...(transaction.claim.approvedAmount !== undefined
              ? { approvedAmount: Number(transaction.claim.approvedAmount) }
              : {}),
          }
        : null,
    };
  }
}
