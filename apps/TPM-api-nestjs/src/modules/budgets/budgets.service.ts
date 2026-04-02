import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { BudgetQueryDto } from './dto/budget-query.dto';
import { CreateAllocationDto } from './dto/create-allocation.dto';
import { ApproveBudgetDto, RejectBudgetDto } from './dto/approve-budget.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class BudgetsService {
  private readonly logger = new Logger(BudgetsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST BUDGETS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: BudgetQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      status,
      year,
      quarter,
      category,
      search,
      startDateFrom,
      endDateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.BudgetWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (year) {
      where.year = year;
    }

    if (quarter) {
      where.quarter = quarter;
    }

    if (category) {
      where.category = category;
    }

    if (startDateFrom) {
      where.startDate = { gte: new Date(startDateFrom) };
    }

    if (endDateTo) {
      where.endDate = { lte: new Date(endDateTo) };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = ['createdAt', 'name', 'totalAmount', 'startDate', 'year', 'status'];
    const orderBy: Prisma.BudgetOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.budget.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          allocations: {
            select: { id: true },
          },
          activities: {
            select: { id: true },
          },
          _count: {
            select: { allocations: true, activities: true, approvals: true },
          },
        },
      }),
      this.prisma.budget.count({ where }),
    ]);

    // Transform data to match frontend expectations
    const transformedData = data.map((budget) => this.transformBudget(budget));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE BUDGET
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const budget = await this.prisma.budget.findUnique({
      where: { id },
      include: {
        allocations: {
          include: {
            geographicUnit: {
              select: { id: true, name: true, code: true, level: true },
            },
            children: {
              select: { id: true, code: true, allocatedAmount: true, status: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        approvals: {
          orderBy: { level: 'asc' },
        },
        activities: {
          select: {
            id: true,
            activityType: true,
            activityName: true,
            activityCode: true,
            allocatedAmount: true,
            spentAmount: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: { allocations: true, activities: true, approvals: true },
        },
      },
    });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${id} not found`);
    }

    return this.transformBudgetDetail(budget);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE BUDGET
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateBudgetDto, userId: string) {
    // Validate dates if both provided
    if (dto.startDate && dto.endDate) {
      const startDate = new Date(dto.startDate);
      const endDate = new Date(dto.endDate);

      if (endDate <= startDate) {
        throw new BadRequestException('End date must be after start date');
      }
    }

    // Generate unique code
    const code = await this.generateBudgetCode(dto.year, dto.quarter);

    // Check for duplicate in same period
    const existing = await this.prisma.budget.findFirst({
      where: {
        year: dto.year,
        quarter: dto.quarter,
        name: dto.name,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Budget with same name already exists for ${dto.year}${dto.quarter ? ` Q${dto.quarter}` : ''}`,
      );
    }

    const budget = await this.prisma.budget.create({
      data: {
        code,
        name: dto.name,
        description: dto.description,
        year: dto.year,
        quarter: dto.quarter,
        totalAmount: dto.totalAmount,
        allocatedAmount: 0,
        spentAmount: 0,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        category: dto.category,
        fundType: dto.fundType || 'PROMOTIONAL',
        status: 'DRAFT',
        approvalStatus: 'DRAFT',
        createdBy: userId,
      },
    });

    this.logger.log(`Budget created: ${budget.code} by user ${userId}`);

    return this.transformBudget(budget);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE BUDGET
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateBudgetDto, userId: string) {
    const budget = await this.prisma.budget.findUnique({ where: { id } });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${id} not found`);
    }

    // Only allow updates in DRAFT status
    if (budget.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot update budget in ${budget.status} status. Only DRAFT budgets can be modified.`,
      );
    }

    // Validate dates if provided
    if (dto.startDate || dto.endDate) {
      const startDate = dto.startDate ? new Date(dto.startDate) : budget.startDate || new Date();
      const endDate = dto.endDate ? new Date(dto.endDate) : budget.endDate || new Date();

      if (endDate <= startDate) {
        throw new BadRequestException('End date must be after start date');
      }
    }

    // Validate amount if provided
    if (dto.totalAmount !== undefined) {
      const currentAllocated = Number(budget.allocatedAmount);
      if (dto.totalAmount < currentAllocated) {
        throw new BadRequestException(
          `Total amount cannot be less than allocated amount (${currentAllocated})`,
        );
      }
    }

    const updated = await this.prisma.budget.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        quarter: dto.quarter,
        totalAmount: dto.totalAmount,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        category: dto.category,
        fundType: dto.fundType,
      },
    });

    this.logger.log(`Budget updated: ${updated.code} by user ${userId}`);

    return this.transformBudget(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE BUDGET
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string, userId: string) {
    const budget = await this.prisma.budget.findUnique({
      where: { id },
      include: {
        _count: { select: { activities: true, allocations: true } },
      },
    });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${id} not found`);
    }

    // Only allow deletion in DRAFT or CANCELLED status
    if (!['DRAFT', 'CANCELLED'].includes(budget.status)) {
      throw new BadRequestException(
        `Cannot delete budget in ${budget.status} status. Only DRAFT or CANCELLED budgets can be deleted.`,
      );
    }

    // Check if budget has activities
    if (budget._count.activities > 0) {
      throw new BadRequestException(
        'Cannot delete budget with linked activities. Remove activities first.',
      );
    }

    // Delete budget (cascades to allocations and approvals)
    await this.prisma.budget.delete({
      where: { id },
    });

    this.logger.log(`Budget deleted: ${budget.code} by user ${userId}`);

    return { success: true, message: 'Budget deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBMIT FOR APPROVAL
  // ═══════════════════════════════════════════════════════════════════════════
  async submitForApproval(id: string, userId: string) {
    const budget = await this.prisma.budget.findUnique({ where: { id } });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${id} not found`);
    }

    if (budget.status !== 'DRAFT' || budget.approvalStatus !== 'DRAFT') {
      throw new BadRequestException(
        `Budget must be in DRAFT status to submit for approval. Current status: ${budget.status}`,
      );
    }

    const updated = await this.prisma.budget.update({
      where: { id },
      data: {
        approvalStatus: 'SUBMITTED',
        currentLevel: 1,
      },
    });

    // Create first approval record
    await this.prisma.budgetApproval.create({
      data: {
        budgetId: id,
        level: 1,
        role: 'Manager',
        status: 'UNDER_REVIEW',
      },
    });

    this.logger.log(`Budget submitted for approval: ${budget.code} by user ${userId}`);

    return this.transformBudget(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APPROVE BUDGET
  // ═══════════════════════════════════════════════════════════════════════════
  async approve(id: string, dto: ApproveBudgetDto, userId: string) {
    const budget = await this.prisma.budget.findUnique({ where: { id } });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${id} not found`);
    }

    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(budget.approvalStatus)) {
      throw new BadRequestException(
        `Budget must be in SUBMITTED or UNDER_REVIEW status to approve. Current: ${budget.approvalStatus}`,
      );
    }

    // Update the current approval record
    const currentApproval = await this.prisma.budgetApproval.findFirst({
      where: {
        budgetId: id,
        level: budget.currentLevel,
        status: 'UNDER_REVIEW',
      },
    });

    if (currentApproval) {
      await this.prisma.budgetApproval.update({
        where: { id: currentApproval.id },
        data: {
          status: 'APPROVED',
          reviewerId: userId,
          comments: dto.comments,
          reviewedAt: new Date(),
        },
      });
    }

    // Determine next status
    const isFullyApproved =
      budget.currentLevel >= budget.approvalLevel || budget.approvalLevel === 0;
    const now = new Date();
    const startDate = budget.startDate;

    let nextStatus = budget.status;
    let nextApprovalStatus = budget.approvalStatus;

    if (isFullyApproved) {
      nextApprovalStatus = 'APPROVED';
      nextStatus = startDate && now >= startDate ? 'ACTIVE' : 'APPROVED';
    } else {
      nextApprovalStatus = 'UNDER_REVIEW';
    }

    const updated = await this.prisma.budget.update({
      where: { id },
      data: {
        status: nextStatus,
        approvalStatus: nextApprovalStatus,
        currentLevel: isFullyApproved ? budget.currentLevel : budget.currentLevel + 1,
      },
    });

    this.logger.log(`Budget approved: ${budget.code} by user ${userId}`);

    return this.transformBudget(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REJECT BUDGET
  // ═══════════════════════════════════════════════════════════════════════════
  async reject(id: string, dto: RejectBudgetDto, userId: string) {
    const budget = await this.prisma.budget.findUnique({ where: { id } });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${id} not found`);
    }

    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(budget.approvalStatus)) {
      throw new BadRequestException(
        `Budget must be in SUBMITTED or UNDER_REVIEW status to reject. Current: ${budget.approvalStatus}`,
      );
    }

    // Update the current approval record
    const currentApproval = await this.prisma.budgetApproval.findFirst({
      where: {
        budgetId: id,
        level: budget.currentLevel,
        status: 'UNDER_REVIEW',
      },
    });

    if (currentApproval) {
      await this.prisma.budgetApproval.update({
        where: { id: currentApproval.id },
        data: {
          status: 'REJECTED',
          reviewerId: userId,
          comments: dto.reason,
          reviewedAt: new Date(),
        },
      });
    }

    const updated = await this.prisma.budget.update({
      where: { id },
      data: {
        status: 'DRAFT',
        approvalStatus: 'REJECTED',
        currentLevel: 0,
      },
    });

    this.logger.log(`Budget rejected: ${budget.code} by user ${userId}, reason: ${dto.reason}`);

    return this.transformBudget(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLOSE BUDGET
  // ═══════════════════════════════════════════════════════════════════════════
  async close(id: string, userId: string) {
    const budget = await this.prisma.budget.findUnique({ where: { id } });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${id} not found`);
    }

    if (!['APPROVED', 'ACTIVE'].includes(budget.status)) {
      throw new BadRequestException(
        `Budget must be in APPROVED or ACTIVE status to close. Current status: ${budget.status}`,
      );
    }

    const updated = await this.prisma.budget.update({
      where: { id },
      data: {
        status: 'CLOSED',
        isActive: false,
      },
    });

    this.logger.log(`Budget closed: ${budget.code} by user ${userId}`);

    return this.transformBudget(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET ALLOCATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  async getAllocations(budgetId: string) {
    const budget = await this.prisma.budget.findUnique({ where: { id: budgetId } });
    if (!budget) {
      throw new NotFoundException(`Budget with ID ${budgetId} not found`);
    }

    const allocations = await this.prisma.budgetAllocation.findMany({
      where: { budgetId },
      include: {
        geographicUnit: {
          select: { id: true, name: true, code: true, level: true },
        },
        children: {
          select: { id: true, code: true, allocatedAmount: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return allocations.map((a) => this.transformAllocation(a));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE ALLOCATION
  // ═══════════════════════════════════════════════════════════════════════════
  async createAllocation(budgetId: string, dto: CreateAllocationDto, userId: string) {
    const budget = await this.prisma.budget.findUnique({ where: { id: budgetId } });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${budgetId} not found`);
    }

    // Only allow allocations in DRAFT status
    if (budget.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot add allocations to budget in ${budget.status} status`);
    }

    // Check total allocations don't exceed budget
    const currentAllocations = await this.prisma.budgetAllocation.aggregate({
      where: { budgetId },
      _sum: { allocatedAmount: true },
    });

    const currentTotal = Number(currentAllocations._sum.allocatedAmount || 0);
    const budgetTotal = Number(budget.totalAmount);
    const newTotal = currentTotal + dto.allocatedAmount;

    if (newTotal > budgetTotal) {
      throw new BadRequestException(
        `Allocation would exceed budget total. Available: ${budgetTotal - currentTotal}, Requested: ${dto.allocatedAmount}`,
      );
    }

    // Generate allocation code
    const allocationCode = await this.generateAllocationCode(budgetId);

    // Create allocation
    const allocation = await this.prisma.budgetAllocation.create({
      data: {
        code: allocationCode,
        budgetId,
        geographicUnitId: dto.geographicUnitId,
        allocatedAmount: dto.allocatedAmount,
        spentAmount: 0,
        childrenAllocated: 0,
        availableToAllocate: dto.allocatedAmount,
        parentId: dto.parentId,
        notes: dto.notes,
        status: 'DRAFT',
        createdBy: userId,
      },
      include: {
        geographicUnit: {
          select: { id: true, name: true, code: true, level: true },
        },
      },
    });

    // Update budget allocated amount
    await this.prisma.budget.update({
      where: { id: budgetId },
      data: {
        allocatedAmount: newTotal,
      },
    });

    // If this is a child allocation, update parent's childrenAllocated
    if (dto.parentId) {
      const parentAlloc = await this.prisma.budgetAllocation.findUnique({
        where: { id: dto.parentId },
      });
      if (parentAlloc) {
        const newChildrenAllocated = Number(parentAlloc.childrenAllocated) + dto.allocatedAmount;
        await this.prisma.budgetAllocation.update({
          where: { id: dto.parentId },
          data: {
            childrenAllocated: newChildrenAllocated,
            availableToAllocate: Number(parentAlloc.allocatedAmount) - newChildrenAllocated,
          },
        });
      }
    }

    this.logger.log(`Allocation created for budget ${budget.code}: ${dto.allocatedAmount} VND`);

    return this.transformAllocation(allocation);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE ALLOCATION
  // ═══════════════════════════════════════════════════════════════════════════
  async deleteAllocation(budgetId: string, allocationId: string, userId: string) {
    const budget = await this.prisma.budget.findUnique({ where: { id: budgetId } });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${budgetId} not found`);
    }

    if (budget.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot remove allocations from budget in ${budget.status} status`,
      );
    }

    const allocation = await this.prisma.budgetAllocation.findUnique({
      where: { id: allocationId },
      include: { _count: { select: { children: true } } },
    });

    if (!allocation || allocation.budgetId !== budgetId) {
      throw new NotFoundException('Allocation not found');
    }

    // Prevent deleting allocations with children
    if (allocation._count.children > 0) {
      throw new BadRequestException(
        'Cannot delete allocation with child allocations. Delete children first.',
      );
    }

    // Delete allocation
    await this.prisma.budgetAllocation.delete({
      where: { id: allocationId },
    });

    // Update budget allocated amount
    const allocAmount = Number(allocation.allocatedAmount);
    const newAllocated = Number(budget.allocatedAmount) - allocAmount;
    await this.prisma.budget.update({
      where: { id: budgetId },
      data: {
        allocatedAmount: Math.max(0, newAllocated),
      },
    });

    // If this was a child, update parent's childrenAllocated
    if (allocation.parentId) {
      const parentAlloc = await this.prisma.budgetAllocation.findUnique({
        where: { id: allocation.parentId },
      });
      if (parentAlloc) {
        const newChildrenAllocated = Math.max(
          0,
          Number(parentAlloc.childrenAllocated) - allocAmount,
        );
        await this.prisma.budgetAllocation.update({
          where: { id: allocation.parentId },
          data: {
            childrenAllocated: newChildrenAllocated,
            availableToAllocate: Number(parentAlloc.allocatedAmount) - newChildrenAllocated,
          },
        });
      }
    }

    this.logger.log(`Allocation deleted from budget ${budget.code} by user ${userId}`);

    return { success: true, message: 'Allocation deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET BUDGET SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary(year?: number) {
    const where: Prisma.BudgetWhereInput = {};

    if (year) {
      where.year = year;
    }

    const budgets = await this.prisma.budget.findMany({
      where,
      select: {
        totalAmount: true,
        allocatedAmount: true,
        spentAmount: true,
        status: true,
        year: true,
      },
    });

    // Calculate totals
    const totalBudget = budgets.reduce((sum, b) => sum + Number(b.totalAmount), 0);
    const totalAllocated = budgets.reduce((sum, b) => sum + Number(b.allocatedAmount), 0);
    const totalSpent = budgets.reduce((sum, b) => sum + Number(b.spentAmount), 0);
    const totalRemaining = totalBudget - totalAllocated;
    const totalAvailable = totalBudget - totalSpent;

    // Count by status
    const byStatus: Record<string, number> = {};
    budgets.forEach((b) => {
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
    });

    // Count by year
    const byYear: Record<number, number> = {};
    budgets.forEach((b) => {
      byYear[b.year] = (byYear[b.year] || 0) + Number(b.totalAmount);
    });

    return {
      totalBudget,
      totalAllocated,
      totalSpent,
      totalRemaining,
      totalAvailable,
      utilizationRate: totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0,
      allocationRate: totalBudget > 0 ? (totalAllocated / totalBudget) * 100 : 0,
      budgetCount: budgets.length,
      byStatus,
      byYear,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET AVAILABLE YEARS
  // ═══════════════════════════════════════════════════════════════════════════
  async getAvailableYears() {
    const result = await this.prisma.budget.findMany({
      select: { year: true },
      distinct: ['year'],
      orderBy: { year: 'desc' },
    });

    return result.map((r) => r.year);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET BUDGET CATEGORIES
  // ═══════════════════════════════════════════════════════════════════════════
  async getCategories() {
    const result = await this.prisma.budget.findMany({
      where: {
        category: { not: null },
      },
      select: { category: true },
      distinct: ['category'],
    });

    return result.map((r) => r.category).filter(Boolean);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Generate Budget Code
  // ═══════════════════════════════════════════════════════════════════════════
  private async generateBudgetCode(year: number, quarter?: number): Promise<string> {
    const prefix = quarter ? `BUD-${year}-Q${quarter}` : `BUD-${year}`;

    const lastBudget = await this.prisma.budget.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });

    let sequence = 1;
    if (lastBudget) {
      const parts = lastBudget.code.split('-');
      const lastNumber = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNumber)) {
        sequence = lastNumber + 1;
      }
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Generate Allocation Code
  // ═══════════════════════════════════════════════════════════════════════════
  private async generateAllocationCode(budgetId: string): Promise<string> {
    const budget = await this.prisma.budget.findUnique({
      where: { id: budgetId },
      select: { code: true },
    });

    const prefix = `ALLOC-${budget?.code || 'UNK'}`;

    const lastAlloc = await this.prisma.budgetAllocation.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });

    let sequence = 1;
    if (lastAlloc) {
      const parts = lastAlloc.code.split('-');
      const lastNumber = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNumber)) {
        sequence = lastNumber + 1;
      }
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Budget for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformBudget(budget: any) {
    const totalAmount = Number(budget.totalAmount);
    const allocatedAmount = Number(budget.allocatedAmount);
    const spentAmount = Number(budget.spentAmount);

    return {
      id: budget.id,
      code: budget.code,
      name: budget.name,
      description: budget.description,
      category: budget.category,
      fundType: budget.fundType,
      year: budget.year,
      quarter: budget.quarter,
      startDate: budget.startDate,
      endDate: budget.endDate,
      totalAmount,
      allocatedAmount,
      spentAmount,
      remainingAmount: totalAmount - allocatedAmount,
      availableAmount: totalAmount - spentAmount,
      utilizationRate: totalAmount > 0 ? (spentAmount / totalAmount) * 100 : 0,
      allocationRate: totalAmount > 0 ? (allocatedAmount / totalAmount) * 100 : 0,
      status: budget.status,
      approvalStatus: budget.approvalStatus,
      approvalLevel: budget.approvalLevel,
      currentLevel: budget.currentLevel,
      isActive: budget.isActive,
      createdBy: budget.createdBy,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
      allocationCount: budget._count?.allocations || 0,
      activityCount: budget._count?.activities || 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Budget Detail for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformBudgetDetail(budget: any) {
    const base = this.transformBudget(budget);

    return {
      ...base,
      constraints: budget.constraints,
      allocations: budget.allocations?.map((a: any) => this.transformAllocation(a)) || [],
      approvals: budget.approvals || [],
      activities:
        budget.activities?.map((act: any) => ({
          ...act,
          allocatedAmount: Number(act.allocatedAmount),
          spentAmount: Number(act.spentAmount),
        })) || [],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Allocation for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformAllocation(allocation: any) {
    return {
      id: allocation.id,
      code: allocation.code,
      budgetId: allocation.budgetId,
      geographicUnitId: allocation.geographicUnitId,
      geographicUnit: allocation.geographicUnit,
      parentId: allocation.parentId,
      allocatedAmount: Number(allocation.allocatedAmount),
      spentAmount: Number(allocation.spentAmount),
      childrenAllocated: Number(allocation.childrenAllocated),
      availableToAllocate: Number(allocation.availableToAllocate),
      status: allocation.status,
      approvedBy: allocation.approvedBy,
      approvedAt: allocation.approvedAt,
      notes: allocation.notes,
      createdAt: allocation.createdAt,
      updatedAt: allocation.updatedAt,
      createdBy: allocation.createdBy,
      children:
        allocation.children?.map((c: any) => ({
          ...c,
          allocatedAmount: Number(c.allocatedAmount),
        })) || [],
    };
  }
}
