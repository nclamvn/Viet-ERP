import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';
import { ConnectionQueryDto } from './dto/connection-query.dto';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { CreateSyncConfigDto } from './dto/create-sync-config.dto';
import { SyncConfigQueryDto } from './dto/sync-config-query.dto';
import { SyncJobQueryDto } from './dto/sync-job-query.dto';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WebhookQueryDto } from './dto/webhook-query.dto';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // ERP CONNECTIONS - LIST
  // ═══════════════════════════════════════════════════════════════════════════
  async findAllConnections(query: ConnectionQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { companyId, status, erpType, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const where: Prisma.ERPConnectionWhereInput = {};
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    if (erpType) where.erpType = erpType;

    const validSortFields = ['createdAt', 'name', 'status', 'erpType', 'lastPingAt'];
    const orderBy: Prisma.ERPConnectionOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.eRPConnection.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          _count: { select: { syncConfigs: true, syncJobs: true, mappings: true } },
        },
      }),
      this.prisma.eRPConnection.count({ where }),
    ]);

    const transformedData = data.map((c) => this.transformConnection(c));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ERP CONNECTIONS - GET BY ID
  // ═══════════════════════════════════════════════════════════════════════════
  async findOneConnection(id: string) {
    const connection = await this.prisma.eRPConnection.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        syncConfigs: true,
        mappings: true,
        _count: { select: { syncJobs: true } },
      },
    });

    if (!connection) {
      throw new NotFoundException(`ERP Connection with ID ${id} not found`);
    }

    return this.transformConnectionDetail(connection);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ERP CONNECTIONS - CREATE
  // ═══════════════════════════════════════════════════════════════════════════
  async createConnection(dto: CreateConnectionDto, userId: string) {
    const connection = await this.prisma.eRPConnection.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        erpType: dto.erpType,
        baseUrl: dto.baseUrl,
        username: dto.username,
        password: dto.password,
        apiKey: dto.apiKey,
        clientId: dto.clientId,
        clientSecret: dto.clientSecret,
        sapClient: dto.sapClient,
        sapSystemId: dto.sapSystemId,
        sapLanguage: dto.sapLanguage,
        oracleOrgId: dto.oracleOrgId,
        oracleRespId: dto.oracleRespId,
        timeout: dto.timeout ?? 30000,
        retryAttempts: dto.retryAttempts ?? 3,
        isDefault: dto.isDefault ?? false,
        createdById: userId,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    this.logger.log(`ERP connection created: ${connection.name} by user ${userId}`);

    return this.transformConnection(connection);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ERP CONNECTIONS - UPDATE
  // ═══════════════════════════════════════════════════════════════════════════
  async updateConnection(id: string, dto: UpdateConnectionDto) {
    const existing = await this.prisma.eRPConnection.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`ERP Connection with ID ${id} not found`);
    }

    const updated = await this.prisma.eRPConnection.update({
      where: { id },
      data: {
        name: dto.name,
        erpType: dto.erpType,
        status: dto.status,
        baseUrl: dto.baseUrl,
        username: dto.username,
        password: dto.password,
        apiKey: dto.apiKey,
        clientId: dto.clientId,
        clientSecret: dto.clientSecret,
        sapClient: dto.sapClient,
        sapSystemId: dto.sapSystemId,
        sapLanguage: dto.sapLanguage,
        oracleOrgId: dto.oracleOrgId,
        oracleRespId: dto.oracleRespId,
        timeout: dto.timeout,
        retryAttempts: dto.retryAttempts,
        isDefault: dto.isDefault,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    this.logger.log(`ERP connection updated: ${updated.name}`);

    return this.transformConnection(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ERP CONNECTIONS - TEST
  // ═══════════════════════════════════════════════════════════════════════════
  async testConnection(id: string) {
    const connection = await this.prisma.eRPConnection.findUnique({ where: { id } });
    if (!connection) {
      throw new NotFoundException(`ERP Connection with ID ${id} not found`);
    }

    // Mock test: simulate a ping attempt
    const success = true; // In production, actually test the connection
    const now = new Date();

    const updated = await this.prisma.eRPConnection.update({
      where: { id },
      data: {
        lastPingAt: now,
        lastPingStatus: success,
        lastErrorMessage: success ? null : 'Connection test failed',
        status: success ? 'ACTIVE' : 'ERROR',
      },
    });

    this.logger.log(`ERP connection tested: ${connection.name}, success: ${success}`);

    return {
      id: updated.id,
      name: updated.name,
      success,
      testedAt: now,
      status: updated.status,
      message: success ? 'Connection test successful' : 'Connection test failed',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ERP CONNECTIONS - DELETE
  // ═══════════════════════════════════════════════════════════════════════════
  async deleteConnection(id: string) {
    const connection = await this.prisma.eRPConnection.findUnique({
      where: { id },
      include: { _count: { select: { syncJobs: true } } },
    });

    if (!connection) {
      throw new NotFoundException(`ERP Connection with ID ${id} not found`);
    }

    if (connection.status !== 'INACTIVE') {
      throw new BadRequestException(
        `Cannot delete connection in ${connection.status} status. Only INACTIVE connections can be deleted.`,
      );
    }

    await this.prisma.eRPConnection.delete({ where: { id } });

    this.logger.log(`ERP connection deleted: ${connection.name}`);

    return { success: true, message: 'Connection deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC CONFIGS - LIST
  // ═══════════════════════════════════════════════════════════════════════════
  async findAllSyncConfigs(query: SyncConfigQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { connectionId, entityType, isActive } = query;

    const where: Prisma.SyncConfigWhereInput = {};
    if (connectionId) where.connectionId = connectionId;
    if (entityType) where.entityType = entityType;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.syncConfig.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          connection: { select: { id: true, name: true, erpType: true, status: true } },
          _count: { select: { jobs: true } },
        },
      }),
      this.prisma.syncConfig.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC CONFIGS - CREATE
  // ═══════════════════════════════════════════════════════════════════════════
  async createSyncConfig(dto: CreateSyncConfigDto) {
    // Validate connection exists
    const connection = await this.prisma.eRPConnection.findUnique({
      where: { id: dto.connectionId },
    });
    if (!connection) {
      throw new BadRequestException(`ERP Connection with ID ${dto.connectionId} not found`);
    }

    const config = await this.prisma.syncConfig.create({
      data: {
        connectionId: dto.connectionId,
        entityType: dto.entityType,
        direction: dto.direction,
        frequency: dto.frequency ?? 'DAILY',
        cronExpression: dto.cronExpression,
        filterConditions: dto.filterConditions,
        batchSize: dto.batchSize ?? 100,
        conflictStrategy: dto.conflictStrategy ?? 'ERP_WINS',
        isActive: dto.isActive ?? true,
      },
      include: {
        connection: { select: { id: true, name: true, erpType: true } },
      },
    });

    this.logger.log(
      `Sync config created: ${config.entityType}/${config.direction} for connection ${connection.name}`,
    );

    return config;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC JOBS - LIST
  // ═══════════════════════════════════════════════════════════════════════════
  async findAllSyncJobs(query: SyncJobQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { connectionId, status, configId } = query;

    const where: Prisma.SyncJobWhereInput = {};
    if (connectionId) where.connectionId = connectionId;
    if (status) where.status = status;
    if (configId) where.configId = configId;

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
  // SYNC JOBS - TRIGGER
  // ═══════════════════════════════════════════════════════════════════════════
  async triggerSyncJob(configId: string, userId: string) {
    const config = await this.prisma.syncConfig.findUnique({
      where: { id: configId },
      include: { connection: true },
    });

    if (!config) {
      throw new NotFoundException(`Sync config with ID ${configId} not found`);
    }

    if (!config.isActive) {
      throw new BadRequestException('Sync config is not active');
    }

    const job = await this.prisma.syncJob.create({
      data: {
        connectionId: config.connectionId,
        configId: config.id,
        entityType: config.entityType,
        direction: config.direction,
        status: 'PENDING',
        triggeredBy: 'MANUAL',
        triggeredById: userId,
      },
      include: {
        connection: { select: { id: true, name: true, erpType: true } },
        config: { select: { id: true, entityType: true, direction: true } },
      },
    });

    this.logger.log(`Sync job triggered: ${job.id} for config ${configId} by user ${userId}`);

    return job;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOKS - LIST
  // ═══════════════════════════════════════════════════════════════════════════
  async findAllWebhooks(query: WebhookQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { companyId, isActive } = query;

    const where: Prisma.WebhookSubscriptionWhereInput = {};
    if (companyId) where.companyId = companyId;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.webhookSubscription.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { deliveries: true } },
        },
      }),
      this.prisma.webhookSubscription.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOKS - CREATE
  // ═══════════════════════════════════════════════════════════════════════════
  async createWebhook(dto: CreateWebhookDto, userId: string) {
    const webhook = await this.prisma.webhookSubscription.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        description: dto.description,
        url: dto.url,
        secret: dto.secret,
        events: dto.events,
        customHeaders: dto.customHeaders,
        maxRetries: dto.maxRetries ?? 5,
        retryDelayMs: dto.retryDelayMs ?? 60000,
        autoDisableAfter: dto.autoDisableAfter ?? 10,
        createdById: userId,
      },
    });

    this.logger.log(`Webhook created: ${webhook.name} by user ${userId}`);

    return webhook;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOKS - UPDATE
  // ═══════════════════════════════════════════════════════════════════════════
  async updateWebhook(id: string, dto: UpdateWebhookDto) {
    const existing = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    const updated = await this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        url: dto.url,
        secret: dto.secret,
        events: dto.events,
        customHeaders: dto.customHeaders,
        maxRetries: dto.maxRetries,
        retryDelayMs: dto.retryDelayMs,
        autoDisableAfter: dto.autoDisableAfter,
      },
    });

    this.logger.log(`Webhook updated: ${updated.name}`);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOKS - TOGGLE
  // ═══════════════════════════════════════════════════════════════════════════
  async toggleWebhook(id: string) {
    const existing = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    const newActive = !existing.isActive;

    const updated = await this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        isActive: newActive,
        disabledAt: newActive ? null : new Date(),
        disableReason: newActive ? null : 'Manually disabled',
        consecutiveFailures: newActive ? 0 : existing.consecutiveFailures,
      },
    });

    this.logger.log(`Webhook toggled: ${updated.name}, active: ${newActive}`);

    return {
      id: updated.id,
      name: updated.name,
      isActive: updated.isActive,
      message: `Webhook ${newActive ? 'enabled' : 'disabled'} successfully`,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOKS - DELETE
  // ═══════════════════════════════════════════════════════════════════════════
  async deleteWebhook(id: string) {
    const existing = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    await this.prisma.webhookSubscription.delete({ where: { id } });

    this.logger.log(`Webhook deleted: ${existing.name}`);

    return { success: true, message: 'Webhook deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFORM HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  private transformConnection(connection: any) {
    return {
      id: connection.id,
      companyId: connection.companyId,
      name: connection.name,
      erpType: connection.erpType,
      status: connection.status,
      baseUrl: connection.baseUrl,
      timeout: connection.timeout,
      retryAttempts: connection.retryAttempts,
      lastPingAt: connection.lastPingAt,
      lastPingStatus: connection.lastPingStatus,
      lastErrorMessage: connection.lastErrorMessage,
      isDefault: connection.isDefault,
      createdBy: connection.createdBy || null,
      syncConfigCount: connection._count?.syncConfigs || 0,
      syncJobCount: connection._count?.syncJobs || 0,
      mappingCount: connection._count?.mappings || 0,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  private transformConnectionDetail(connection: any) {
    const base = this.transformConnection(connection);
    return {
      ...base,
      username: connection.username,
      sapClient: connection.sapClient,
      sapSystemId: connection.sapSystemId,
      sapLanguage: connection.sapLanguage,
      oracleOrgId: connection.oracleOrgId,
      oracleRespId: connection.oracleRespId,
      syncConfigs: connection.syncConfigs || [],
      mappings: connection.mappings || [],
    };
  }
}
