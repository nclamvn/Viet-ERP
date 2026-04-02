import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AccrualQueryDto } from './dto/accrual-query.dto';
import { CreateAccrualDto } from './dto/create-accrual.dto';
import { JournalQueryDto } from './dto/journal-query.dto';
import { CreateJournalDto } from './dto/create-journal.dto';
import { CreateGLAccountDto } from './dto/create-gl-account.dto';
import { UpdateAccrualConfigDto } from './dto/update-accrual-config.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCRUALS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── LIST ACCRUALS ──────────────────────────────────────────────────────────
  async findAllAccruals(query: AccrualQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      companyId,
      promotionId,
      status,
      entryType,
      fiscalPeriodId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.AccrualEntryWhereInput = {};

    if (companyId) where.companyId = companyId;
    if (promotionId) where.promotionId = promotionId;
    if (status) where.status = status;
    if (entryType) where.entryType = entryType;
    if (fiscalPeriodId) where.fiscalPeriodId = fiscalPeriodId;

    const validSortFields = ['createdAt', 'entryDate', 'amount', 'status'];
    const orderBy: Prisma.AccrualEntryOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.accrualEntry.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          promotion: { select: { id: true, name: true, code: true } },
          fiscalPeriod: { select: { id: true, name: true, year: true, month: true } },
          createdBy: { select: { id: true, name: true } },
          postedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.accrualEntry.count({ where }),
    ]);

    const transformedData = data.map((a) => this.transformAccrual(a));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ── GET ACCRUAL BY ID ──────────────────────────────────────────────────────
  async findOneAccrual(id: string) {
    const accrual = await this.prisma.accrualEntry.findUnique({
      where: { id },
      include: {
        promotion: { select: { id: true, name: true, code: true } },
        tactic: { select: { id: true, type: true, mechanic: true } },
        fiscalPeriod: { select: { id: true, name: true, year: true, month: true } },
        glJournal: {
          include: {
            lines: true,
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        postedBy: { select: { id: true, name: true } },
        reversedEntry: { select: { id: true, entryType: true, amount: true } },
        reversals: { select: { id: true, entryType: true, amount: true } },
      },
    });

    if (!accrual) {
      throw new NotFoundException(`Accrual entry with ID ${id} not found`);
    }

    return this.transformAccrualDetail(accrual);
  }

  // ── CREATE ACCRUAL ─────────────────────────────────────────────────────────
  async createAccrual(dto: CreateAccrualDto, userId: string) {
    const accrual = await this.prisma.accrualEntry.create({
      data: {
        companyId: dto.companyId,
        promotionId: dto.promotionId,
        tacticId: dto.tacticId,
        fiscalPeriodId: dto.fiscalPeriodId,
        entryType: dto.entryType,
        entryDate: new Date(dto.entryDate),
        amount: dto.amount,
        cumulativeAmount: dto.cumulativeAmount,
        calculationMethod: dto.calculationMethod || 'TIME_BASED',
        calculationBasis: dto.calculationBasis,
        notes: dto.notes,
        status: 'PENDING',
        createdById: userId,
      },
      include: {
        promotion: { select: { id: true, name: true, code: true } },
        fiscalPeriod: { select: { id: true, name: true, year: true, month: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Accrual entry created: ${accrual.id} for promotion ${dto.promotionId}`);

    return this.transformAccrual(accrual);
  }

  // ── POST ACCRUAL TO GL ─────────────────────────────────────────────────────
  async postAccrual(id: string, userId: string) {
    const accrual = await this.prisma.accrualEntry.findUnique({ where: { id } });

    if (!accrual) {
      throw new NotFoundException(`Accrual entry with ID ${id} not found`);
    }

    if (accrual.status !== 'PENDING') {
      throw new BadRequestException(
        `Accrual must be in PENDING status to post. Current status: ${accrual.status}`,
      );
    }

    const updated = await this.prisma.accrualEntry.update({
      where: { id },
      data: {
        status: 'POSTED',
        postedAt: new Date(),
        postedById: userId,
      },
      include: {
        promotion: { select: { id: true, name: true, code: true } },
        fiscalPeriod: { select: { id: true, name: true, year: true, month: true } },
        createdBy: { select: { id: true, name: true } },
        postedBy: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Accrual entry posted: ${id} by user ${userId}`);

    return this.transformAccrual(updated);
  }

  // ── REVERSE ACCRUAL ────────────────────────────────────────────────────────
  async reverseAccrual(id: string, userId: string) {
    const accrual = await this.prisma.accrualEntry.findUnique({ where: { id } });

    if (!accrual) {
      throw new NotFoundException(`Accrual entry with ID ${id} not found`);
    }

    if (accrual.status !== 'POSTED') {
      throw new BadRequestException(
        `Accrual must be in POSTED status to reverse. Current status: ${accrual.status}`,
      );
    }

    // Create reversal entry
    const reversalEntry = await this.prisma.accrualEntry.create({
      data: {
        companyId: accrual.companyId,
        promotionId: accrual.promotionId,
        tacticId: accrual.tacticId,
        fiscalPeriodId: accrual.fiscalPeriodId,
        entryType: 'REVERSAL',
        entryDate: new Date(),
        amount: accrual.amount,
        cumulativeAmount: accrual.cumulativeAmount,
        calculationMethod: accrual.calculationMethod,
        calculationBasis: accrual.calculationBasis as any,
        isReversal: true,
        reversedEntryId: accrual.id,
        status: 'POSTED',
        postedAt: new Date(),
        postedById: userId,
        notes: `Reversal of accrual ${accrual.id}`,
        createdById: userId,
      },
      include: {
        promotion: { select: { id: true, name: true, code: true } },
        fiscalPeriod: { select: { id: true, name: true, year: true, month: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    // Mark original as reversed
    await this.prisma.accrualEntry.update({
      where: { id },
      data: { status: 'REVERSED' },
    });

    this.logger.log(`Accrual entry reversed: ${id} by user ${userId}`);

    return this.transformAccrual(reversalEntry);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GL JOURNALS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── LIST JOURNALS ──────────────────────────────────────────────────────────
  async findAllJournals(query: JournalQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      status,
      source,
      fiscalPeriodId,
      companyId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.GLJournalWhereInput = {};

    if (status) where.status = status;
    if (source) where.source = source;
    if (fiscalPeriodId) where.fiscalPeriodId = fiscalPeriodId;
    if (companyId) where.companyId = companyId;

    const validSortFields = ['createdAt', 'journalDate', 'journalNumber', 'totalDebit'];
    const orderBy: Prisma.GLJournalOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.gLJournal.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          fiscalPeriod: { select: { id: true, name: true, year: true, month: true } },
          createdBy: { select: { id: true, name: true } },
          postedBy: { select: { id: true, name: true } },
          _count: { select: { lines: true, accrualEntries: true } },
        },
      }),
      this.prisma.gLJournal.count({ where }),
    ]);

    const transformedData = data.map((j) => this.transformJournal(j));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ── GET JOURNAL BY ID ──────────────────────────────────────────────────────
  async findOneJournal(id: string) {
    const journal = await this.prisma.gLJournal.findUnique({
      where: { id },
      include: {
        fiscalPeriod: { select: { id: true, name: true, year: true, month: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        postedBy: { select: { id: true, name: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
        },
        accrualEntries: {
          select: { id: true, entryType: true, amount: true, status: true },
        },
        _count: { select: { lines: true, accrualEntries: true } },
      },
    });

    if (!journal) {
      throw new NotFoundException(`Journal with ID ${id} not found`);
    }

    return this.transformJournalDetail(journal);
  }

  // ── CREATE JOURNAL WITH LINES ──────────────────────────────────────────────
  async createJournal(dto: CreateJournalDto, userId: string) {
    // Validate debits equal credits
    if (dto.totalDebit !== dto.totalCredit) {
      throw new BadRequestException('Total debit must equal total credit');
    }

    const journal = await this.prisma.gLJournal.create({
      data: {
        companyId: dto.companyId,
        journalNumber: dto.journalNumber,
        journalDate: new Date(dto.journalDate),
        fiscalPeriodId: dto.fiscalPeriodId,
        description: dto.description,
        source: dto.source,
        sourceRef: dto.sourceRef,
        totalDebit: dto.totalDebit,
        totalCredit: dto.totalCredit,
        status: 'DRAFT',
        createdById: userId,
        lines: {
          create: dto.lines.map((line) => ({
            lineNumber: line.lineNumber,
            accountCode: line.accountCode,
            accountName: line.accountName,
            debitAmount: line.debitAmount,
            creditAmount: line.creditAmount,
            costCenter: line.costCenter,
            profitCenter: line.profitCenter,
            customerId: line.customerId,
            productId: line.productId,
            brandCode: line.brandCode,
            channelCode: line.channelCode,
            description: line.description,
          })),
        },
      },
      include: {
        fiscalPeriod: { select: { id: true, name: true, year: true, month: true } },
        createdBy: { select: { id: true, name: true } },
        lines: { orderBy: { lineNumber: 'asc' } },
        _count: { select: { lines: true, accrualEntries: true } },
      },
    });

    this.logger.log(`Journal created: ${journal.journalNumber} by user ${userId}`);

    return this.transformJournalDetail(journal);
  }

  // ── POST JOURNAL ───────────────────────────────────────────────────────────
  async postJournal(id: string, userId: string) {
    const journal = await this.prisma.gLJournal.findUnique({ where: { id } });

    if (!journal) {
      throw new NotFoundException(`Journal with ID ${id} not found`);
    }

    if (journal.status !== 'DRAFT' && journal.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Journal must be in DRAFT or PENDING_APPROVAL status to post. Current status: ${journal.status}`,
      );
    }

    const updated = await this.prisma.gLJournal.update({
      where: { id },
      data: {
        status: 'POSTED',
        postedAt: new Date(),
        postedById: userId,
      },
      include: {
        fiscalPeriod: { select: { id: true, name: true, year: true, month: true } },
        createdBy: { select: { id: true, name: true } },
        postedBy: { select: { id: true, name: true } },
        _count: { select: { lines: true, accrualEntries: true } },
      },
    });

    this.logger.log(`Journal posted: ${updated.journalNumber} by user ${userId}`);

    return this.transformJournal(updated);
  }

  // ── REVERSE JOURNAL ────────────────────────────────────────────────────────
  async reverseJournal(id: string, userId: string) {
    const journal = await this.prisma.gLJournal.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!journal) {
      throw new NotFoundException(`Journal with ID ${id} not found`);
    }

    if (journal.status !== 'POSTED') {
      throw new BadRequestException(
        `Journal must be in POSTED status to reverse. Current status: ${journal.status}`,
      );
    }

    // Create reversal journal with swapped debit/credit
    const reversalNumber = `REV-${journal.journalNumber}`;

    const reversal = await this.prisma.gLJournal.create({
      data: {
        companyId: journal.companyId,
        journalNumber: reversalNumber,
        journalDate: new Date(),
        fiscalPeriodId: journal.fiscalPeriodId,
        description: `Reversal of ${journal.journalNumber}: ${journal.description}`,
        source: 'REVERSAL',
        sourceRef: journal.id,
        totalDebit: journal.totalCredit,
        totalCredit: journal.totalDebit,
        status: 'POSTED',
        postedAt: new Date(),
        postedById: userId,
        createdById: userId,
        lines: {
          create: journal.lines.map((line) => ({
            lineNumber: line.lineNumber,
            accountCode: line.accountCode,
            accountName: line.accountName,
            debitAmount: line.creditAmount,
            creditAmount: line.debitAmount,
            costCenter: line.costCenter,
            profitCenter: line.profitCenter,
            customerId: line.customerId,
            productId: line.productId,
            brandCode: line.brandCode,
            channelCode: line.channelCode,
            description: `Reversal: ${line.description || ''}`,
          })),
        },
      },
      include: {
        fiscalPeriod: { select: { id: true, name: true, year: true, month: true } },
        createdBy: { select: { id: true, name: true } },
        lines: { orderBy: { lineNumber: 'asc' } },
        _count: { select: { lines: true, accrualEntries: true } },
      },
    });

    // Mark original as reversed
    await this.prisma.gLJournal.update({
      where: { id },
      data: { status: 'REVERSED' },
    });

    this.logger.log(`Journal reversed: ${journal.journalNumber} by user ${userId}`);

    return this.transformJournalDetail(reversal);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GL ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── LIST GL ACCOUNTS ───────────────────────────────────────────────────────
  async findAllAccounts(companyId?: string) {
    const where: Prisma.GLAccountWhereInput = {};
    if (companyId) where.companyId = companyId;

    const accounts = await this.prisma.gLAccount.findMany({
      where,
      orderBy: { code: 'asc' },
    });

    return accounts;
  }

  // ── CREATE GL ACCOUNT ──────────────────────────────────────────────────────
  async createAccount(dto: CreateGLAccountDto) {
    const account = await this.prisma.gLAccount.create({
      data: {
        companyId: dto.companyId,
        code: dto.code,
        name: dto.name,
        type: dto.type,
        category: dto.category,
        isActive: dto.isActive ?? true,
        isDefaultTradeExpense: dto.isDefaultTradeExpense ?? false,
        isDefaultAccruedLiability: dto.isDefaultAccruedLiability ?? false,
      },
    });

    this.logger.log(`GL Account created: ${account.code} - ${account.name}`);

    return account;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY & CONFIG
  // ═══════════════════════════════════════════════════════════════════════════

  // ── RECONCILIATION SUMMARY ─────────────────────────────────────────────────
  async getSummary(companyId?: string) {
    const accrualWhere: Prisma.AccrualEntryWhereInput = {};
    if (companyId) accrualWhere.companyId = companyId;

    const [accrualsByStatus, journalsByStatus, totalAccounts] = await Promise.all([
      this.prisma.accrualEntry.groupBy({
        by: ['status'],
        where: accrualWhere,
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.gLJournal.groupBy({
        by: ['status'],
        where: companyId ? { companyId } : {},
        _count: { id: true },
        _sum: { totalDebit: true },
      }),
      this.prisma.gLAccount.count({
        where: companyId ? { companyId } : {},
      }),
    ]);

    const accrualSummary: Record<string, { count: number; total: number }> = {};
    let totalAccrued = 0;
    let totalPosted = 0;
    let totalReversed = 0;

    accrualsByStatus.forEach((s) => {
      const amount = Number(s._sum.amount || 0);
      accrualSummary[s.status] = { count: s._count.id, total: amount };
      if (s.status === 'PENDING') totalAccrued += amount;
      if (s.status === 'POSTED') totalPosted += amount;
      if (s.status === 'REVERSED') totalReversed += amount;
    });

    const journalSummary: Record<string, { count: number; total: number }> = {};
    journalsByStatus.forEach((s) => {
      journalSummary[s.status] = {
        count: s._count.id,
        total: Number(s._sum.totalDebit || 0),
      };
    });

    return {
      totalAccrued,
      totalPosted,
      totalReversed,
      accrualsByStatus: accrualSummary,
      journalsByStatus: journalSummary,
      totalAccounts,
    };
  }

  // ── GET ACCRUAL CONFIG ─────────────────────────────────────────────────────
  async getConfig(companyId: string) {
    const config = await this.prisma.accrualConfig.findUnique({
      where: { companyId },
    });

    if (!config) {
      throw new NotFoundException(`Accrual config not found for company ${companyId}`);
    }

    return this.transformConfig(config);
  }

  // ── UPDATE ACCRUAL CONFIG ──────────────────────────────────────────────────
  async updateConfig(dto: UpdateAccrualConfigDto) {
    if (!dto.companyId) {
      throw new BadRequestException('companyId is required');
    }

    const config = await this.prisma.accrualConfig.upsert({
      where: { companyId: dto.companyId },
      update: {
        tradeExpenseAccount: dto.tradeExpenseAccount,
        accruedLiabilityAccount: dto.accruedLiabilityAccount,
        defaultCalculationMethod: dto.defaultCalculationMethod,
        accrualFrequency: dto.accrualFrequency,
        autoCalculate: dto.autoCalculate,
        autoPost: dto.autoPost,
        minAccrualAmount: dto.minAccrualAmount,
        varianceThresholdPercent: dto.varianceThresholdPercent,
        allowBackdatedEntries: dto.allowBackdatedEntries,
        gracePeriodDays: dto.gracePeriodDays,
      },
      create: {
        companyId: dto.companyId,
        tradeExpenseAccount: dto.tradeExpenseAccount || '6100',
        accruedLiabilityAccount: dto.accruedLiabilityAccount || '2100',
        defaultCalculationMethod: dto.defaultCalculationMethod || 'TIME_BASED',
        accrualFrequency: dto.accrualFrequency || 'MONTHLY',
        autoCalculate: dto.autoCalculate ?? true,
        autoPost: dto.autoPost ?? false,
        minAccrualAmount: dto.minAccrualAmount ?? 0,
        varianceThresholdPercent: dto.varianceThresholdPercent ?? 10,
        allowBackdatedEntries: dto.allowBackdatedEntries ?? false,
        gracePeriodDays: dto.gracePeriodDays ?? 5,
      },
    });

    this.logger.log(`Accrual config updated for company ${dto.companyId}`);

    return this.transformConfig(config);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private transformAccrual(accrual: any) {
    return {
      id: accrual.id,
      companyId: accrual.companyId,
      promotionId: accrual.promotionId,
      promotion: accrual.promotion,
      tacticId: accrual.tacticId,
      fiscalPeriodId: accrual.fiscalPeriodId,
      fiscalPeriod: accrual.fiscalPeriod,
      entryType: accrual.entryType,
      entryDate: accrual.entryDate,
      amount: Number(accrual.amount),
      cumulativeAmount: Number(accrual.cumulativeAmount),
      calculationMethod: accrual.calculationMethod,
      calculationBasis: accrual.calculationBasis,
      glJournalId: accrual.glJournalId,
      status: accrual.status,
      postedAt: accrual.postedAt,
      postedBy: accrual.postedBy,
      isReversal: accrual.isReversal,
      reversedEntryId: accrual.reversedEntryId,
      notes: accrual.notes,
      createdById: accrual.createdById,
      createdBy: accrual.createdBy,
      createdAt: accrual.createdAt,
    };
  }

  private transformAccrualDetail(accrual: any) {
    const base = this.transformAccrual(accrual);

    return {
      ...base,
      tactic: accrual.tactic,
      glJournal: accrual.glJournal ? this.transformJournalDetail(accrual.glJournal) : null,
      reversedEntry: accrual.reversedEntry
        ? { ...accrual.reversedEntry, amount: Number(accrual.reversedEntry.amount) }
        : null,
      reversals: (accrual.reversals || []).map((r: any) => ({
        ...r,
        amount: Number(r.amount),
      })),
    };
  }

  private transformJournal(journal: any) {
    return {
      id: journal.id,
      companyId: journal.companyId,
      journalNumber: journal.journalNumber,
      journalDate: journal.journalDate,
      fiscalPeriodId: journal.fiscalPeriodId,
      fiscalPeriod: journal.fiscalPeriod,
      description: journal.description,
      source: journal.source,
      sourceRef: journal.sourceRef,
      status: journal.status,
      postedAt: journal.postedAt,
      postedBy: journal.postedBy,
      totalDebit: Number(journal.totalDebit),
      totalCredit: Number(journal.totalCredit),
      erpExported: journal.erpExported,
      erpExportedAt: journal.erpExportedAt,
      erpReference: journal.erpReference,
      createdById: journal.createdById,
      createdBy: journal.createdBy,
      lineCount: journal._count?.lines || 0,
      accrualEntryCount: journal._count?.accrualEntries || 0,
      createdAt: journal.createdAt,
    };
  }

  private transformJournalDetail(journal: any) {
    const base = this.transformJournal(journal);

    return {
      ...base,
      lines: (journal.lines || []).map((line: any) => ({
        id: line.id,
        journalId: line.journalId,
        lineNumber: line.lineNumber,
        accountCode: line.accountCode,
        accountName: line.accountName,
        debitAmount: Number(line.debitAmount),
        creditAmount: Number(line.creditAmount),
        costCenter: line.costCenter,
        profitCenter: line.profitCenter,
        customerId: line.customerId,
        productId: line.productId,
        brandCode: line.brandCode,
        channelCode: line.channelCode,
        description: line.description,
      })),
      accrualEntries: (journal.accrualEntries || []).map((a: any) => ({
        ...a,
        amount: Number(a.amount),
      })),
    };
  }

  private transformConfig(config: any) {
    return {
      id: config.id,
      companyId: config.companyId,
      tradeExpenseAccount: config.tradeExpenseAccount,
      accruedLiabilityAccount: config.accruedLiabilityAccount,
      defaultCalculationMethod: config.defaultCalculationMethod,
      accrualFrequency: config.accrualFrequency,
      autoCalculate: config.autoCalculate,
      autoPost: config.autoPost,
      minAccrualAmount: Number(config.minAccrualAmount),
      varianceThresholdPercent: Number(config.varianceThresholdPercent),
      allowBackdatedEntries: config.allowBackdatedEntries,
      gracePeriodDays: config.gracePeriodDays,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }
}
