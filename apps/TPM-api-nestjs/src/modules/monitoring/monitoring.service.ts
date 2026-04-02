import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '.prisma/tpm-nestjs-client';

export interface MonitoringAlert {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  entityId: string;
  entityType: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE DASHBOARD - Combined real-time monitoring data
  // ═══════════════════════════════════════════════════════════════════════════
  async getLiveDashboard() {
    this.logger.log('Getting live monitoring dashboard');

    const [todayClaims, pendingApprovals, activePromotions, recentTransactions, systemHealth] =
      await Promise.all([
        this.getTodayClaims(),
        this.getPendingApprovals(),
        this.getActivePromotions(),
        this.getRecentTransactions(),
        this.getSystemHealth(),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      todayClaims,
      pendingApprovals,
      activePromotions,
      recentTransactions,
      systemHealth,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TODAY'S CLAIMS - Claims created today
  // ═══════════════════════════════════════════════════════════════════════════
  private async getTodayClaims() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const claims = await this.prisma.claim.findMany({
      where: {
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      select: {
        id: true,
        amount: true,
        status: true,
      },
    });

    const count = claims.length;
    const totalAmount = claims.reduce((sum, c) => sum + Number(c.amount), 0);

    // Group by status
    const byStatus: Record<string, number> = {};
    for (const c of claims) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    }

    return {
      count,
      totalAmount,
      byStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PENDING APPROVALS - Items awaiting approval across models
  // ═══════════════════════════════════════════════════════════════════════════
  async getPendingApprovals() {
    this.logger.log('Getting pending approvals');

    const [pendingBudgets, pendingClaims, pendingPromotions] = await Promise.all([
      // Budgets with approvalStatus SUBMITTED or UNDER_REVIEW
      this.prisma.budget.count({
        where: {
          approvalStatus: {
            in: ['SUBMITTED', 'UNDER_REVIEW'],
          },
        },
      }),
      // Claims with status PENDING
      this.prisma.claim.count({
        where: {
          status: 'PENDING',
        },
      }),
      // Promotions with status PLANNED (closest to pending approval)
      this.prisma.promotion.count({
        where: {
          status: 'PLANNED',
        },
      }),
    ]);

    const total = pendingBudgets + pendingClaims + pendingPromotions;

    return {
      total,
      budgets: pendingBudgets,
      claims: pendingClaims,
      promotions: pendingPromotions,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVE PROMOTIONS - Currently executing promotions
  // ═══════════════════════════════════════════════════════════════════════════
  private async getActivePromotions() {
    const now = new Date();

    const promotions = await this.prisma.promotion.findMany({
      where: {
        status: 'EXECUTING',
        startDate: { lte: now },
        endDate: { gte: now },
      },
      select: {
        id: true,
        code: true,
        name: true,
        budget: true,
        actualSpend: true,
        endDate: true,
      },
      take: 20,
      orderBy: { endDate: 'asc' },
    });

    const data = promotions.map((p) => {
      const budget = Number(p.budget);
      const actualSpend = Number(p.actualSpend || 0);
      const utilization = budget > 0 ? (actualSpend / budget) * 100 : 0;
      const daysRemaining = Math.max(
        0,
        Math.ceil((p.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        budget,
        actualSpend,
        utilization: Math.round(utilization * 100) / 100,
        daysRemaining,
      };
    });

    return {
      count: data.length,
      data,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECENT TRANSACTIONS - Latest 20 transactions
  // ═══════════════════════════════════════════════════════════════════════════
  private async getRecentTransactions() {
    const transactions = await this.prisma.transaction.findMany({
      select: {
        id: true,
        type: true,
        amount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: Number(t.amount),
      createdAt: t.createdAt,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYSTEM HEALTH - Database connectivity check
  // ═══════════════════════════════════════════════════════════════════════════
  async getSystemHealth() {
    this.logger.log('Checking system health');

    let dbStatus: 'healthy' | 'unhealthy' = 'unhealthy';
    let dbLatency = 0;

    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - start;
      dbStatus = 'healthy';
    } catch (error) {
      this.logger.error('Database health check failed', error);
      dbStatus = 'unhealthy';
    }

    return {
      status: dbStatus === 'healthy' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        latencyMs: dbLatency,
      },
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALERTS - Budget overruns, expiring promotions, stale pending claims
  // ═══════════════════════════════════════════════════════════════════════════
  async getAlerts() {
    this.logger.log('Getting monitoring alerts');

    const alerts: MonitoringAlert[] = [];

    // 1. Budget alerts: budgets > 90% utilized (spentAmount/totalAmount)
    const overUtilizedBudgets = await this.prisma.budget.findMany({
      where: {
        isActive: true,
        totalAmount: { gt: 0 },
      },
      select: {
        id: true,
        code: true,
        name: true,
        totalAmount: true,
        spentAmount: true,
      },
    });

    for (const budget of overUtilizedBudgets) {
      const totalAmount = Number(budget.totalAmount);
      const spentAmount = Number(budget.spentAmount);
      if (totalAmount > 0 && spentAmount / totalAmount > 0.9) {
        const utilization = Math.round((spentAmount / totalAmount) * 10000) / 100;
        alerts.push({
          type: 'BUDGET_OVERRUN',
          severity: utilization >= 100 ? 'critical' : 'warning',
          title: `Budget "${budget.name}" at ${utilization}% utilization`,
          message: `Budget ${budget.code} has spent ${spentAmount.toLocaleString()} of ${totalAmount.toLocaleString()} (${utilization}%)`,
          entityId: budget.id,
          entityType: 'Budget',
          metadata: { utilization, totalAmount, spentAmount },
        });
      }
    }

    // 2. Expiring promotions: EXECUTING, endDate within 7 days
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const now = new Date();

    const expiringPromotions = await this.prisma.promotion.findMany({
      where: {
        status: 'EXECUTING',
        endDate: {
          gte: now,
          lte: sevenDaysFromNow,
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        endDate: true,
        budget: true,
        actualSpend: true,
      },
    });

    for (const promo of expiringPromotions) {
      const daysRemaining = Math.ceil(
        (promo.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      alerts.push({
        type: 'PROMOTION_EXPIRING',
        severity: daysRemaining <= 2 ? 'critical' : 'warning',
        title: `Promotion "${promo.name}" expires in ${daysRemaining} days`,
        message: `Promotion ${promo.code} ends on ${promo.endDate.toISOString().split('T')[0]}`,
        entityId: promo.id,
        entityType: 'Promotion',
        metadata: {
          daysRemaining,
          endDate: promo.endDate,
          budget: Number(promo.budget),
          actualSpend: Number(promo.actualSpend || 0),
        },
      });
    }

    // 3. Stale pending claims: PENDING status, created > 3 days ago
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const staleClaims = await this.prisma.claim.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: threeDaysAgo },
      },
      select: {
        id: true,
        code: true,
        amount: true,
        createdAt: true,
        customer: {
          select: { name: true },
        },
      },
    });

    for (const claim of staleClaims) {
      const daysStale = Math.ceil(
        (now.getTime() - claim.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      alerts.push({
        type: 'STALE_CLAIM',
        severity: daysStale > 7 ? 'critical' : 'warning',
        title: `Claim ${claim.code} pending for ${daysStale} days`,
        message: `Claim from ${claim.customer.name} for ${Number(claim.amount).toLocaleString()} has been pending for ${daysStale} days`,
        entityId: claim.id,
        entityType: 'Claim',
        metadata: {
          daysStale,
          amount: Number(claim.amount),
          customerName: claim.customer.name,
        },
      });
    }

    // Sort by severity: critical first, then warning, then info
    const severityOrder: Record<string, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return {
      count: alerts.length,
      critical: alerts.filter((a) => a.severity === 'critical').length,
      warning: alerts.filter((a) => a.severity === 'warning').length,
      info: alerts.filter((a) => a.severity === 'info').length,
      alerts,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVITY FEED - Recent audit log entries
  // ═══════════════════════════════════════════════════════════════════════════
  async getActivityFeed(limit: number) {
    this.logger.log(`Getting activity feed (limit: ${limit})`);

    const activities = await this.prisma.immutableAuditLog.findMany({
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        description: true,
        timestamp: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return {
      count: activities.length,
      activities,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KPIs - Key performance indicators for the year
  // ═══════════════════════════════════════════════════════════════════════════
  async getKPIs(year: number) {
    this.logger.log(`Getting KPIs for year ${year}`);

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    const [
      totalBudgets,
      totalPromotions,
      completedPromotions,
      totalClaims,
      approvedClaims,
      settledClaims,
      activeFunds,
      targets,
    ] = await Promise.all([
      // Budget KPIs
      this.prisma.budget.aggregate({
        where: { year },
        _sum: {
          totalAmount: true,
          spentAmount: true,
          allocatedAmount: true,
        },
        _count: true,
      }),
      // Promotion count for the year
      this.prisma.promotion.count({
        where: {
          OR: [
            { startDate: { gte: startOfYear, lte: endOfYear } },
            { endDate: { gte: startOfYear, lte: endOfYear } },
          ],
        },
      }),
      // Completed promotions
      this.prisma.promotion.count({
        where: {
          status: 'COMPLETED',
          endDate: { gte: startOfYear, lte: endOfYear },
        },
      }),
      // Total claims for the year
      this.prisma.claim.count({
        where: {
          claimDate: { gte: startOfYear, lte: endOfYear },
        },
      }),
      // Approved/settled claims
      this.prisma.claim.count({
        where: {
          claimDate: { gte: startOfYear, lte: endOfYear },
          status: { in: ['APPROVED', 'SETTLED'] },
        },
      }),
      // Settled claims with amounts
      this.prisma.settlement.aggregate({
        where: {
          settledAt: { gte: startOfYear, lte: endOfYear },
        },
        _sum: { settledAmount: true },
        _count: true,
      }),
      // Active funds
      this.prisma.fund.aggregate({
        where: { isActive: true, year },
        _sum: {
          totalBudget: true,
          committed: true,
          available: true,
        },
        _count: true,
      }),
      // Targets
      this.prisma.target.aggregate({
        where: { year },
        _sum: {
          totalTarget: true,
          totalAchieved: true,
        },
        _count: true,
      }),
    ]);

    const budgetTotal = Number(totalBudgets._sum.totalAmount || 0);
    const budgetSpent = Number(totalBudgets._sum.spentAmount || 0);
    const budgetAllocated = Number(totalBudgets._sum.allocatedAmount || 0);
    const targetTotal = Number(targets._sum.totalTarget || 0);
    const targetAchieved = Number(targets._sum.totalAchieved || 0);
    const claimApprovalRate = totalClaims > 0 ? (approvedClaims / totalClaims) * 100 : 0;
    const promotionCompletionRate =
      totalPromotions > 0 ? (completedPromotions / totalPromotions) * 100 : 0;
    const targetAchievementRate = targetTotal > 0 ? (targetAchieved / targetTotal) * 100 : 0;
    const budgetUtilizationRate = budgetTotal > 0 ? (budgetSpent / budgetTotal) * 100 : 0;

    return {
      year,
      generatedAt: new Date().toISOString(),
      budget: {
        count: totalBudgets._count,
        totalAmount: budgetTotal,
        allocatedAmount: budgetAllocated,
        spentAmount: budgetSpent,
        utilizationRate: Math.round(budgetUtilizationRate * 100) / 100,
      },
      promotions: {
        total: totalPromotions,
        completed: completedPromotions,
        completionRate: Math.round(promotionCompletionRate * 100) / 100,
      },
      claims: {
        total: totalClaims,
        approved: approvedClaims,
        approvalRate: Math.round(claimApprovalRate * 100) / 100,
        settledCount: settledClaims._count,
        settledAmount: Number(settledClaims._sum.settledAmount || 0),
      },
      funds: {
        activeCount: activeFunds._count,
        totalBudget: Number(activeFunds._sum.totalBudget || 0),
        committed: Number(activeFunds._sum.committed || 0),
        available: Number(activeFunds._sum.available || 0),
      },
      targets: {
        count: targets._count,
        totalTarget: targetTotal,
        totalAchieved: targetAchieved,
        achievementRate: Math.round(targetAchievementRate * 100) / 100,
      },
    };
  }
}
