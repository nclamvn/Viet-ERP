import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateApprovalDto } from './dto/create-approval.dto';
import { ApprovalQueryDto } from './dto/approval-query.dto';
import { ApproveRejectDto } from './dto/approve-reject.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST APPROVALS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: ApprovalQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { status, budgetId, reviewerId, level, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    // Build where clause
    const where: Prisma.BudgetApprovalWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (budgetId) {
      where.budgetId = budgetId;
    }

    if (reviewerId) {
      where.reviewerId = reviewerId;
    }

    if (level !== undefined) {
      where.level = level;
    }

    // Build orderBy
    const validSortFields = ['createdAt', 'level', 'status', 'submittedAt', 'reviewedAt'];
    const orderBy: Prisma.BudgetApprovalOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.budgetApproval.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          budget: {
            select: {
              id: true,
              code: true,
              name: true,
              totalAmount: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.budgetApproval.count({ where }),
    ]);

    // Transform data
    const transformedData = data.map((approval) => this.transformApproval(approval));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET APPROVAL SUMMARY (stats by status)
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const approvals = await this.prisma.budgetApproval.findMany({
      select: {
        status: true,
      },
    });

    // Count by status
    const byStatus: Record<string, number> = {};
    approvals.forEach((a) => {
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    });

    const totalCount = approvals.length;
    const pendingCount = (byStatus['UNDER_REVIEW'] || 0) + (byStatus['SUBMITTED'] || 0);
    const approvedCount = byStatus['APPROVED'] || 0;
    const rejectedCount = byStatus['REJECTED'] || 0;

    return {
      totalCount,
      pendingCount,
      approvedCount,
      rejectedCount,
      byStatus,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET PENDING APPROVALS FOR REVIEWER
  // ═══════════════════════════════════════════════════════════════════════════
  async getPendingForReviewer(reviewerId: string) {
    const approvals = await this.prisma.budgetApproval.findMany({
      where: {
        reviewerId,
        status: { in: ['UNDER_REVIEW', 'SUBMITTED'] },
      },
      include: {
        budget: {
          select: {
            id: true,
            code: true,
            name: true,
            totalAmount: true,
            status: true,
            year: true,
            quarter: true,
          },
        },
      },
      orderBy: { submittedAt: 'asc' },
    });

    return approvals.map((approval) => this.transformApproval(approval));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET APPROVALS FOR BUDGET
  // ═══════════════════════════════════════════════════════════════════════════
  async getForBudget(budgetId: string) {
    // Verify budget exists
    const budget = await this.prisma.budget.findUnique({
      where: { id: budgetId },
      select: { id: true },
    });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${budgetId} not found`);
    }

    const approvals = await this.prisma.budgetApproval.findMany({
      where: { budgetId },
      include: {
        budget: {
          select: {
            id: true,
            code: true,
            name: true,
            totalAmount: true,
            status: true,
          },
        },
      },
      orderBy: { level: 'asc' },
    });

    return approvals.map((approval) => this.transformApproval(approval));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE APPROVAL
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const approval = await this.prisma.budgetApproval.findUnique({
      where: { id },
      include: {
        budget: {
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            totalAmount: true,
            allocatedAmount: true,
            spentAmount: true,
            status: true,
            approvalStatus: true,
            year: true,
            quarter: true,
            createdBy: true,
          },
        },
      },
    });

    if (!approval) {
      throw new NotFoundException(`Approval with ID ${id} not found`);
    }

    return this.transformApproval(approval);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE APPROVAL REQUEST
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateApprovalDto) {
    // Verify budget exists
    const budget = await this.prisma.budget.findUnique({
      where: { id: dto.budgetId },
      select: { id: true, code: true },
    });

    if (!budget) {
      throw new NotFoundException(`Budget with ID ${dto.budgetId} not found`);
    }

    // Check for duplicate approval at same level for same budget
    const existing = await this.prisma.budgetApproval.findFirst({
      where: {
        budgetId: dto.budgetId,
        level: dto.level,
        status: { in: ['UNDER_REVIEW', 'SUBMITTED'] },
      },
    });

    if (existing) {
      throw new BadRequestException(
        `An active approval already exists for budget ${budget.code} at level ${dto.level}`,
      );
    }

    const approval = await this.prisma.budgetApproval.create({
      data: {
        budgetId: dto.budgetId,
        level: dto.level,
        role: dto.role,
        status: 'UNDER_REVIEW',
        reviewerId: dto.reviewerId,
        reviewerName: dto.reviewerName,
        comments: dto.comments,
        submittedAt: new Date(),
      },
      include: {
        budget: {
          select: {
            id: true,
            code: true,
            name: true,
            totalAmount: true,
            status: true,
          },
        },
      },
    });

    this.logger.log(
      `Approval created for budget ${budget.code} at level ${dto.level} (role: ${dto.role})`,
    );

    return this.transformApproval(approval);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APPROVE
  // ═══════════════════════════════════════════════════════════════════════════
  async approve(id: string, dto: ApproveRejectDto, userId: string) {
    const approval = await this.prisma.budgetApproval.findUnique({
      where: { id },
      include: {
        budget: {
          select: { id: true, code: true },
        },
      },
    });

    if (!approval) {
      throw new NotFoundException(`Approval with ID ${id} not found`);
    }

    if (!['UNDER_REVIEW', 'SUBMITTED'].includes(approval.status)) {
      throw new BadRequestException(
        `Approval is in ${approval.status} status and cannot be approved. Only UNDER_REVIEW or SUBMITTED approvals can be approved.`,
      );
    }

    const updated = await this.prisma.budgetApproval.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewerId: userId,
        comments: dto.comments,
        reviewedAt: new Date(),
      },
      include: {
        budget: {
          select: {
            id: true,
            code: true,
            name: true,
            totalAmount: true,
            status: true,
          },
        },
      },
    });

    this.logger.log(`Approval ${id} approved by user ${userId} for budget ${approval.budget.code}`);

    return this.transformApproval(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REJECT
  // ═══════════════════════════════════════════════════════════════════════════
  async reject(id: string, dto: ApproveRejectDto, userId: string) {
    const approval = await this.prisma.budgetApproval.findUnique({
      where: { id },
      include: {
        budget: {
          select: { id: true, code: true },
        },
      },
    });

    if (!approval) {
      throw new NotFoundException(`Approval with ID ${id} not found`);
    }

    if (!['UNDER_REVIEW', 'SUBMITTED'].includes(approval.status)) {
      throw new BadRequestException(
        `Approval is in ${approval.status} status and cannot be rejected. Only UNDER_REVIEW or SUBMITTED approvals can be rejected.`,
      );
    }

    const updated = await this.prisma.budgetApproval.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewerId: userId,
        comments: dto.comments,
        reviewedAt: new Date(),
      },
      include: {
        budget: {
          select: {
            id: true,
            code: true,
            name: true,
            totalAmount: true,
            status: true,
          },
        },
      },
    });

    this.logger.log(`Approval ${id} rejected by user ${userId} for budget ${approval.budget.code}`);

    return this.transformApproval(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Approval for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformApproval(approval: any) {
    return {
      id: approval.id,
      budgetId: approval.budgetId,
      level: approval.level,
      role: approval.role,
      status: approval.status,
      reviewerId: approval.reviewerId,
      reviewerName: approval.reviewerName,
      comments: approval.comments,
      submittedAt: approval.submittedAt,
      reviewedAt: approval.reviewedAt,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
      budget: approval.budget
        ? {
            ...approval.budget,
            totalAmount: approval.budget.totalAmount
              ? Number(approval.budget.totalAmount)
              : undefined,
            allocatedAmount: approval.budget.allocatedAmount
              ? Number(approval.budget.allocatedAmount)
              : undefined,
            spentAmount: approval.budget.spentAmount
              ? Number(approval.budget.spentAmount)
              : undefined,
          }
        : undefined,
    };
  }
}
