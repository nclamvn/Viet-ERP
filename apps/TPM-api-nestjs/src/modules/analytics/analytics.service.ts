import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD OVERVIEW - Combines budget, promotion, claim, target metrics
  // ═══════════════════════════════════════════════════════════════════════════
  async getDashboardOverview(year: number) {
    this.logger.log(`Getting dashboard overview for year ${year}`);

    const [budgets, promotions, claims, targets] = await Promise.all([
      this.getBudgetMetrics(year),
      this.getPromotionMetrics(year),
      this.getClaimMetrics(year),
      this.getTargetMetrics(year),
    ]);

    return {
      year,
      generatedAt: new Date().toISOString(),
      budgets,
      promotions,
      claims,
      targets,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUDGET METRICS
  // ═══════════════════════════════════════════════════════════════════════════
  async getBudgetMetrics(year: number) {
    this.logger.log(`Getting budget metrics for year ${year}`);

    const budgets = await this.prisma.budget.findMany({
      where: { year },
      select: {
        id: true,
        totalAmount: true,
        allocatedAmount: true,
        spentAmount: true,
        status: true,
        approvalStatus: true,
      },
    });

    const count = budgets.length;
    const totalAmount = budgets.reduce((sum, b) => sum + Number(b.totalAmount), 0);
    const allocatedAmount = budgets.reduce((sum, b) => sum + Number(b.allocatedAmount), 0);
    const spentAmount = budgets.reduce((sum, b) => sum + Number(b.spentAmount), 0);
    const remainingAmount = totalAmount - spentAmount;
    const utilizationRate = totalAmount > 0 ? (spentAmount / totalAmount) * 100 : 0;
    const allocationRate = totalAmount > 0 ? (allocatedAmount / totalAmount) * 100 : 0;

    // Group by status
    const byStatus: Record<string, number> = {};
    for (const b of budgets) {
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
    }

    // Group by approval status
    const byApprovalStatus: Record<string, number> = {};
    for (const b of budgets) {
      byApprovalStatus[b.approvalStatus] = (byApprovalStatus[b.approvalStatus] || 0) + 1;
    }

    return {
      count,
      totalAmount,
      allocatedAmount,
      spentAmount,
      remainingAmount,
      utilizationRate: Math.round(utilizationRate * 100) / 100,
      allocationRate: Math.round(allocationRate * 100) / 100,
      byStatus,
      byApprovalStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMOTION METRICS
  // ═══════════════════════════════════════════════════════════════════════════
  async getPromotionMetrics(year: number) {
    this.logger.log(`Getting promotion metrics for year ${year}`);

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    const promotions = await this.prisma.promotion.findMany({
      where: {
        OR: [
          {
            startDate: { gte: startOfYear, lte: endOfYear },
          },
          {
            endDate: { gte: startOfYear, lte: endOfYear },
          },
          {
            startDate: { lte: startOfYear },
            endDate: { gte: endOfYear },
          },
        ],
      },
      select: {
        id: true,
        budget: true,
        actualSpend: true,
        status: true,
      },
    });

    const count = promotions.length;
    const totalBudget = promotions.reduce((sum, p) => sum + Number(p.budget), 0);
    const totalActualSpend = promotions.reduce((sum, p) => sum + Number(p.actualSpend || 0), 0);

    // Group by status: DRAFT, PLANNED, CONFIRMED, EXECUTING, COMPLETED, CANCELLED
    const byStatus: Record<string, number> = {};
    for (const p of promotions) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    }

    return {
      count,
      totalBudget,
      totalActualSpend,
      byStatus,
      countDraft: byStatus['DRAFT'] || 0,
      countPlanned: byStatus['PLANNED'] || 0,
      countConfirmed: byStatus['CONFIRMED'] || 0,
      countExecuting: byStatus['EXECUTING'] || 0,
      countCompleted: byStatus['COMPLETED'] || 0,
      countCancelled: byStatus['CANCELLED'] || 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAIM METRICS
  // ═══════════════════════════════════════════════════════════════════════════
  async getClaimMetrics(year: number) {
    this.logger.log(`Getting claim metrics for year ${year}`);

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    const claims = await this.prisma.claim.findMany({
      where: {
        claimDate: {
          gte: startOfYear,
          lte: endOfYear,
        },
      },
      select: {
        id: true,
        amount: true,
        status: true,
        settlement: {
          select: {
            settledAmount: true,
          },
        },
      },
    });

    const count = claims.length;
    const totalAmount = claims.reduce((sum, c) => sum + Number(c.amount), 0);
    const approvedAmount = claims
      .filter((c) => c.status === 'APPROVED' || c.status === 'SETTLED')
      .reduce((sum, c) => sum + Number(c.amount), 0);
    const settledAmount = claims
      .filter((c) => c.settlement)
      .reduce((sum, c) => sum + Number(c.settlement?.settledAmount || 0), 0);
    const pendingAmount = claims
      .filter((c) => c.status === 'PENDING')
      .reduce((sum, c) => sum + Number(c.amount), 0);

    const approvedCount = claims.filter(
      (c) => c.status === 'APPROVED' || c.status === 'SETTLED',
    ).length;
    const approvalRate = count > 0 ? (approvedCount / count) * 100 : 0;

    // Group by status
    const byStatus: Record<string, number> = {};
    for (const c of claims) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    }

    return {
      count,
      totalAmount,
      approvedAmount,
      settledAmount,
      pendingAmount,
      approvalRate: Math.round(approvalRate * 100) / 100,
      byStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TARGET METRICS
  // ═══════════════════════════════════════════════════════════════════════════
  async getTargetMetrics(year: number) {
    this.logger.log(`Getting target metrics for year ${year}`);

    const targets = await this.prisma.target.findMany({
      where: { year },
      select: {
        id: true,
        totalTarget: true,
        totalAchieved: true,
        status: true,
      },
    });

    const count = targets.length;
    const totalTarget = targets.reduce((sum, t) => sum + Number(t.totalTarget), 0);
    const totalAchieved = targets.reduce((sum, t) => sum + Number(t.totalAchieved), 0);
    const achievementRate = totalTarget > 0 ? (totalAchieved / totalTarget) * 100 : 0;

    // Group by status
    const byStatus: Record<string, number> = {};
    for (const t of targets) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    }

    return {
      count,
      totalTarget,
      totalAchieved,
      achievementRate: Math.round(achievementRate * 100) / 100,
      byStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRENDS - Monthly trend data for a given entity type
  // ═══════════════════════════════════════════════════════════════════════════
  async getTrends(entityType: string, year: number) {
    this.logger.log(`Getting trends for ${entityType} in year ${year}`);

    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    if (entityType === 'promotions') {
      const trends = await Promise.all(
        months.map(async (month) => {
          const startOfMonth = new Date(year, month - 1, 1);
          const endOfMonth = new Date(year, month, 0, 23, 59, 59);

          const count = await this.prisma.promotion.count({
            where: {
              startDate: { lte: endOfMonth },
              endDate: { gte: startOfMonth },
            },
          });

          const promotions = await this.prisma.promotion.findMany({
            where: {
              startDate: { lte: endOfMonth },
              endDate: { gte: startOfMonth },
            },
            select: { budget: true, actualSpend: true },
          });

          const totalBudget = promotions.reduce((sum, p) => sum + Number(p.budget), 0);
          const totalSpend = promotions.reduce((sum, p) => sum + Number(p.actualSpend || 0), 0);

          return {
            month,
            monthName: new Date(year, month - 1).toLocaleString('en-US', {
              month: 'short',
            }),
            count,
            totalBudget,
            totalSpend,
          };
        }),
      );

      return { entityType, year, trends };
    }

    if (entityType === 'claims') {
      const trends = await Promise.all(
        months.map(async (month) => {
          const startOfMonth = new Date(year, month - 1, 1);
          const endOfMonth = new Date(year, month, 0, 23, 59, 59);

          const claims = await this.prisma.claim.findMany({
            where: {
              claimDate: { gte: startOfMonth, lte: endOfMonth },
            },
            select: { amount: true, status: true },
          });

          const count = claims.length;
          const totalAmount = claims.reduce((sum, c) => sum + Number(c.amount), 0);
          const approvedCount = claims.filter(
            (c) => c.status === 'APPROVED' || c.status === 'SETTLED',
          ).length;

          return {
            month,
            monthName: new Date(year, month - 1).toLocaleString('en-US', {
              month: 'short',
            }),
            count,
            totalAmount,
            approvedCount,
          };
        }),
      );

      return { entityType, year, trends };
    }

    return {
      entityType,
      year,
      trends: [],
      message: 'Unsupported entity type. Use "promotions" or "claims".',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOP PERFORMERS
  // ═══════════════════════════════════════════════════════════════════════════
  async getTopPerformers(type: string, limit: number) {
    this.logger.log(`Getting top ${limit} performers of type ${type}`);

    if (type === 'customers') {
      const customers = await this.prisma.customer.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          channel: true,
          _count: {
            select: {
              claims: true,
            },
          },
        },
        orderBy: {
          claims: { _count: 'desc' },
        },
        take: limit,
      });

      return {
        type,
        data: customers.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          channel: c.channel,
          claimCount: c._count.claims,
        })),
      };
    }

    if (type === 'products') {
      const products = await this.prisma.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
          brand: true,
          _count: {
            select: {
              tacticItems: true,
            },
          },
        },
        orderBy: {
          tacticItems: { _count: 'desc' },
        },
        take: limit,
      });

      return {
        type,
        data: products.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          brand: p.brand,
          tacticItemCount: p._count.tacticItems,
        })),
      };
    }

    if (type === 'regions') {
      const regions = await this.prisma.geographicUnit.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          level: true,
          _count: {
            select: {
              budgetAllocations: true,
            },
          },
        },
        orderBy: {
          budgetAllocations: { _count: 'desc' },
        },
        take: limit,
      });

      return {
        type,
        data: regions.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          level: r.level,
          allocationCount: r._count.budgetAllocations,
        })),
      };
    }

    return {
      type,
      data: [],
      message: 'Unsupported type. Use "customers", "products", or "regions".',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROI ANALYSIS - Based on completed promotions, budget vs actualSpend
  // ═══════════════════════════════════════════════════════════════════════════
  async getROIAnalysis(year: number) {
    this.logger.log(`Getting ROI analysis for year ${year}`);

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    const completedPromotions = await this.prisma.promotion.findMany({
      where: {
        status: 'COMPLETED',
        endDate: { gte: startOfYear, lte: endOfYear },
      },
      select: {
        id: true,
        code: true,
        name: true,
        budget: true,
        actualSpend: true,
        startDate: true,
        endDate: true,
        customer: {
          select: { name: true },
        },
      },
    });

    const totalBudget = completedPromotions.reduce((sum, p) => sum + Number(p.budget), 0);
    const totalActualSpend = completedPromotions.reduce(
      (sum, p) => sum + Number(p.actualSpend || 0),
      0,
    );
    const totalSavings = totalBudget - totalActualSpend;
    const savingsRate = totalBudget > 0 ? (totalSavings / totalBudget) * 100 : 0;

    const promotionDetails = completedPromotions.map((p) => {
      const budget = Number(p.budget);
      const actualSpend = Number(p.actualSpend || 0);
      const variance = budget - actualSpend;
      const variancePercent = budget > 0 ? (variance / budget) * 100 : 0;

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        customerName: p.customer.name,
        budget,
        actualSpend,
        variance,
        variancePercent: Math.round(variancePercent * 100) / 100,
        startDate: p.startDate,
        endDate: p.endDate,
      };
    });

    return {
      year,
      completedCount: completedPromotions.length,
      totalBudget,
      totalActualSpend,
      totalSavings,
      savingsRate: Math.round(savingsRate * 100) / 100,
      promotions: promotionDetails,
    };
  }
}
