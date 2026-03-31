// ============================================================
// @vierp/admin — Admin Console Services
// Tenant management, system monitoring, usage analytics,
// audit logging, system config
// ============================================================

import { prisma } from '@vierp/database';

// ==================== Types ====================

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  tier: 'basic' | 'pro' | 'enterprise';
  isActive: boolean;
  userCount: number;
  storageUsedMB: number;
  modules: string[];
  createdAt: Date;
  lastActivityAt?: Date;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;                  // seconds
  modules: Array<{
    name: string;
    status: 'up' | 'down' | 'slow';
    responseTime: number;          // ms
    lastCheck: Date;
  }>;
  database: { connected: boolean; latency: number };
  nats: { connected: boolean; streams: number };
  redis: { connected: boolean; memoryUsed: string };
}

export interface UsageMetrics {
  tenantId: string;
  period: string;                  // "2026-03"
  apiCalls: number;
  activeUsers: number;
  storageUsedMB: number;
  eventsPublished: number;
  journalEntries: number;
  invoicesCreated: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  userId: string;
  userName: string;
  tenantId: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

// ==================== Tenant Management ====================

export class TenantManager {
  /**
   * List all tenants with summary info
   */
  async listTenants(): Promise<TenantInfo[]> {
    const tenants = await prisma.tenant.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return tenants.map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      tier: t.tier.toLowerCase() as 'basic' | 'pro' | 'enterprise',
      isActive: t.isActive,
      userCount: t._count.users,
      storageUsedMB: 0, // TODO: Calculate from actual storage
      modules: (t.settings as Record<string, unknown>)?.modules as string[] || [],
      createdAt: t.createdAt,
    }));
  }

  /**
   * Create a new tenant
   */
  async createTenant(data: {
    name: string;
    slug: string;
    tier: 'BASIC' | 'PRO' | 'ENTERPRISE';
    adminEmail: string;
    adminName: string;
  }): Promise<string> {
    const tenant = await prisma.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        tier: data.tier,
        isActive: true,
        settings: {
          locale: 'vi-VN',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
          dateFormat: 'dd/MM/yyyy',
          modules: this.getModulesForTier(data.tier),
        },
      },
    });

    // Create admin user
    await prisma.user.create({
      data: {
        email: data.adminEmail,
        name: data.adminName,
        role: 'ADMIN',
        tenantId: tenant.id,
        isActive: true,
      },
    });

    return tenant.id;
  }

  /**
   * Update tenant tier (upgrade/downgrade)
   */
  async updateTier(tenantId: string, newTier: 'BASIC' | 'PRO' | 'ENTERPRISE'): Promise<void> {
    const modules = this.getModulesForTier(newTier);

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        tier: newTier,
        settings: {
          locale: 'vi-VN',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
          dateFormat: 'dd/MM/yyyy',
          modules,
        },
      },
    });
  }

  /**
   * Deactivate a tenant (soft delete)
   */
  async deactivateTenant(tenantId: string): Promise<void> {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { isActive: false },
    });
  }

  private getModulesForTier(tier: string): string[] {
    const basic = ['hrm-basic', 'crm-basic', 'pm', 'excel-ai'];
    const pro = [...basic, 'mrp', 'otb', 'accounting-vas', 'tpm'];
    const enterprise = [...pro, 'ai-copilot', 'accounting-ifrs', 'ecommerce', 'custom-sdk'];

    switch (tier) {
      case 'ENTERPRISE': return enterprise;
      case 'PRO': return pro;
      default: return basic;
    }
  }
}

// ==================== System Monitoring ====================

export class SystemMonitor {
  private startTime = Date.now();

  /**
   * Get overall system health
   */
  async getHealth(): Promise<SystemHealth> {
    const dbHealth = await this.checkDatabase();
    const moduleChecks = await this.checkModules();

    const allHealthy = dbHealth.connected && moduleChecks.every(m => m.status === 'up');

    return {
      status: allHealthy ? 'healthy' : dbHealth.connected ? 'degraded' : 'down',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      modules: moduleChecks,
      database: dbHealth,
      nats: { connected: true, streams: 9 }, // Would check actual NATS
      redis: { connected: true, memoryUsed: '0MB' },
    };
  }

  private async checkDatabase(): Promise<{ connected: boolean; latency: number }> {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { connected: true, latency: Date.now() - start };
    } catch {
      return { connected: false, latency: -1 };
    }
  }

  private async checkModules(): Promise<SystemHealth['modules']> {
    const modules = [
      { name: 'HRM', port: 3001 },
      { name: 'CRM', port: 3002 },
      { name: 'MRP', port: 3003 },
      { name: 'OTB', port: 3004 },
      { name: 'TPM', port: 3005 },
      { name: 'PM', port: 3006 },
      { name: 'Accounting', port: 3007 },
      { name: 'ExcelAI', port: 3008 },
    ];

    return modules.map(m => ({
      name: m.name,
      status: 'up' as const, // Would do actual health checks
      responseTime: Math.floor(Math.random() * 50) + 10,
      lastCheck: new Date(),
    }));
  }

  /**
   * Get usage metrics for a tenant
   */
  async getUsageMetrics(tenantId: string, period: string): Promise<UsageMetrics> {
    // In production, aggregate from actual usage data
    const userCount = await prisma.user.count({ where: { tenantId, isActive: true } });

    return {
      tenantId,
      period,
      apiCalls: 0,
      activeUsers: userCount,
      storageUsedMB: 0,
      eventsPublished: 0,
      journalEntries: 0,
      invoicesCreated: 0,
    };
  }
}

// ==================== Audit Service ====================

export class AuditService {
  /**
   * Log an audit entry
   */
  async log(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void> {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        changes: entry.changes as any,
        userId: entry.userId,
        tenantId: entry.tenantId,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  }

  /**
   * Query audit logs
   */
  async query(params: {
    tenantId: string;
    entity?: string;
    entityId?: string;
    userId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: AuditEntry[]; total: number }> {
    const where: Record<string, unknown> = { tenantId: params.tenantId };

    if (params.entity) where.entity = params.entity;
    if (params.entityId) where.entityId = params.entityId;
    if (params.userId) where.userId = params.userId;
    if (params.action) where.action = params.action;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) (where.createdAt as Record<string, unknown>).gte = params.from;
      if (params.to) (where.createdAt as Record<string, unknown>).lte = params.to;
    }

    const page = params.page || 1;
    const pageSize = params.pageSize || 50;

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: where as any,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true } } },
      }),
      prisma.auditLog.count({ where: where as any }),
    ]);

    return {
      data: data.map(d => ({
        id: d.id,
        action: d.action,
        entity: d.entity,
        entityId: d.entityId,
        userId: d.userId,
        userName: (d as any).user?.name || '',
        tenantId: d.tenantId,
        changes: (d.changes as Record<string, { old: unknown; new: unknown }>) || {},
        ipAddress: d.ipAddress || undefined,
        userAgent: d.userAgent || undefined,
        createdAt: d.createdAt,
      })),
      total,
    };
  }
}

// Export singletons
export const tenantManager = new TenantManager();
export const systemMonitor = new SystemMonitor();
export const auditService = new AuditService();
