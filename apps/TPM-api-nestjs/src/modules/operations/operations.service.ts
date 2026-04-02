import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';
import { ImportQueryDto } from './dto/import-query.dto';
import { CreateImportDto } from './dto/create-import.dto';
import { FiscalPeriodQueryDto } from './dto/fiscal-period-query.dto';
import { CreateFiscalPeriodDto } from './dto/create-fiscal-period.dto';
import { OpsSyncJobQueryDto } from './dto/sync-job-query.dto';

@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORT BATCHES - LIST
  // ═══════════════════════════════════════════════════════════════════════════
  async findAllImports(query: ImportQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { companyId, status, source, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const where: Prisma.DeductionImportBatchWhereInput = {};
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (source) where.source = source;

    const validSortFields = ['createdAt', 'status', 'totalRecords', 'source'];
    const orderBy: Prisma.DeductionImportBatchOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.deductionImportBatch.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.deductionImportBatch.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORT BATCHES - GET BY ID
  // ═══════════════════════════════════════════════════════════════════════════
  async findOneImport(id: string) {
    const batch = await this.prisma.deductionImportBatch.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        company: { select: { id: true, name: true, code: true } },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Import batch with ID ${id} not found`);
    }

    return batch;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORT BATCHES - CREATE
  // ═══════════════════════════════════════════════════════════════════════════
  async createImport(dto: CreateImportDto, userId: string) {
    const batch = await this.prisma.deductionImportBatch.create({
      data: {
        companyId: dto.companyId,
        source: dto.source,
        fileName: dto.fileName,
        filePath: dto.filePath,
        totalRecords: dto.totalRecords,
        errors: dto.errors,
        createdById: userId,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    this.logger.log(`Import batch created: ${batch.id} by user ${userId}`);

    return batch;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORT BATCHES - PROCESS
  // ═══════════════════════════════════════════════════════════════════════════
  async processImport(id: string) {
    const batch = await this.prisma.deductionImportBatch.findUnique({ where: { id } });

    if (!batch) {
      throw new NotFoundException(`Import batch with ID ${id} not found`);
    }

    if (batch.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot process batch in ${batch.status} status. Only PENDING batches can be processed.`,
      );
    }

    const updated = await this.prisma.deductionImportBatch.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    this.logger.log(`Import batch processing started: ${id}`);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FISCAL PERIODS - LIST
  // ═══════════════════════════════════════════════════════════════════════════
  async findAllFiscalPeriods(query: FiscalPeriodQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { companyId, status, year, quarter, sortBy = 'startDate', sortOrder = 'desc' } = query;

    const where: Prisma.FiscalPeriodWhereInput = {};
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (year) where.year = year;
    if (quarter) where.quarter = quarter;

    const validSortFields = ['startDate', 'endDate', 'year', 'month', 'status', 'createdAt'];
    const orderBy: Prisma.FiscalPeriodOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { startDate: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.fiscalPeriod.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          closedBy: { select: { id: true, name: true, email: true } },
          _count: { select: { accrualEntries: true, glJournals: true } },
        },
      }),
      this.prisma.fiscalPeriod.count({ where }),
    ]);

    const transformedData = data.map((p) => this.transformFiscalPeriod(p));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FISCAL PERIODS - GET BY ID
  // ═══════════════════════════════════════════════════════════════════════════
  async findOneFiscalPeriod(id: string) {
    const period = await this.prisma.fiscalPeriod.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        closedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { accrualEntries: true, glJournals: true } },
      },
    });

    if (!period) {
      throw new NotFoundException(`Fiscal period with ID ${id} not found`);
    }

    return this.transformFiscalPeriod(period);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FISCAL PERIODS - CREATE
  // ═══════════════════════════════════════════════════════════════════════════
  async createFiscalPeriod(dto: CreateFiscalPeriodDto) {
    const period = await this.prisma.fiscalPeriod.create({
      data: {
        companyId: dto.companyId,
        year: dto.year,
        month: dto.month,
        quarter: dto.quarter,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
      include: {
        _count: { select: { accrualEntries: true, glJournals: true } },
      },
    });

    this.logger.log(`Fiscal period created: ${period.name}`);

    return this.transformFiscalPeriod(period);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FISCAL PERIODS - CLOSE
  // ═══════════════════════════════════════════════════════════════════════════
  async closeFiscalPeriod(
    id: string,
    userId: string,
    closeType: 'SOFT_CLOSE' | 'HARD_CLOSE' = 'SOFT_CLOSE',
  ) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id } });

    if (!period) {
      throw new NotFoundException(`Fiscal period with ID ${id} not found`);
    }

    if (period.status === 'HARD_CLOSE') {
      throw new BadRequestException('Period is already hard-closed and cannot be modified.');
    }

    if (period.status === 'SOFT_CLOSE' && closeType === 'SOFT_CLOSE') {
      throw new BadRequestException('Period is already soft-closed.');
    }

    const updated = await this.prisma.fiscalPeriod.update({
      where: { id },
      data: {
        status: closeType,
        closedAt: new Date(),
        closedById: userId,
      },
      include: {
        closedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { accrualEntries: true, glJournals: true } },
      },
    });

    this.logger.log(`Fiscal period closed: ${period.name} (${closeType}) by user ${userId}`);

    return this.transformFiscalPeriod(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FISCAL PERIODS - REOPEN
  // ═══════════════════════════════════════════════════════════════════════════
  async reopenFiscalPeriod(id: string, userId: string) {
    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id } });

    if (!period) {
      throw new NotFoundException(`Fiscal period with ID ${id} not found`);
    }

    if (period.status === 'OPEN') {
      throw new BadRequestException('Period is already open.');
    }

    if (period.status === 'HARD_CLOSE') {
      throw new BadRequestException(
        'Cannot reopen a hard-closed period. Only SOFT_CLOSE periods can be reopened.',
      );
    }

    const updated = await this.prisma.fiscalPeriod.update({
      where: { id },
      data: {
        status: 'OPEN',
        closedAt: null,
        closedById: null,
      },
      include: {
        _count: { select: { accrualEntries: true, glJournals: true } },
      },
    });

    this.logger.log(`Fiscal period reopened: ${period.name} by user ${userId}`);

    return this.transformFiscalPeriod(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC JOBS - LIST (read-only view)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAllSyncJobs(query: OpsSyncJobQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { connectionId, status } = query;

    const where: Prisma.SyncJobWhereInput = {};
    if (connectionId) where.connectionId = connectionId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.syncJob.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          connection: { select: { id: true, name: true, erpType: true } },
          config: { select: { id: true, entityType: true, direction: true } },
        },
      }),
      this.prisma.syncJob.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC JOBS - SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSyncJobSummary() {
    const jobs = await this.prisma.syncJob.findMany({
      select: {
        status: true,
        totalRecords: true,
        processedRecords: true,
        successRecords: true,
        failedRecords: true,
        skippedRecords: true,
      },
    });

    const totalJobs = jobs.length;
    const byStatus: Record<
      string,
      {
        count: number;
        totalRecords: number;
        processedRecords: number;
        successRecords: number;
        failedRecords: number;
      }
    > = {};

    jobs.forEach((j) => {
      if (!byStatus[j.status]) {
        byStatus[j.status] = {
          count: 0,
          totalRecords: 0,
          processedRecords: 0,
          successRecords: 0,
          failedRecords: 0,
        };
      }
      byStatus[j.status].count += 1;
      byStatus[j.status].totalRecords += j.totalRecords;
      byStatus[j.status].processedRecords += j.processedRecords;
      byStatus[j.status].successRecords += j.successRecords;
      byStatus[j.status].failedRecords += j.failedRecords;
    });

    return {
      totalJobs,
      pendingCount: byStatus['PENDING']?.count || 0,
      inProgressCount: byStatus['IN_PROGRESS']?.count || 0,
      completedCount: byStatus['COMPLETED']?.count || 0,
      failedCount: byStatus['FAILED']?.count || 0,
      partialCount: byStatus['PARTIAL']?.count || 0,
      cancelledCount: byStatus['CANCELLED']?.count || 0,
      byStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFORM HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  private transformFiscalPeriod(period: any) {
    return {
      id: period.id,
      companyId: period.companyId,
      company: period.company || null,
      year: period.year,
      month: period.month,
      quarter: period.quarter,
      name: period.name,
      startDate: period.startDate,
      endDate: period.endDate,
      status: period.status,
      closedAt: period.closedAt,
      closedById: period.closedById,
      closedBy: period.closedBy || null,
      totalAccrued: Number(period.totalAccrued),
      totalReversed: Number(period.totalReversed),
      totalSettled: Number(period.totalSettled),
      accrualEntryCount: period._count?.accrualEntries || 0,
      glJournalCount: period._count?.glJournals || 0,
      createdAt: period.createdAt,
      updatedAt: period.updatedAt,
    };
  }
}
