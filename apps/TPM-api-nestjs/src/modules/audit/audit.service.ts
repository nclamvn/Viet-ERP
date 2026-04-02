import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditQueryDto, AuditActionEnum } from './dto/audit-query.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';
import { createHash } from 'crypto';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST AUDIT LOGS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: AuditQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      action,
      entityType,
      entityId,
      userId,
      companyId,
      startDate,
      endDate,
      search,
      sortBy = 'timestamp',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.ImmutableAuditLogWhereInput = {};

    if (action) {
      where.action = action;
    }

    if (entityType) {
      where.entityType = entityType;
    }

    if (entityId) {
      where.entityId = entityId;
    }

    if (userId) {
      where.userId = userId;
    }

    if (companyId) {
      where.companyId = companyId;
    }

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) {
        where.timestamp.gte = new Date(startDate);
      }
      if (endDate) {
        where.timestamp.lte = new Date(endDate);
      }
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = ['timestamp', 'createdAt', 'action', 'entityType', 'sequenceNumber'];
    const orderBy: Prisma.ImmutableAuditLogOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { timestamp: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.immutableAuditLog.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          company: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.immutableAuditLog.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE AUDIT LOG
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const log = await this.prisma.immutableAuditLog.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        company: {
          select: { id: true, name: true },
        },
      },
    });

    if (!log) {
      throw new NotFoundException(`Audit log with ID ${id} not found`);
    }

    return log;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND AUDIT LOGS BY ENTITY
  // ═══════════════════════════════════════════════════════════════════════════
  async findByEntity(entityType: string, entityId: string) {
    const logs = await this.prisma.immutableAuditLog.findMany({
      where: {
        entityType,
        entityId,
      },
      orderBy: { timestamp: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        company: {
          select: { id: true, name: true },
        },
      },
    });

    return logs;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE AUDIT LOG (with hash chain computation)
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateAuditLogDto) {
    // Get the last entry for this company to compute sequence and hash chain
    const lastEntry = await this.prisma.immutableAuditLog.findFirst({
      where: { companyId: dto.companyId },
      orderBy: { sequenceNumber: 'desc' },
      select: { sequenceNumber: true, entryHash: true },
    });

    const sequenceNumber = lastEntry ? lastEntry.sequenceNumber + 1 : 1;
    const previousHash = lastEntry ? lastEntry.entryHash : undefined;

    // Compute the entry hash
    const entryHash = this.computeHash({
      action: dto.action,
      entityType: dto.entityType,
      entityId: dto.entityId,
      description: dto.description,
      sequenceNumber,
      previousHash,
    });

    const log = await this.prisma.immutableAuditLog.create({
      data: {
        companyId: dto.companyId,
        userId: dto.userId,
        action: dto.action,
        entityType: dto.entityType,
        entityId: dto.entityId,
        description: dto.description,
        oldValues: dto.oldValues ?? Prisma.JsonNull,
        newValues: dto.newValues ?? Prisma.JsonNull,
        metadata: dto.metadata ?? Prisma.JsonNull,
        sequenceNumber,
        previousHash: previousHash ?? null,
        entryHash,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        company: {
          select: { id: true, name: true },
        },
      },
    });

    this.logger.log(
      `Audit log created: [${dto.action}] ${dto.entityType}${dto.entityId ? `/${dto.entityId}` : ''} by user ${dto.userId} (seq: ${sequenceNumber})`,
    );

    return log;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SUMMARY (aggregate stats)
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    // Count by action
    const byAction = await this.prisma.immutableAuditLog.groupBy({
      by: ['action'],
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
    });

    // Count by entity type
    const byEntityType = await this.prisma.immutableAuditLog.groupBy({
      by: ['entityType'],
      _count: { entityType: true },
      orderBy: { _count: { entityType: 'desc' } },
    });

    // Count by user (top 10)
    const byUser = await this.prisma.immutableAuditLog.groupBy({
      by: ['userId'],
      _count: { userId: true },
      orderBy: { _count: { userId: 'desc' } },
      take: 10,
    });

    // Total count
    const totalLogs = await this.prisma.immutableAuditLog.count();

    // Date range
    const oldest = await this.prisma.immutableAuditLog.findFirst({
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true },
    });

    const newest = await this.prisma.immutableAuditLog.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    return {
      totalLogs,
      dateRange: {
        from: oldest?.timestamp ?? null,
        to: newest?.timestamp ?? null,
      },
      byAction: byAction.map((item) => ({
        action: item.action,
        count: item._count.action,
      })),
      byEntityType: byEntityType.map((item) => ({
        entityType: item.entityType,
        count: item._count.entityType,
      })),
      byUser: byUser.map((item) => ({
        userId: item.userId,
        count: item._count.userId,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET ACTIONS (list AuditAction enum values)
  // ═══════════════════════════════════════════════════════════════════════════
  getActions(): string[] {
    return Object.values(AuditActionEnum);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET ENTITY TYPES (distinct values from the database)
  // ═══════════════════════════════════════════════════════════════════════════
  async getEntityTypes(): Promise<string[]> {
    const results = await this.prisma.immutableAuditLog.findMany({
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
    });

    return results.map((r) => r.entityType);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE: Log a CREATE action
  // ═══════════════════════════════════════════════════════════════════════════
  async logCreate(
    companyId: string,
    userId: string,
    entityType: string,
    entityId: string,
    description: string,
    newValues?: Record<string, any>,
    metadata?: Record<string, any>,
  ) {
    return this.create({
      companyId,
      userId,
      action: AuditActionEnum.CREATE,
      entityType,
      entityId,
      description,
      newValues,
      metadata,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE: Log an UPDATE action
  // ═══════════════════════════════════════════════════════════════════════════
  async logUpdate(
    companyId: string,
    userId: string,
    entityType: string,
    entityId: string,
    description: string,
    oldValues?: Record<string, any>,
    newValues?: Record<string, any>,
    metadata?: Record<string, any>,
  ) {
    return this.create({
      companyId,
      userId,
      action: AuditActionEnum.UPDATE,
      entityType,
      entityId,
      description,
      oldValues,
      newValues,
      metadata,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE: Log a DELETE action
  // ═══════════════════════════════════════════════════════════════════════════
  async logDelete(
    companyId: string,
    userId: string,
    entityType: string,
    entityId: string,
    description: string,
    oldValues?: Record<string, any>,
    metadata?: Record<string, any>,
  ) {
    return this.create({
      companyId,
      userId,
      action: AuditActionEnum.DELETE,
      entityType,
      entityId,
      description,
      oldValues,
      metadata,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE: Log a STATUS CHANGE action
  // ═══════════════════════════════════════════════════════════════════════════
  async logStatusChange(
    companyId: string,
    userId: string,
    entityType: string,
    entityId: string,
    oldStatus: string,
    newStatus: string,
    metadata?: Record<string, any>,
  ) {
    return this.create({
      companyId,
      userId,
      action: AuditActionEnum.UPDATE,
      entityType,
      entityId,
      description: `${entityType} status changed from ${oldStatus} to ${newStatus}`,
      oldValues: { status: oldStatus },
      newValues: { status: newStatus },
      metadata,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE: Log a LOGIN action
  // ═══════════════════════════════════════════════════════════════════════════
  async logLogin(companyId: string, userId: string, metadata?: Record<string, any>) {
    return this.create({
      companyId,
      userId,
      action: AuditActionEnum.LOGIN,
      entityType: 'User',
      entityId: userId,
      description: `User logged in`,
      metadata,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: Compute SHA-256 hash for chain integrity
  // ═══════════════════════════════════════════════════════════════════════════
  private computeHash(data: {
    action: string;
    entityType: string;
    entityId?: string;
    description: string;
    sequenceNumber: number;
    previousHash?: string;
  }): string {
    const content = JSON.stringify(data);
    return createHash('sha256').update(content).digest('hex');
  }
}
