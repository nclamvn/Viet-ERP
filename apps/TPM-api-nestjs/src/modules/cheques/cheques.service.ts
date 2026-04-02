import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateChequeDto } from './dto/create-cheque.dto';
import { UpdateChequeDto } from './dto/update-cheque.dto';
import { ChequeQueryDto } from './dto/cheque-query.dto';
import { VoidChequeDto } from './dto/void-cheque.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class ChequesService {
  private readonly logger = new Logger(ChequesService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST CHEQUES (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: ChequeQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      status,
      payeeId,
      claimId,
      dateFrom,
      dateTo,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.ChequebookEntryWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (payeeId) {
      where.payeeId = payeeId;
    }

    if (claimId) {
      where.claimId = claimId;
    }

    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) {
        where.issueDate.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.issueDate.lte = new Date(dateTo);
      }
    }

    if (search) {
      where.OR = [
        { chequeNumber: { contains: search, mode: 'insensitive' } },
        { memo: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = [
      'createdAt',
      'issueDate',
      'dueDate',
      'amount',
      'status',
      'chequeNumber',
    ];
    const orderBy: Prisma.ChequebookEntryOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.chequebookEntry.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          payee: {
            select: { id: true, name: true, code: true },
          },
          claim: {
            select: { id: true, code: true, status: true },
          },
        },
      }),
      this.prisma.chequebookEntry.count({ where }),
    ]);

    // Transform data
    const transformedData = data.map((cheque) => this.transformCheque(cheque));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET CHEQUE SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const cheques = await this.prisma.chequebookEntry.findMany({
      select: {
        amount: true,
        status: true,
      },
    });

    const totalCheques = cheques.length;
    const totalAmount = cheques.reduce((sum, c) => sum + Number(c.amount), 0);

    // Count and sum by status
    const byStatus: Record<string, { count: number; amount: number }> = {};
    cheques.forEach((c) => {
      if (!byStatus[c.status]) {
        byStatus[c.status] = { count: 0, amount: 0 };
      }
      byStatus[c.status].count += 1;
      byStatus[c.status].amount += Number(c.amount);
    });

    return {
      totalCheques,
      totalAmount,
      issuedCount: byStatus['ISSUED']?.count || 0,
      issuedAmount: byStatus['ISSUED']?.amount || 0,
      clearedCount: byStatus['CLEARED']?.count || 0,
      clearedAmount: byStatus['CLEARED']?.amount || 0,
      bouncedCount: byStatus['BOUNCED']?.count || 0,
      bouncedAmount: byStatus['BOUNCED']?.amount || 0,
      voidedCount: byStatus['VOIDED']?.count || 0,
      voidedAmount: byStatus['VOIDED']?.amount || 0,
      expiredCount: byStatus['EXPIRED']?.count || 0,
      expiredAmount: byStatus['EXPIRED']?.amount || 0,
      byStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET EXPIRING CHEQUES (due within 7 days)
  // ═══════════════════════════════════════════════════════════════════════════
  async getExpiring() {
    const now = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(now.getDate() + 7);

    const data = await this.prisma.chequebookEntry.findMany({
      where: {
        status: 'ISSUED',
        dueDate: {
          gte: now,
          lte: sevenDaysFromNow,
        },
      },
      orderBy: { dueDate: 'asc' },
      include: {
        payee: {
          select: { id: true, name: true, code: true },
        },
        claim: {
          select: { id: true, code: true, status: true },
        },
      },
    });

    return data.map((cheque) => this.transformCheque(cheque));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE CHEQUE
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const cheque = await this.prisma.chequebookEntry.findUnique({
      where: { id },
      include: {
        payee: {
          select: { id: true, name: true, code: true, channel: true, address: true },
        },
        claim: true,
      },
    });

    if (!cheque) {
      throw new NotFoundException(`Cheque with ID ${id} not found`);
    }

    return this.transformChequeDetail(cheque);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE CHEQUE
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateChequeDto) {
    // Validate payee exists
    const payee = await this.prisma.customer.findUnique({
      where: { id: dto.payeeId },
    });

    if (!payee) {
      throw new BadRequestException(`Payee (Customer) with ID ${dto.payeeId} not found`);
    }

    // Validate claim exists if provided
    if (dto.claimId) {
      const claim = await this.prisma.claim.findUnique({
        where: { id: dto.claimId },
      });

      if (!claim) {
        throw new BadRequestException(`Claim with ID ${dto.claimId} not found`);
      }
    }

    // Check chequeNumber uniqueness (Prisma will also enforce, but give a better message)
    const existing = await this.prisma.chequebookEntry.findUnique({
      where: { chequeNumber: dto.chequeNumber },
    });

    if (existing) {
      throw new BadRequestException(`Cheque number ${dto.chequeNumber} already exists`);
    }

    const cheque = await this.prisma.chequebookEntry.create({
      data: {
        chequeNumber: dto.chequeNumber,
        payeeId: dto.payeeId,
        amount: dto.amount,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        status: 'ISSUED',
        claimId: dto.claimId || null,
        bankAccount: dto.bankAccount || null,
        memo: dto.memo || null,
      },
      include: {
        payee: {
          select: { id: true, name: true, code: true },
        },
        claim: {
          select: { id: true, code: true, status: true },
        },
      },
    });

    this.logger.log(`Cheque created: ${cheque.chequeNumber}`);

    return this.transformCheque(cheque);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE CHEQUE (only ISSUED status)
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateChequeDto) {
    const cheque = await this.prisma.chequebookEntry.findUnique({ where: { id } });

    if (!cheque) {
      throw new NotFoundException(`Cheque with ID ${id} not found`);
    }

    if (cheque.status !== 'ISSUED') {
      throw new BadRequestException(
        `Cannot update cheque in ${cheque.status} status. Only ISSUED cheques can be modified.`,
      );
    }

    // Validate payee if changing
    if (dto.payeeId) {
      const payee = await this.prisma.customer.findUnique({
        where: { id: dto.payeeId },
      });
      if (!payee) {
        throw new BadRequestException(`Payee (Customer) with ID ${dto.payeeId} not found`);
      }
    }

    // Validate claim if changing
    if (dto.claimId) {
      const claim = await this.prisma.claim.findUnique({
        where: { id: dto.claimId },
      });
      if (!claim) {
        throw new BadRequestException(`Claim with ID ${dto.claimId} not found`);
      }
    }

    const updated = await this.prisma.chequebookEntry.update({
      where: { id },
      data: {
        payeeId: dto.payeeId,
        amount: dto.amount,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        claimId: dto.claimId,
        bankAccount: dto.bankAccount,
        memo: dto.memo,
      },
      include: {
        payee: {
          select: { id: true, name: true, code: true },
        },
        claim: {
          select: { id: true, code: true, status: true },
        },
      },
    });

    this.logger.log(`Cheque updated: ${updated.chequeNumber}`);

    return this.transformCheque(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEAR CHEQUE (set CLEARED, set clearedAt)
  // ═══════════════════════════════════════════════════════════════════════════
  async clear(id: string) {
    const cheque = await this.prisma.chequebookEntry.findUnique({ where: { id } });

    if (!cheque) {
      throw new NotFoundException(`Cheque with ID ${id} not found`);
    }

    if (cheque.status !== 'ISSUED') {
      throw new BadRequestException(
        `Only ISSUED cheques can be cleared. Current status: ${cheque.status}`,
      );
    }

    const updated = await this.prisma.chequebookEntry.update({
      where: { id },
      data: {
        status: 'CLEARED',
        clearedAt: new Date(),
      },
      include: {
        payee: {
          select: { id: true, name: true, code: true },
        },
        claim: {
          select: { id: true, code: true, status: true },
        },
      },
    });

    this.logger.log(`Cheque cleared: ${updated.chequeNumber}`);

    return this.transformCheque(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOUNCE CHEQUE (set BOUNCED, only from ISSUED)
  // ═══════════════════════════════════════════════════════════════════════════
  async bounce(id: string) {
    const cheque = await this.prisma.chequebookEntry.findUnique({ where: { id } });

    if (!cheque) {
      throw new NotFoundException(`Cheque with ID ${id} not found`);
    }

    if (cheque.status !== 'ISSUED') {
      throw new BadRequestException(
        `Only ISSUED cheques can be bounced. Current status: ${cheque.status}`,
      );
    }

    const updated = await this.prisma.chequebookEntry.update({
      where: { id },
      data: {
        status: 'BOUNCED',
      },
      include: {
        payee: {
          select: { id: true, name: true, code: true },
        },
        claim: {
          select: { id: true, code: true, status: true },
        },
      },
    });

    this.logger.log(`Cheque bounced: ${updated.chequeNumber}`);

    return this.transformCheque(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VOID CHEQUE (set VOIDED, require voidReason, only from ISSUED or BOUNCED)
  // ═══════════════════════════════════════════════════════════════════════════
  async void(id: string, dto: VoidChequeDto) {
    const cheque = await this.prisma.chequebookEntry.findUnique({ where: { id } });

    if (!cheque) {
      throw new NotFoundException(`Cheque with ID ${id} not found`);
    }

    if (cheque.status !== 'ISSUED' && cheque.status !== 'BOUNCED') {
      throw new BadRequestException(
        `Only ISSUED or BOUNCED cheques can be voided. Current status: ${cheque.status}`,
      );
    }

    const updated = await this.prisma.chequebookEntry.update({
      where: { id },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidReason: dto.voidReason,
      },
      include: {
        payee: {
          select: { id: true, name: true, code: true },
        },
        claim: {
          select: { id: true, code: true, status: true },
        },
      },
    });

    this.logger.log(`Cheque voided: ${updated.chequeNumber}, reason: ${dto.voidReason}`);

    return this.transformCheque(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Cheque for Response (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformCheque(cheque: any) {
    return {
      id: cheque.id,
      chequeNumber: cheque.chequeNumber,
      payeeId: cheque.payeeId,
      payee: cheque.payee || null,
      amount: Number(cheque.amount),
      issueDate: cheque.issueDate,
      dueDate: cheque.dueDate,
      status: cheque.status,
      clearedAt: cheque.clearedAt,
      voidedAt: cheque.voidedAt,
      voidReason: cheque.voidReason,
      claimId: cheque.claimId,
      claim: cheque.claim || null,
      bankAccount: cheque.bankAccount,
      memo: cheque.memo,
      createdAt: cheque.createdAt,
      updatedAt: cheque.updatedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Cheque Detail for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformChequeDetail(cheque: any) {
    return {
      id: cheque.id,
      chequeNumber: cheque.chequeNumber,
      payeeId: cheque.payeeId,
      payee: cheque.payee || null,
      amount: Number(cheque.amount),
      issueDate: cheque.issueDate,
      dueDate: cheque.dueDate,
      status: cheque.status,
      clearedAt: cheque.clearedAt,
      voidedAt: cheque.voidedAt,
      voidReason: cheque.voidReason,
      claimId: cheque.claimId,
      claim: cheque.claim
        ? {
            ...cheque.claim,
            amount: cheque.claim.amount ? Number(cheque.claim.amount) : null,
          }
        : null,
      bankAccount: cheque.bankAccount,
      memo: cheque.memo,
      createdAt: cheque.createdAt,
      updatedAt: cheque.updatedAt,
    };
  }
}
