import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-unified-client";
import type { AuditFilters } from "@/types/audit";
import type { PaginatedResponse } from "@/types";
import type { AuditLogEntry } from "@/types/audit";

export const auditService = {
  async getLogs(
    tenantId: string,
    filters: AuditFilters & { page?: number; pageSize?: number } = {},
  ): Promise<PaginatedResponse<AuditLogEntry>> {
    const {
      action,
      entityType,
      entityId,
      userId,
      startDate,
      endDate,
      page = 1,
      pageSize = 50,
    } = filters;
    const skip = (page - 1) * pageSize;

    const where: Prisma.AuditLogWhereInput = { tenantId };
    if (action) where.action = action as Prisma.EnumAuditActionFilter;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (userId) where.userId = userId;
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate && { gte: startDate }),
        ...(endDate && { lte: endDate }),
      };
    }

    const [data, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.auditLog.count({ where }),
    ]);

    return {
      data: data as unknown as AuditLogEntry[],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  async getById(tenantId: string, id: string) {
    return db.auditLog.findFirst({ where: { id, tenantId } });
  },

  async getStats(tenantId: string, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await db.auditLog.groupBy({
      by: ["action"],
      where: { tenantId, createdAt: { gte: startDate } },
      _count: true,
    });

    return stats.map((s) => ({ action: s.action, count: s._count }));
  },
};
