import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateSuggestionDto } from './dto/create-suggestion.dto';
import { CreateInsightDto } from './dto/create-insight.dto';
import { AIQueryDto } from './dto/ai-query.dto';
import {
  PaginationDto,
  createPaginatedResponse,
  getPaginationParams,
} from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // SUGGESTION METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────────────────────
  // LIST SUGGESTIONS (paginated)
  // ───────────────────────────────────────────────────────────────────────────
  async findAllSuggestions(query: PaginationDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { sortOrder = 'desc' } = query;

    const [data, total] = await Promise.all([
      this.prisma.aISuggestion.findMany({
        skip,
        take,
        orderBy: { createdAt: sortOrder },
      }),
      this.prisma.aISuggestion.count(),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET SINGLE SUGGESTION
  // ───────────────────────────────────────────────────────────────────────────
  async findOneSuggestion(id: string) {
    const suggestion = await this.prisma.aISuggestion.findUnique({
      where: { id },
    });

    if (!suggestion) {
      throw new NotFoundException(`AI Suggestion with ID ${id} not found`);
    }

    return suggestion;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CREATE SUGGESTION
  // ───────────────────────────────────────────────────────────────────────────
  async createSuggestion(dto: CreateSuggestionDto, userId: string) {
    const suggestion = await this.prisma.aISuggestion.create({
      data: {
        type: dto.type,
        input: dto.input as Prisma.InputJsonValue,
        output: dto.output as Prisma.InputJsonValue,
        userId,
      },
    });

    this.logger.log(
      `AI Suggestion created: ${suggestion.id} (type: ${suggestion.type}) by user ${userId}`,
    );

    return suggestion;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ACCEPT SUGGESTION
  // ───────────────────────────────────────────────────────────────────────────
  async acceptSuggestion(id: string) {
    const suggestion = await this.prisma.aISuggestion.findUnique({
      where: { id },
    });

    if (!suggestion) {
      throw new NotFoundException(`AI Suggestion with ID ${id} not found`);
    }

    const updated = await this.prisma.aISuggestion.update({
      where: { id },
      data: { accepted: true },
    });

    this.logger.log(`AI Suggestion accepted: ${id}`);

    return updated;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // REJECT SUGGESTION
  // ───────────────────────────────────────────────────────────────────────────
  async rejectSuggestion(id: string, feedback?: string) {
    const suggestion = await this.prisma.aISuggestion.findUnique({
      where: { id },
    });

    if (!suggestion) {
      throw new NotFoundException(`AI Suggestion with ID ${id} not found`);
    }

    const updated = await this.prisma.aISuggestion.update({
      where: { id },
      data: {
        accepted: false,
        feedback: feedback || null,
      },
    });

    this.logger.log(`AI Suggestion rejected: ${id}${feedback ? `, feedback: ${feedback}` : ''}`);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INSIGHT METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────────────────────
  // LIST INSIGHTS (paginated, filtered)
  // ───────────────────────────────────────────────────────────────────────────
  async findAllInsights(query: AIQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      type,
      entityType,
      isRead,
      isDismissed,
      minConfidence,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.AIInsightWhereInput = {};

    if (type) {
      where.type = type;
    }

    if (entityType) {
      where.entityType = entityType;
    }

    if (isRead !== undefined) {
      where.isRead = isRead;
    }

    if (isDismissed !== undefined) {
      where.isDismissed = isDismissed;
    }

    if (minConfidence !== undefined) {
      where.confidence = { gte: minConfidence };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = ['createdAt', 'type', 'priority', 'confidence', 'title'];
    const orderBy: Prisma.AIInsightOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.aIInsight.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      this.prisma.aIInsight.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET SINGLE INSIGHT
  // ───────────────────────────────────────────────────────────────────────────
  async findOneInsight(id: string) {
    const insight = await this.prisma.aIInsight.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!insight) {
      throw new NotFoundException(`AI Insight with ID ${id} not found`);
    }

    return insight;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET UNREAD INSIGHTS (not dismissed, not expired)
  // ───────────────────────────────────────────────────────────────────────────
  async getUnreadInsights() {
    const now = new Date();

    const insights = await this.prisma.aIInsight.findMany({
      where: {
        isRead: false,
        isDismissed: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return { data: insights, count: insights.length };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET INSIGHTS FOR ENTITY
  // ───────────────────────────────────────────────────────────────────────────
  async getInsightsForEntity(entityType: string, entityId: string) {
    const insights = await this.prisma.aIInsight.findMany({
      where: {
        entityType,
        entityId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return { data: insights, count: insights.length };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CREATE INSIGHT
  // ───────────────────────────────────────────────────────────────────────────
  async createInsight(dto: CreateInsightDto, userId: string) {
    const insight = await this.prisma.aIInsight.create({
      data: {
        type: dto.type,
        title: dto.title,
        description: dto.description,
        data: dto.data ? (dto.data as Prisma.InputJsonValue) : undefined,
        confidence: dto.confidence ?? 0,
        actionable: dto.actionable ?? false,
        action: dto.action,
        entityType: dto.entityType,
        entityId: dto.entityId,
        priority: dto.priority ?? 0,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        userId,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(
      `AI Insight created: ${insight.id} (type: ${insight.type}, title: ${insight.title}) by user ${userId}`,
    );

    return insight;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // MARK INSIGHT READ
  // ───────────────────────────────────────────────────────────────────────────
  async markRead(id: string) {
    const insight = await this.prisma.aIInsight.findUnique({
      where: { id },
    });

    if (!insight) {
      throw new NotFoundException(`AI Insight with ID ${id} not found`);
    }

    const updated = await this.prisma.aIInsight.update({
      where: { id },
      data: { isRead: true },
    });

    this.logger.log(`AI Insight marked as read: ${id}`);

    return updated;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DISMISS INSIGHT
  // ───────────────────────────────────────────────────────────────────────────
  async dismiss(id: string) {
    const insight = await this.prisma.aIInsight.findUnique({
      where: { id },
    });

    if (!insight) {
      throw new NotFoundException(`AI Insight with ID ${id} not found`);
    }

    const updated = await this.prisma.aIInsight.update({
      where: { id },
      data: { isDismissed: true },
    });

    this.logger.log(`AI Insight dismissed: ${id}`);

    return updated;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GENERATE MOCK INSIGHTS
  // ───────────────────────────────────────────────────────────────────────────
  async generateMockInsights(userId: string) {
    const mockInsights: Prisma.AIInsightCreateManyInput[] = [
      {
        type: 'TREND',
        title: 'Rising promotion redemption rates in Q1',
        description:
          'Promotion redemption rates have increased by 12% compared to the same period last year. Beverage category promotions are leading this trend with a 18% increase. Consider increasing budget allocation for high-performing categories.',
        data: {
          redemptionRate: 0.45,
          previousRate: 0.33,
          category: 'Beverages',
          period: 'Q1 2026',
        },
        confidence: 0.92,
        actionable: true,
        action: 'Review and increase budget for beverage category promotions',
        entityType: 'Category',
        priority: 4,
        userId,
      },
      {
        type: 'ANOMALY',
        title: 'Unusual spike in claim submissions from Eastern region',
        description:
          'There has been a 340% increase in claim submissions from the Eastern region in the last 7 days. This is significantly above the 2 standard deviation threshold. Investigation recommended to rule out fraudulent activity.',
        data: { region: 'Eastern', claimCount: 156, normalAverage: 35, stdDev: 12 },
        confidence: 0.95,
        actionable: true,
        action: 'Investigate Eastern region claims for potential fraud or data entry errors',
        entityType: 'Region',
        priority: 5,
        userId,
      },
      {
        type: 'RECOMMENDATION',
        title: 'Optimize discount structure for snack promotions',
        description:
          'Analysis of historical promotion performance suggests that 15-20% discount promotions on snack products yield the highest ROI (2.8x) compared to deeper discounts (25%+) which show diminishing returns (1.9x ROI). Recommend capping snack category discounts at 20%.',
        data: {
          optimalDiscount: { min: 15, max: 20 },
          currentAvgDiscount: 28,
          projectedROI: 2.8,
          currentROI: 1.9,
        },
        confidence: 0.85,
        actionable: true,
        action: 'Cap snack category promotion discounts at 20% for new promotions',
        entityType: 'Category',
        priority: 3,
        userId,
      },
      {
        type: 'FORECAST',
        title: 'Q2 promotion spend projected to exceed budget by 8%',
        description:
          'Based on current run rate and committed promotions, Q2 total promotional spending is projected to reach $2.16M against a budget of $2.0M. Early intervention recommended to prevent budget overrun.',
        data: {
          projectedSpend: 2160000,
          budget: 2000000,
          overagePercent: 8,
          confidenceInterval: { low: 2050000, high: 2280000 },
        },
        confidence: 0.78,
        actionable: true,
        action: 'Review Q2 promotion pipeline and prioritize high-ROI promotions',
        entityType: 'Budget',
        priority: 4,
        userId,
      },
      {
        type: 'ALERT',
        title: '3 promotions expiring with unspent budget',
        description:
          'Three active promotions are expiring within the next 14 days with significant unspent budget: "Summer Beverage Blast" ($45K remaining), "Weekend Snack Attack" ($23K remaining), and "Fresh Start Q1" ($12K remaining). Total unspent: $80K.',
        data: {
          promotions: [
            { name: 'Summer Beverage Blast', remaining: 45000 },
            { name: 'Weekend Snack Attack', remaining: 23000 },
            { name: 'Fresh Start Q1', remaining: 12000 },
          ],
          totalUnspent: 80000,
        },
        confidence: 1.0,
        actionable: true,
        action: 'Review expiring promotions and reallocate or extend budgets',
        priority: 5,
        userId,
      },
      {
        type: 'OPPORTUNITY',
        title: 'Cross-sell opportunity: Beverage + Snack bundle promotions',
        description:
          'Market basket analysis reveals that 67% of customers who purchase promoted beverages also purchase snack items. A combined bundle promotion could increase average basket size by an estimated 22% with minimal incremental cost.',
        data: {
          crossSellRate: 0.67,
          projectedBasketIncrease: 0.22,
          topPairings: ['Cola + Chips', 'Juice + Crackers', 'Water + Trail Mix'],
        },
        confidence: 0.81,
        actionable: true,
        action: 'Create beverage + snack bundle promotion for testing in select regions',
        entityType: 'Promotion',
        priority: 3,
        userId,
      },
    ];

    const result = await this.prisma.aIInsight.createMany({
      data: mockInsights,
    });

    this.logger.log(`Generated ${result.count} mock AI insights for user ${userId}`);

    return {
      success: true,
      message: `Generated ${result.count} mock insights`,
      count: result.count,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET INSIGHTS SUMMARY
  // ───────────────────────────────────────────────────────────────────────────
  async getSummary() {
    const insights = await this.prisma.aIInsight.findMany({
      select: {
        type: true,
        isRead: true,
        isDismissed: true,
        confidence: true,
        actionable: true,
        priority: true,
      },
    });

    const total = insights.length;
    const readCount = insights.filter((i) => i.isRead).length;
    const unreadCount = insights.filter((i) => !i.isRead).length;
    const dismissedCount = insights.filter((i) => i.isDismissed).length;
    const actionableCount = insights.filter((i) => i.actionable).length;
    const avgConfidence =
      total > 0 ? insights.reduce((sum, i) => sum + i.confidence, 0) / total : 0;

    // Aggregate by type
    const byType: Record<string, { count: number; avgConfidence: number; unread: number }> = {};
    insights.forEach((i) => {
      if (!byType[i.type]) {
        byType[i.type] = { count: 0, avgConfidence: 0, unread: 0 };
      }
      byType[i.type].count += 1;
      byType[i.type].avgConfidence += i.confidence;
      if (!i.isRead) {
        byType[i.type].unread += 1;
      }
    });

    // Calculate averages per type
    Object.keys(byType).forEach((type) => {
      byType[type].avgConfidence =
        byType[type].count > 0 ? byType[type].avgConfidence / byType[type].count : 0;
    });

    // Aggregate by priority
    const byPriority: Record<number, number> = {};
    insights.forEach((i) => {
      byPriority[i.priority] = (byPriority[i.priority] || 0) + 1;
    });

    return {
      total,
      readCount,
      unreadCount,
      dismissedCount,
      actionableCount,
      avgConfidence: Math.round(avgConfidence * 1000) / 1000,
      byType,
      byPriority,
    };
  }
}
