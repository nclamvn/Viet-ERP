import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { RecordSpendingDto } from './dto/record-spending.dto';
import { UpdateRoiDto } from './dto/update-roi.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST ACTIVITIES (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: ActivityQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      budgetId,
      activityType,
      status,
      promotionId,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.FundActivityWhereInput = {};

    if (budgetId) {
      where.budgetId = budgetId;
    }

    if (activityType) {
      where.activityType = activityType;
    }

    if (status) {
      where.status = status;
    }

    if (promotionId) {
      where.promotionId = promotionId;
    }

    if (search) {
      where.OR = [
        { activityName: { contains: search, mode: 'insensitive' } },
        { activityCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = [
      'createdAt',
      'updatedAt',
      'activityName',
      'activityType',
      'allocatedAmount',
      'spentAmount',
      'startDate',
      'endDate',
      'status',
    ];
    const orderBy: Prisma.FundActivityOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.fundActivity.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          budget: {
            select: { id: true, code: true, name: true },
          },
          budgetAllocation: {
            select: { id: true, code: true },
          },
        },
      }),
      this.prisma.fundActivity.count({ where }),
    ]);

    // Transform data
    const transformedData = data.map((activity) => this.transformActivity(activity));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE ACTIVITY
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const activity = await this.prisma.fundActivity.findUnique({
      where: { id },
      include: {
        budget: {
          select: {
            id: true,
            code: true,
            name: true,
            totalAmount: true,
            spentAmount: true,
            status: true,
          },
        },
        budgetAllocation: {
          select: { id: true, code: true, allocatedAmount: true },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException(`Activity with ID ${id} not found`);
    }

    return this.transformActivity(activity);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE ACTIVITY
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateActivityDto, userId?: string) {
    // Validate budget exists
    const budget = await this.prisma.budget.findUnique({
      where: { id: dto.budgetId },
    });

    if (!budget) {
      throw new BadRequestException(`Budget with ID ${dto.budgetId} not found`);
    }

    // Validate budget allocation exists if provided
    if (dto.budgetAllocationId) {
      const allocation = await this.prisma.budgetAllocation.findUnique({
        where: { id: dto.budgetAllocationId },
      });

      if (!allocation) {
        throw new BadRequestException(
          `Budget Allocation with ID ${dto.budgetAllocationId} not found`,
        );
      }

      // Validate allocation belongs to the same budget
      if (allocation.budgetId !== dto.budgetId) {
        throw new BadRequestException(
          `Budget Allocation ${dto.budgetAllocationId} does not belong to Budget ${dto.budgetId}`,
        );
      }
    }

    // Validate dates (end > start)
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    // Validate allocated amount doesn't exceed budget's available amount
    const budgetTotal = Number(budget.totalAmount || 0);
    const budgetSpent = Number(budget.spentAmount || 0);
    const budgetAvailable = budgetTotal - budgetSpent;

    // Sum existing activity allocations for this budget
    const existingAllocations = await this.prisma.fundActivity.aggregate({
      where: { budgetId: dto.budgetId },
      _sum: { allocatedAmount: true },
    });

    const totalAllocated = Number(existingAllocations._sum.allocatedAmount || 0);
    const remainingBudget = budgetTotal - totalAllocated;

    if (dto.allocatedAmount > remainingBudget) {
      throw new BadRequestException(
        `Allocated amount (${dto.allocatedAmount}) exceeds budget's remaining allocatable amount (${remainingBudget.toFixed(2)}). ` +
          `Budget total: ${budgetTotal.toFixed(2)}, already allocated to activities: ${totalAllocated.toFixed(2)}`,
      );
    }

    const activity = await this.prisma.fundActivity.create({
      data: {
        budgetId: dto.budgetId,
        budgetAllocationId: dto.budgetAllocationId || null,
        promotionId: dto.promotionId || null,
        activityType: dto.activityType,
        activityName: dto.activityName,
        activityCode: dto.activityCode || null,
        allocatedAmount: dto.allocatedAmount,
        spentAmount: 0,
        startDate,
        endDate,
        status: 'PLANNED',
        notes: dto.notes || null,
        createdBy: userId || null,
      },
      include: {
        budget: {
          select: { id: true, code: true, name: true },
        },
        budgetAllocation: {
          select: { id: true, code: true },
        },
      },
    });

    this.logger.log(
      `Activity created: ${activity.activityName} (${activity.activityType}) for budget ${activity.budgetId}`,
    );

    return this.transformActivity(activity);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE ACTIVITY
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateActivityDto) {
    const activity = await this.prisma.fundActivity.findUnique({
      where: { id },
    });

    if (!activity) {
      throw new NotFoundException(`Activity with ID ${id} not found`);
    }

    // Only PLANNED activities can have allocatedAmount changed
    if (dto.allocatedAmount !== undefined && activity.status !== 'PLANNED') {
      throw new BadRequestException('Allocated amount can only be changed for PLANNED activities');
    }

    // Validate dates if provided
    if (dto.startDate || dto.endDate) {
      const startDate = dto.startDate ? new Date(dto.startDate) : activity.startDate;
      const endDate = dto.endDate ? new Date(dto.endDate) : activity.endDate;

      if (endDate <= startDate) {
        throw new BadRequestException('End date must be after start date');
      }
    }

    // Validate budget allocation if changing
    if (dto.budgetAllocationId) {
      const allocation = await this.prisma.budgetAllocation.findUnique({
        where: { id: dto.budgetAllocationId },
      });

      if (!allocation) {
        throw new BadRequestException(
          `Budget Allocation with ID ${dto.budgetAllocationId} not found`,
        );
      }

      if (allocation.budgetId !== activity.budgetId) {
        throw new BadRequestException(
          `Budget Allocation ${dto.budgetAllocationId} does not belong to Budget ${activity.budgetId}`,
        );
      }
    }

    // Build update data
    const updateData: Prisma.FundActivityUpdateInput = {};

    if (dto.activityType !== undefined) updateData.activityType = dto.activityType;
    if (dto.activityName !== undefined) updateData.activityName = dto.activityName;
    if (dto.activityCode !== undefined) updateData.activityCode = dto.activityCode;
    if (dto.allocatedAmount !== undefined) updateData.allocatedAmount = dto.allocatedAmount;
    if (dto.startDate !== undefined) updateData.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) updateData.endDate = new Date(dto.endDate);
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.promotionId !== undefined) updateData.promotionId = dto.promotionId;

    if (dto.budgetAllocationId !== undefined) {
      if (dto.budgetAllocationId === null) {
        updateData.budgetAllocation = { disconnect: true };
      } else {
        updateData.budgetAllocation = { connect: { id: dto.budgetAllocationId } };
      }
    }

    const updated = await this.prisma.fundActivity.update({
      where: { id },
      data: updateData,
      include: {
        budget: {
          select: { id: true, code: true, name: true },
        },
        budgetAllocation: {
          select: { id: true, code: true },
        },
      },
    });

    this.logger.log(`Activity updated: ${updated.activityName} (${updated.id})`);

    return this.transformActivity(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMOVE ACTIVITY
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const activity = await this.prisma.fundActivity.findUnique({
      where: { id },
    });

    if (!activity) {
      throw new NotFoundException(`Activity with ID ${id} not found`);
    }

    if (activity.status !== 'PLANNED') {
      throw new BadRequestException(
        `Only PLANNED activities can be deleted. Current status: ${activity.status}`,
      );
    }

    await this.prisma.fundActivity.delete({ where: { id } });

    this.logger.log(`Activity deleted: ${activity.activityName} (${id})`);

    return { success: true, message: 'Activity deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVATE ACTIVITY (PLANNED → ACTIVE)
  // ═══════════════════════════════════════════════════════════════════════════
  async activate(id: string) {
    const activity = await this.prisma.fundActivity.findUnique({
      where: { id },
    });

    if (!activity) {
      throw new NotFoundException(`Activity with ID ${id} not found`);
    }

    if (activity.status !== 'PLANNED') {
      throw new BadRequestException(
        `Only PLANNED activities can be activated. Current status: ${activity.status}`,
      );
    }

    if (Number(activity.allocatedAmount) <= 0) {
      throw new BadRequestException(
        'Activity must have an allocated amount greater than 0 to be activated',
      );
    }

    const updated = await this.prisma.fundActivity.update({
      where: { id },
      data: { status: 'ACTIVE' },
      include: {
        budget: {
          select: { id: true, code: true, name: true },
        },
        budgetAllocation: {
          select: { id: true, code: true },
        },
      },
    });

    this.logger.log(`Activity activated: ${updated.activityName} (${id})`);

    return this.transformActivity(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE ACTIVITY (ACTIVE → COMPLETED)
  // ═══════════════════════════════════════════════════════════════════════════
  async complete(id: string) {
    const activity = await this.prisma.fundActivity.findUnique({
      where: { id },
    });

    if (!activity) {
      throw new NotFoundException(`Activity with ID ${id} not found`);
    }

    if (activity.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Only ACTIVE activities can be completed. Current status: ${activity.status}`,
      );
    }

    // Auto-calculate ROI if revenueGenerated and spentAmount are available
    const spentAmount = Number(activity.spentAmount || 0);
    const revenueGenerated = activity.revenueGenerated ? Number(activity.revenueGenerated) : null;

    let roi: number | null = null;
    if (revenueGenerated !== null && spentAmount > 0) {
      roi = Number((revenueGenerated / spentAmount).toFixed(4));
    }

    const updateData: Prisma.FundActivityUpdateInput = {
      status: 'COMPLETED',
    };

    if (roi !== null) {
      updateData.roi = roi;
    }

    const updated = await this.prisma.fundActivity.update({
      where: { id },
      data: updateData,
      include: {
        budget: {
          select: { id: true, code: true, name: true },
        },
        budgetAllocation: {
          select: { id: true, code: true },
        },
      },
    });

    this.logger.log(`Activity completed: ${updated.activityName} (${id})`);

    return this.transformActivity(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECORD SPENDING (on ACTIVE activity)
  // ═══════════════════════════════════════════════════════════════════════════
  async recordSpending(id: string, dto: RecordSpendingDto) {
    const activity = await this.prisma.fundActivity.findUnique({
      where: { id },
    });

    if (!activity) {
      throw new NotFoundException(`Activity with ID ${id} not found`);
    }

    if (activity.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Spending can only be recorded on ACTIVE activities. Current status: ${activity.status}`,
      );
    }

    const currentSpent = Number(activity.spentAmount || 0);
    const allocatedAmount = Number(activity.allocatedAmount);
    const newTotalSpent = currentSpent + dto.amount;

    if (newTotalSpent > allocatedAmount) {
      throw new BadRequestException(
        `Spending of ${dto.amount.toFixed(2)} would exceed allocated amount. ` +
          `Current spent: ${currentSpent.toFixed(2)}, allocated: ${allocatedAmount.toFixed(2)}, ` +
          `remaining: ${(allocatedAmount - currentSpent).toFixed(2)}`,
      );
    }

    // Auto-recalculate ROI if revenueGenerated is set
    const revenueGenerated = activity.revenueGenerated ? Number(activity.revenueGenerated) : null;

    let roi: number | null = null;
    if (revenueGenerated !== null && newTotalSpent > 0) {
      roi = Number((revenueGenerated / newTotalSpent).toFixed(4));
    }

    const updateData: Prisma.FundActivityUpdateInput = {
      spentAmount: newTotalSpent,
    };

    if (roi !== null) {
      updateData.roi = roi;
    }

    if (dto.description) {
      // Append to notes
      const existingNotes = activity.notes || '';
      const timestamp = new Date().toISOString();
      const spendNote = `[${timestamp}] Spent: ${dto.amount.toFixed(2)} - ${dto.description}`;
      updateData.notes = existingNotes ? `${existingNotes}\n${spendNote}` : spendNote;
    }

    const updated = await this.prisma.fundActivity.update({
      where: { id },
      data: updateData,
      include: {
        budget: {
          select: { id: true, code: true, name: true },
        },
        budgetAllocation: {
          select: { id: true, code: true },
        },
      },
    });

    this.logger.log(
      `Spending recorded on activity ${id}: +${dto.amount.toFixed(2)} (total: ${newTotalSpent.toFixed(2)})`,
    );

    return this.transformActivity(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE ROI METRICS
  // ═══════════════════════════════════════════════════════════════════════════
  async updateROI(id: string, dto: UpdateRoiDto) {
    const activity = await this.prisma.fundActivity.findUnique({
      where: { id },
    });

    if (!activity) {
      throw new NotFoundException(`Activity with ID ${id} not found`);
    }

    const updateData: Prisma.FundActivityUpdateInput = {};

    if (dto.revenueGenerated !== undefined) {
      updateData.revenueGenerated = dto.revenueGenerated;
    }

    if (dto.unitsImpacted !== undefined) {
      updateData.unitsImpacted = dto.unitsImpacted;
    }

    // Auto-calculate ROI = revenueGenerated / spentAmount
    const revenueGenerated =
      dto.revenueGenerated !== undefined
        ? dto.revenueGenerated
        : activity.revenueGenerated
          ? Number(activity.revenueGenerated)
          : null;

    const spentAmount = Number(activity.spentAmount || 0);

    if (revenueGenerated !== null && spentAmount > 0) {
      updateData.roi = Number((revenueGenerated / spentAmount).toFixed(4));
    }

    const updated = await this.prisma.fundActivity.update({
      where: { id },
      data: updateData,
      include: {
        budget: {
          select: { id: true, code: true, name: true },
        },
        budgetAllocation: {
          select: { id: true, code: true },
        },
      },
    });

    this.logger.log(`ROI metrics updated for activity ${id}`);

    return this.transformActivity(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SUMMARY (aggregated stats by activityType and status)
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary(budgetId?: string) {
    const where: Prisma.FundActivityWhereInput = {};
    if (budgetId) {
      where.budgetId = budgetId;
    }

    // Aggregate by activityType
    const byType = await this.prisma.fundActivity.groupBy({
      by: ['activityType'],
      where,
      _sum: {
        allocatedAmount: true,
        spentAmount: true,
      },
      _count: {
        id: true,
      },
    });

    // Aggregate by status
    const byStatus = await this.prisma.fundActivity.groupBy({
      by: ['status'],
      where,
      _sum: {
        allocatedAmount: true,
        spentAmount: true,
      },
      _count: {
        id: true,
      },
    });

    // Overall totals
    const totals = await this.prisma.fundActivity.aggregate({
      where,
      _sum: {
        allocatedAmount: true,
        spentAmount: true,
        revenueGenerated: true,
      },
      _count: {
        id: true,
      },
    });

    const totalAllocated = Number(totals._sum.allocatedAmount || 0);
    const totalSpent = Number(totals._sum.spentAmount || 0);
    const totalRevenue = Number(totals._sum.revenueGenerated || 0);

    return {
      totals: {
        totalAllocated,
        totalSpent,
        remaining: totalAllocated - totalSpent,
        totalRevenue,
        activityCount: totals._count.id,
        utilizationRate:
          totalAllocated > 0 ? Number(((totalSpent / totalAllocated) * 100).toFixed(2)) : 0,
        overallROI: totalSpent > 0 ? Number((totalRevenue / totalSpent).toFixed(4)) : 0,
      },
      byType: byType.map((row) => {
        const allocated = Number(row._sum.allocatedAmount || 0);
        const spent = Number(row._sum.spentAmount || 0);
        return {
          activityType: row.activityType,
          totalAllocated: allocated,
          totalSpent: spent,
          remaining: allocated - spent,
          activityCount: row._count.id,
          utilizationRate: allocated > 0 ? Number(((spent / allocated) * 100).toFixed(2)) : 0,
        };
      }),
      byStatus: byStatus.map((row) => {
        const allocated = Number(row._sum.allocatedAmount || 0);
        const spent = Number(row._sum.spentAmount || 0);
        return {
          status: row.status,
          totalAllocated: allocated,
          totalSpent: spent,
          remaining: allocated - spent,
          activityCount: row._count.id,
        };
      }),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET ACTIVITY TYPES (distinct values)
  // ═══════════════════════════════════════════════════════════════════════════
  async getActivityTypes() {
    const result = await this.prisma.fundActivity.findMany({
      select: { activityType: true },
      distinct: ['activityType'],
      orderBy: { activityType: 'asc' },
    });

    return result.map((r) => r.activityType);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Activity for Response (Decimal → Number + computed)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformActivity(activity: any) {
    const allocatedAmount = Number(activity.allocatedAmount || 0);
    const spentAmount = Number(activity.spentAmount || 0);
    const revenueGenerated = activity.revenueGenerated ? Number(activity.revenueGenerated) : null;
    const roi = activity.roi ? Number(activity.roi) : null;

    const remainingAmount = allocatedAmount - spentAmount;
    const utilizationRate =
      allocatedAmount > 0 ? Number(((spentAmount / allocatedAmount) * 100).toFixed(2)) : 0;

    return {
      id: activity.id,
      budgetId: activity.budgetId,
      budgetAllocationId: activity.budgetAllocationId,
      promotionId: activity.promotionId,
      activityType: activity.activityType,
      activityName: activity.activityName,
      activityCode: activity.activityCode,
      allocatedAmount,
      spentAmount,
      remainingAmount,
      utilizationRate,
      revenueGenerated,
      unitsImpacted: activity.unitsImpacted,
      roi,
      startDate: activity.startDate,
      endDate: activity.endDate,
      status: activity.status,
      notes: activity.notes,
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
      createdBy: activity.createdBy,
      budget: activity.budget || null,
      budgetAllocation: activity.budgetAllocation || null,
    };
  }
}
