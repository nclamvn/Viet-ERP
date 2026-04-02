// src/services/insight.service.ts
// Smart Insights Service

import { db } from "@/lib/db";
import type {
  Prisma,
  InsightType,
  InsightSeverity,
} from ".prisma/hrm-ai-client";
import type { PaginatedResponse } from "@/types";
import type { Insight, InsightCounts, InsightFilters } from "@/types/insight";

export const insightService = {
  /**
   * Get all insights with filters
   */
  async getAll(
    tenantId: string,
    filters: InsightFilters & { page?: number; pageSize?: number } = {},
  ): Promise<PaginatedResponse<Insight>> {
    const {
      type,
      category,
      severity,
      includeDismissed = false,
      page = 1,
      pageSize = 20,
    } = filters;
    const skip = (page - 1) * pageSize;
    const now = new Date();

    const where: Prisma.InsightWhereInput = {
      tenantId,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      ...(type && { type }),
      ...(category && { category }),
      ...(severity && { severity }),
      ...(!includeDismissed && { isDismissed: false }),
    };

    const [data, total] = await Promise.all([
      db.insight.findMany({
        where,
        orderBy: [
          { severity: "desc" }, // Critical first
          { createdAt: "desc" },
        ],
        skip,
        take: pageSize,
      }),
      db.insight.count({ where }),
    ]);

    return {
      data: data as Insight[],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  /**
   * Get insight counts by severity
   */
  async getCounts(tenantId: string): Promise<InsightCounts> {
    const now = new Date();

    const baseWhere: Prisma.InsightWhereInput = {
      tenantId,
      isDismissed: false,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
    };

    const [critical, high, medium, low] = await Promise.all([
      db.insight.count({ where: { ...baseWhere, severity: "CRITICAL" } }),
      db.insight.count({ where: { ...baseWhere, severity: "HIGH" } }),
      db.insight.count({ where: { ...baseWhere, severity: "MEDIUM" } }),
      db.insight.count({ where: { ...baseWhere, severity: "LOW" } }),
    ]);

    return {
      critical,
      high,
      medium,
      low,
      total: critical + high + medium + low,
    };
  },

  /**
   * Get insight by ID
   */
  async getById(tenantId: string, id: string): Promise<Insight | null> {
    const insight = await db.insight.findFirst({
      where: { id, tenantId },
    });
    return insight as Insight | null;
  },

  /**
   * Mark insight as read
   */
  async markAsRead(tenantId: string, id: string): Promise<void> {
    await db.insight.updateMany({
      where: { id, tenantId },
      data: { isRead: true },
    });
  },

  /**
   * Dismiss an insight
   */
  async dismiss(
    tenantId: string,
    id: string,
    dismissedBy: string,
  ): Promise<void> {
    await db.insight.updateMany({
      where: { id, tenantId },
      data: {
        isDismissed: true,
        dismissedBy,
        dismissedAt: new Date(),
      },
    });
  },

  /**
   * Create a new insight (used by analytics jobs)
   */
  async create(
    tenantId: string,
    data: {
      type: InsightType;
      severity: InsightSeverity;
      category: string;
      title: string;
      description: string;
      referenceType?: string;
      referenceId?: string;
      metrics?: Record<string, unknown>;
      suggestions?: string[];
      validUntil?: Date;
    },
  ): Promise<Insight> {
    const insight = await db.insight.create({
      data: {
        tenantId,
        type: data.type,
        severity: data.severity,
        category: data.category,
        title: data.title,
        description: data.description,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        metrics: data.metrics
          ? JSON.parse(JSON.stringify(data.metrics))
          : undefined,
        suggestions: data.suggestions,
        validFrom: new Date(),
        validUntil: data.validUntil,
      },
    });
    return insight as Insight;
  },

  /**
   * Generate insights from attendance data (example)
   */
  async generateAttendanceInsights(tenantId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Find employees with high late count
    const lateStats = await db.attendance.groupBy({
      by: ["employeeId"],
      where: {
        employee: { tenantId },
        date: { gte: startOfMonth },
        status: "LATE",
      },
      _count: { id: true },
      having: {
        id: { _count: { gte: 5 } },
      },
    });

    let created = 0;

    for (const stat of lateStats) {
      const employee = await db.employee.findUnique({
        where: { id: stat.employeeId },
        include: { department: true },
      });

      if (!employee) continue;

      // Check if similar insight exists
      const existing = await db.insight.findFirst({
        where: {
          tenantId,
          type: "ANOMALY",
          category: "attendance",
          referenceId: employee.id,
          isDismissed: false,
          createdAt: { gte: startOfMonth },
        },
      });

      if (existing) continue;

      await this.create(tenantId, {
        type: "ANOMALY",
        severity: stat._count.id >= 10 ? "HIGH" : "MEDIUM",
        category: "attendance",
        title: `Nhân viên đi muộn nhiều lần`,
        description: `${employee.fullName} (${employee.employeeCode}) đã đi muộn ${stat._count.id} lần trong tháng này.`,
        referenceType: "EMPLOYEE",
        referenceId: employee.id,
        metrics: {
          lateCount: stat._count.id,
          department: employee.department?.name,
        },
        suggestions: [
          "Trao đổi với nhân viên về nguyên nhân",
          "Kiểm tra lịch làm việc có phù hợp không",
          "Xem xét điều chỉnh giờ làm việc nếu cần",
        ],
      });

      created++;
    }

    return created;
  },

  /**
   * Generate insights from leave data
   */
  async generateLeaveInsights(tenantId: string): Promise<number> {
    const now = new Date();
    const currentYear = now.getFullYear();

    // Find employees with low leave balance
    const lowBalances = await db.leaveBalance.findMany({
      where: {
        employee: { tenantId },
        year: currentYear,
        policy: { code: "ANNUAL" },
      },
      include: {
        employee: { include: { department: true } },
        policy: true,
      },
    });

    let created = 0;

    for (const balance of lowBalances) {
      const entitlement = Number(balance.entitlement);
      const used = Number(balance.used);
      const remaining = entitlement - used;
      const usagePercent = (used / entitlement) * 100;

      // Alert if usage > 90%
      if (usagePercent >= 90) {
        const existing = await db.insight.findFirst({
          where: {
            tenantId,
            type: "WARNING",
            category: "leave",
            referenceId: balance.employeeId,
            isDismissed: false,
            createdAt: { gte: new Date(currentYear, 0, 1) },
          },
        });

        if (existing) continue;

        await this.create(tenantId, {
          type: "WARNING",
          severity: remaining <= 0 ? "HIGH" : "MEDIUM",
          category: "leave",
          title: `Phép năm sắp hết`,
          description: `${balance.employee.fullName} đã sử dụng ${used}/${entitlement} ngày phép năm (${usagePercent.toFixed(0)}%).`,
          referenceType: "EMPLOYEE",
          referenceId: balance.employeeId,
          metrics: {
            used: balance.used,
            entitlement: balance.entitlement,
            remaining,
            usagePercent,
          },
          suggestions: [
            "Thông báo cho nhân viên về số ngày phép còn lại",
            "Xem xét kế hoạch nghỉ phép cuối năm",
          ],
        });

        created++;
      }
    }

    return created;
  },

  /**
   * Run all insight generators
   */
  async generateAllInsights(tenantId: string): Promise<{ total: number }> {
    const [attendance, leave] = await Promise.all([
      this.generateAttendanceInsights(tenantId),
      this.generateLeaveInsights(tenantId),
    ]);

    return { total: attendance + leave };
  },
};
