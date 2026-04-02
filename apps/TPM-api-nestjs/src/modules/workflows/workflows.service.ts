import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateApprovalRuleDto,
  ApprovalRuleTypeEnum,
  ChannelEnum,
} from './dto/create-approval-rule.dto';
import { UpdateApprovalRuleDto } from './dto/update-approval-rule.dto';
import { WorkflowQueryDto } from './dto/workflow-query.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma, ApprovalRuleType, Channel } from '.prisma/tpm-nestjs-client';

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST APPROVAL RULES (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: WorkflowQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      type,
      channel,
      isActive,
      companyId,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.ApprovalRuleWhereInput = {};

    if (type) {
      where.type = type as unknown as ApprovalRuleType;
    }

    if (channel) {
      where.channel = channel as unknown as Channel;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (companyId) {
      where.companyId = companyId;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = [
      'createdAt',
      'name',
      'minAmount',
      'maxAmount',
      'priority',
      'type',
      'isActive',
    ];
    const orderBy: Prisma.ApprovalRuleOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.approvalRule.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          company: {
            select: { id: true, name: true, code: true },
          },
        },
      }),
      this.prisma.approvalRule.count({ where }),
    ]);

    // Transform data
    const transformedData = data.map((rule) => this.transformRule(rule));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE APPROVAL RULE
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const rule = await this.prisma.approvalRule.findUnique({
      where: { id },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    if (!rule) {
      throw new NotFoundException(`Approval rule with ID ${id} not found`);
    }

    return this.transformRule(rule);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE APPROVAL RULE
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateApprovalRuleDto, userId: string) {
    // Validate approverRoles is not empty
    if (!dto.approverRoles || dto.approverRoles.length === 0) {
      throw new BadRequestException('approverRoles must not be empty');
    }

    // Validate minAmount <= maxAmount if both provided
    if (dto.maxAmount !== undefined && dto.maxAmount !== null) {
      if (dto.minAmount > dto.maxAmount) {
        throw new BadRequestException('minAmount must be less than or equal to maxAmount');
      }
    }

    // Validate unique [companyId, name]
    const existing = await this.prisma.approvalRule.findUnique({
      where: {
        companyId_name: {
          companyId: dto.companyId,
          name: dto.name,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Approval rule with name "${dto.name}" already exists for this company`,
      );
    }

    const rule = await this.prisma.approvalRule.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: (dto.type || 'SINGLE_APPROVAL') as ApprovalRuleType,
        minAmount: dto.minAmount,
        maxAmount: dto.maxAmount,
        channel: dto.channel as Channel | undefined,
        approverRoles: dto.approverRoles,
        priority: dto.priority ?? 0,
        isActive: dto.isActive ?? true,
        companyId: dto.companyId,
      },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`Approval rule created: "${rule.name}" (${rule.id}) by user ${userId}`);

    return this.transformRule(rule);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE APPROVAL RULE
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateApprovalRuleDto) {
    const rule = await this.prisma.approvalRule.findUnique({ where: { id } });

    if (!rule) {
      throw new NotFoundException(`Approval rule with ID ${id} not found`);
    }

    // Validate name uniqueness if changed
    if (dto.name && dto.name !== rule.name) {
      const existing = await this.prisma.approvalRule.findUnique({
        where: {
          companyId_name: {
            companyId: rule.companyId,
            name: dto.name,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          `Approval rule with name "${dto.name}" already exists for this company`,
        );
      }
    }

    // Validate minAmount <= maxAmount
    const effectiveMin = dto.minAmount ?? Number(rule.minAmount);
    const effectiveMax =
      dto.maxAmount !== undefined
        ? dto.maxAmount
        : rule.maxAmount !== null
          ? Number(rule.maxAmount)
          : null;

    if (effectiveMax !== null && effectiveMax !== undefined) {
      if (effectiveMin > effectiveMax) {
        throw new BadRequestException('minAmount must be less than or equal to maxAmount');
      }
    }

    // Validate approverRoles if provided
    if (dto.approverRoles !== undefined && dto.approverRoles.length === 0) {
      throw new BadRequestException('approverRoles must not be empty');
    }

    const updated = await this.prisma.approvalRule.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type as ApprovalRuleType | undefined,
        minAmount: dto.minAmount,
        maxAmount: dto.maxAmount,
        channel: dto.channel as Channel | undefined,
        approverRoles: dto.approverRoles,
        priority: dto.priority,
        isActive: dto.isActive,
      },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`Approval rule updated: "${updated.name}" (${updated.id})`);

    return this.transformRule(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE APPROVAL RULE
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const rule = await this.prisma.approvalRule.findUnique({ where: { id } });

    if (!rule) {
      throw new NotFoundException(`Approval rule with ID ${id} not found`);
    }

    await this.prisma.approvalRule.delete({ where: { id } });

    this.logger.log(`Approval rule deleted: "${rule.name}" (${rule.id})`);

    return { success: true, message: 'Approval rule deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOGGLE ACTIVE STATUS
  // ═══════════════════════════════════════════════════════════════════════════
  async toggleActive(id: string) {
    const rule = await this.prisma.approvalRule.findUnique({ where: { id } });

    if (!rule) {
      throw new NotFoundException(`Approval rule with ID ${id} not found`);
    }

    const updated = await this.prisma.approvalRule.update({
      where: { id },
      data: { isActive: !rule.isActive },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(
      `Approval rule "${updated.name}" toggled to ${updated.isActive ? 'active' : 'inactive'}`,
    );

    return this.transformRule(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND MATCHING RULE
  // Given an amount and optional channel, find the best matching active rule
  // ═══════════════════════════════════════════════════════════════════════════
  async findMatchingRule(amount: number, channel?: string) {
    if (amount < 0) {
      throw new BadRequestException('Amount must be a non-negative number');
    }

    const where: Prisma.ApprovalRuleWhereInput = {
      isActive: true,
      minAmount: { lte: amount },
      AND: [
        {
          OR: [{ maxAmount: null }, { maxAmount: { gte: amount } }],
        },
        {
          OR: [{ channel: null }, ...(channel ? [{ channel: channel as any }] : [])],
        },
      ],
    };

    const rule = await this.prisma.approvalRule.findFirst({
      where,
      orderBy: { priority: 'desc' },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    if (!rule) {
      return {
        matched: false,
        message: 'No matching approval rule found for the given criteria',
        criteria: { amount, channel: channel || null },
      };
    }

    return {
      matched: true,
      rule: this.transformRule(rule),
      criteria: { amount, channel: channel || null },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET APPROVAL RULE TYPES
  // ═══════════════════════════════════════════════════════════════════════════
  getTypes() {
    return [
      { value: ApprovalRuleTypeEnum.SINGLE_APPROVAL, label: 'Single Approval' },
      { value: ApprovalRuleTypeEnum.MULTI_LEVEL, label: 'Multi-Level' },
      { value: ApprovalRuleTypeEnum.COMMITTEE, label: 'Committee' },
      { value: ApprovalRuleTypeEnum.AUTO_APPROVE, label: 'Auto Approve' },
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SUMMARY / STATS
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const rules = await this.prisma.approvalRule.findMany({
      select: {
        type: true,
        isActive: true,
        channel: true,
        minAmount: true,
        maxAmount: true,
      },
    });

    // Count by type
    const byType: Record<string, number> = {};
    for (const value of Object.values(ApprovalRuleTypeEnum)) {
      byType[value] = 0;
    }
    rules.forEach((r) => {
      byType[r.type] = (byType[r.type] || 0) + 1;
    });

    // Count active / inactive
    const activeCount = rules.filter((r) => r.isActive).length;
    const inactiveCount = rules.filter((r) => !r.isActive).length;

    // Count by channel
    const byChannel: Record<string, number> = {};
    for (const value of Object.values(ChannelEnum)) {
      byChannel[value] = 0;
    }
    byChannel['ALL'] = 0;
    rules.forEach((r) => {
      if (r.channel) {
        byChannel[r.channel] = (byChannel[r.channel] || 0) + 1;
      } else {
        byChannel['ALL'] = (byChannel['ALL'] || 0) + 1;
      }
    });

    // Coverage analysis: check which amount ranges are covered
    const activeRules = rules.filter((r) => r.isActive);
    const coverageRanges = activeRules.map((r) => ({
      min: Number(r.minAmount),
      max: r.maxAmount !== null ? Number(r.maxAmount) : Infinity,
      channel: r.channel,
    }));

    // Check for gaps - sort by minAmount
    const sortedRanges = coverageRanges
      .filter((r) => r.channel === null)
      .sort((a, b) => a.min - b.min);

    let hasGaps = false;
    if (sortedRanges.length > 0 && sortedRanges[0].min > 0) {
      hasGaps = true;
    }
    for (let i = 1; i < sortedRanges.length; i++) {
      const prevMax = sortedRanges[i - 1].max;
      if (prevMax !== Infinity && sortedRanges[i].min > prevMax) {
        hasGaps = true;
        break;
      }
    }

    return {
      totalRules: rules.length,
      activeCount,
      inactiveCount,
      byType,
      byChannel,
      coverage: {
        hasGaps,
        rangeCount: sortedRanges.length,
        lowestMin: sortedRanges.length > 0 ? sortedRanges[0].min : null,
        highestMax:
          sortedRanges.length > 0
            ? sortedRanges[sortedRanges.length - 1].max === Infinity
              ? null
              : sortedRanges[sortedRanges.length - 1].max
            : null,
        hasUnlimitedCap: sortedRanges.some((r) => r.max === Infinity),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Rule for Response (Decimal → Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformRule(rule: any) {
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      type: rule.type,
      minAmount: Number(rule.minAmount),
      maxAmount: rule.maxAmount !== null ? Number(rule.maxAmount) : null,
      channel: rule.channel,
      approverRoles: rule.approverRoles,
      priority: rule.priority,
      isActive: rule.isActive,
      companyId: rule.companyId,
      company: rule.company || undefined,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }
}
