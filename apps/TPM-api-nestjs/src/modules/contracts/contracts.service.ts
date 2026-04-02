import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { ContractQueryDto } from './dto/contract-query.dto';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { RecordProgressDto } from './dto/record-progress.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST CONTRACTS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: ContractQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      status,
      customerId,
      channel,
      region,
      riskLevel,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.VolumeContractWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (channel) {
      where.channel = channel as any;
    }

    if (region) {
      where.region = region as any;
    }

    if (riskLevel) {
      where.riskLevel = riskLevel;
    }

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Build orderBy
    const validSortFields = [
      'createdAt',
      'startDate',
      'endDate',
      'targetVolume',
      'currentVolume',
      'completionRate',
      'status',
      'name',
      'code',
    ];
    const orderBy: Prisma.VolumeContractOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.volumeContract.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          customer: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: { milestones: true, progress: true },
          },
        },
      }),
      this.prisma.volumeContract.count({ where }),
    ]);

    // Transform data
    const transformedData = data.map((contract) => this.transformContract(contract));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET CONTRACT SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const contracts = await this.prisma.volumeContract.findMany({
      select: {
        targetVolume: true,
        currentVolume: true,
        completionRate: true,
        status: true,
        riskLevel: true,
      },
    });

    const totalContracts = contracts.length;
    const totalTargetVolume = contracts.reduce((sum, c) => sum + Number(c.targetVolume), 0);
    const totalCurrentVolume = contracts.reduce((sum, c) => sum + Number(c.currentVolume), 0);

    // Count by status
    const byStatus: Record<string, { count: number; targetVolume: number; currentVolume: number }> =
      {};
    contracts.forEach((c) => {
      if (!byStatus[c.status]) {
        byStatus[c.status] = { count: 0, targetVolume: 0, currentVolume: 0 };
      }
      byStatus[c.status].count += 1;
      byStatus[c.status].targetVolume += Number(c.targetVolume);
      byStatus[c.status].currentVolume += Number(c.currentVolume);
    });

    // Count by risk level
    const byRiskLevel: Record<string, number> = {};
    contracts.forEach((c) => {
      byRiskLevel[c.riskLevel] = (byRiskLevel[c.riskLevel] || 0) + 1;
    });

    return {
      totalContracts,
      totalTargetVolume,
      totalCurrentVolume,
      overallCompletionRate:
        totalTargetVolume > 0
          ? Number(((totalCurrentVolume / totalTargetVolume) * 100).toFixed(2))
          : 0,
      draftCount: byStatus['DRAFT']?.count || 0,
      activeCount: byStatus['ACTIVE']?.count || 0,
      completedCount: byStatus['COMPLETED']?.count || 0,
      cancelledCount: byStatus['CANCELLED']?.count || 0,
      onTrackCount: byRiskLevel['ON_TRACK'] || 0,
      atRiskCount: byRiskLevel['AT_RISK'] || 0,
      criticalCount: byRiskLevel['CRITICAL'] || 0,
      byStatus,
      byRiskLevel,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET AT-RISK CONTRACTS
  // ═══════════════════════════════════════════════════════════════════════════
  async getAtRisk() {
    const data = await this.prisma.volumeContract.findMany({
      where: {
        riskLevel: { in: ['AT_RISK', 'CRITICAL'] },
        status: 'ACTIVE',
      },
      orderBy: [{ riskLevel: 'desc' }, { completionRate: 'asc' }],
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
        milestones: {
          where: { isAchieved: false },
          orderBy: { deadline: 'asc' },
          take: 1,
        },
      },
    });

    return data.map((contract) => ({
      ...this.transformContract(contract),
      nextMilestone: contract.milestones[0]
        ? {
            id: contract.milestones[0].id,
            name: contract.milestones[0].name,
            targetVolume: Number(contract.milestones[0].targetVolume),
            achievedVolume: Number(contract.milestones[0].achievedVolume),
            deadline: contract.milestones[0].deadline,
          }
        : null,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE CONTRACT
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const contract = await this.prisma.volumeContract.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, name: true, code: true, channel: true, address: true },
        },
        milestones: {
          orderBy: { deadline: 'asc' },
        },
        progress: {
          orderBy: [{ year: 'asc' }, { month: 'asc' }],
        },
      },
    });

    if (!contract) {
      throw new NotFoundException(`Contract with ID ${id} not found`);
    }

    return this.transformContractDetail(contract);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE CONTRACT
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateContractDto) {
    // Validate customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });

    if (!customer) {
      throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);
    }

    // Validate dates
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    const contract = await this.prisma.volumeContract.create({
      data: {
        companyId: dto.companyId,
        code: dto.code,
        name: dto.name,
        customerId: dto.customerId,
        status: 'DRAFT',
        startDate,
        endDate,
        targetVolume: dto.targetVolume,
        currentVolume: 0,
        bonusType: (dto.bonusType as any) || 'PERCENTAGE',
        bonusValue: dto.bonusValue,
        bonusCondition: dto.bonusCondition || undefined,
        channel: (dto.channel as any) || undefined,
        region: (dto.region as any) || undefined,
        categories: (dto.categories as any) || [],
        riskLevel: 'ON_TRACK',
        completionRate: 0,
        notes: dto.notes || null,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`Contract created: ${contract.code}`);

    return this.transformContract(contract);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE CONTRACT (only DRAFT status)
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateContractDto) {
    const contract = await this.prisma.volumeContract.findUnique({ where: { id } });

    if (!contract) {
      throw new NotFoundException(`Contract with ID ${id} not found`);
    }

    if (contract.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot update contract in ${contract.status} status. Only DRAFT contracts can be modified.`,
      );
    }

    // Validate customer if changing
    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: dto.customerId },
      });
      if (!customer) {
        throw new BadRequestException(`Customer with ID ${dto.customerId} not found`);
      }
    }

    // Validate dates if changing
    if (dto.startDate || dto.endDate) {
      const startDate = dto.startDate ? new Date(dto.startDate) : contract.startDate;
      const endDate = dto.endDate ? new Date(dto.endDate) : contract.endDate;
      if (endDate <= startDate) {
        throw new BadRequestException('End date must be after start date');
      }
    }

    const updated = await this.prisma.volumeContract.update({
      where: { id },
      data: {
        name: dto.name,
        customerId: dto.customerId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        targetVolume: dto.targetVolume,
        bonusType: dto.bonusType as any,
        bonusValue: dto.bonusValue,
        bonusCondition: dto.bonusCondition,
        channel: dto.channel as any,
        region: dto.region as any,
        categories: dto.categories as any,
        notes: dto.notes,
      },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`Contract updated: ${updated.code}`);

    return this.transformContract(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVATE CONTRACT (DRAFT -> ACTIVE)
  // ═══════════════════════════════════════════════════════════════════════════
  async activate(id: string) {
    const contract = await this.prisma.volumeContract.findUnique({ where: { id } });

    if (!contract) {
      throw new NotFoundException(`Contract with ID ${id} not found`);
    }

    if (contract.status !== 'DRAFT') {
      throw new BadRequestException(
        `Contract must be in DRAFT status to activate. Current status: ${contract.status}`,
      );
    }

    const updated = await this.prisma.volumeContract.update({
      where: { id },
      data: { status: 'ACTIVE' },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`Contract activated: ${updated.code}`);

    return this.transformContract(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE CONTRACT (ACTIVE -> COMPLETED)
  // ═══════════════════════════════════════════════════════════════════════════
  async complete(id: string) {
    const contract = await this.prisma.volumeContract.findUnique({ where: { id } });

    if (!contract) {
      throw new NotFoundException(`Contract with ID ${id} not found`);
    }

    if (contract.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Contract must be in ACTIVE status to complete. Current status: ${contract.status}`,
      );
    }

    const updated = await this.prisma.volumeContract.update({
      where: { id },
      data: { status: 'COMPLETED' },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`Contract completed: ${updated.code}`);

    return this.transformContract(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CANCEL CONTRACT
  // ═══════════════════════════════════════════════════════════════════════════
  async cancel(id: string) {
    const contract = await this.prisma.volumeContract.findUnique({ where: { id } });

    if (!contract) {
      throw new NotFoundException(`Contract with ID ${id} not found`);
    }

    if (contract.status === 'CANCELLED') {
      throw new BadRequestException('Contract is already cancelled');
    }

    if (contract.status === 'COMPLETED') {
      throw new BadRequestException('Cannot cancel a completed contract');
    }

    const updated = await this.prisma.volumeContract.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: {
        customer: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`Contract cancelled: ${updated.code}`);

    return this.transformContract(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE CONTRACT (only DRAFT)
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const contract = await this.prisma.volumeContract.findUnique({ where: { id } });

    if (!contract) {
      throw new NotFoundException(`Contract with ID ${id} not found`);
    }

    if (contract.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot delete contract in ${contract.status} status. Only DRAFT contracts can be deleted.`,
      );
    }

    await this.prisma.volumeContract.delete({ where: { id } });

    this.logger.log(`Contract deleted: ${contract.code}`);

    return { success: true, message: 'Contract deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADD MILESTONE
  // ═══════════════════════════════════════════════════════════════════════════
  async addMilestone(contractId: string, dto: CreateMilestoneDto) {
    const contract = await this.prisma.volumeContract.findUnique({
      where: { id: contractId },
    });

    if (!contract) {
      throw new NotFoundException(`Contract with ID ${contractId} not found`);
    }

    const milestone = await this.prisma.volumeContractMilestone.create({
      data: {
        contractId,
        name: dto.name,
        targetVolume: dto.targetVolume,
        achievedVolume: 0,
        deadline: new Date(dto.deadline),
        bonusAmount: dto.bonusAmount || null,
        isAchieved: false,
      },
    });

    this.logger.log(`Milestone added to contract ${contract.code}: ${milestone.name}`);

    return this.transformMilestone(milestone);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECORD PROGRESS (upsert by year+month)
  // ═══════════════════════════════════════════════════════════════════════════
  async recordProgress(contractId: string, dto: RecordProgressDto) {
    const contract = await this.prisma.volumeContract.findUnique({
      where: { id: contractId },
    });

    if (!contract) {
      throw new NotFoundException(`Contract with ID ${contractId} not found`);
    }

    if (contract.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Can only record progress for ACTIVE contracts. Current status: ${contract.status}`,
      );
    }

    // Get existing progress for cumulative calculations
    const existingProgress = await this.prisma.volumeContractProgress.findMany({
      where: {
        contractId,
        OR: [{ year: { lt: dto.year } }, { year: dto.year, month: { lt: dto.month } }],
      },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });

    const cumVolumePrior = existingProgress.reduce((sum, p) => sum + Number(p.volume), 0);
    const cumTargetPrior = existingProgress.reduce((sum, p) => sum + Number(p.target), 0);

    const cumVolume = cumVolumePrior + dto.volume;
    const cumTarget = cumTargetPrior + (dto.target || 0);
    const gapPercent =
      cumTarget > 0 ? Number((((cumVolume - cumTarget) / cumTarget) * 100).toFixed(2)) : 0;

    // Upsert progress
    const progress = await this.prisma.volumeContractProgress.upsert({
      where: {
        contractId_year_month: {
          contractId,
          year: dto.year,
          month: dto.month,
        },
      },
      create: {
        contractId,
        month: dto.month,
        year: dto.year,
        volume: dto.volume,
        revenue: dto.revenue || 0,
        target: dto.target || 0,
        cumVolume,
        cumTarget,
        gapPercent,
        notes: dto.notes || null,
      },
      update: {
        volume: dto.volume,
        revenue: dto.revenue || 0,
        target: dto.target || 0,
        cumVolume,
        cumTarget,
        gapPercent,
        notes: dto.notes,
      },
    });

    // Update contract's currentVolume and completionRate
    const allProgress = await this.prisma.volumeContractProgress.findMany({
      where: { contractId },
    });
    const totalVolume = allProgress.reduce((sum, p) => sum + Number(p.volume), 0);
    const completionRate =
      Number(contract.targetVolume) > 0
        ? Number(((totalVolume / Number(contract.targetVolume)) * 100).toFixed(2))
        : 0;

    // Determine risk level
    let riskLevel: 'ON_TRACK' | 'AT_RISK' | 'CRITICAL' = 'ON_TRACK';
    if (gapPercent < -20) {
      riskLevel = 'CRITICAL';
    } else if (gapPercent < -10) {
      riskLevel = 'AT_RISK';
    }

    await this.prisma.volumeContract.update({
      where: { id: contractId },
      data: {
        currentVolume: totalVolume,
        completionRate: Math.min(completionRate, 100),
        riskLevel,
      },
    });

    this.logger.log(`Progress recorded for contract ${contract.code}: ${dto.year}-${dto.month}`);

    return this.transformProgress(progress);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Contract for Response (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformContract(contract: any) {
    return {
      id: contract.id,
      companyId: contract.companyId,
      code: contract.code,
      name: contract.name,
      customerId: contract.customerId,
      customer: contract.customer || null,
      status: contract.status,
      startDate: contract.startDate,
      endDate: contract.endDate,
      targetVolume: Number(contract.targetVolume),
      currentVolume: Number(contract.currentVolume),
      bonusType: contract.bonusType,
      bonusValue: Number(contract.bonusValue),
      bonusCondition: contract.bonusCondition,
      channel: contract.channel,
      region: contract.region,
      categories: contract.categories,
      riskLevel: contract.riskLevel,
      completionRate: Number(contract.completionRate),
      notes: contract.notes,
      metadata: contract.metadata,
      milestoneCount: contract._count?.milestones || 0,
      progressCount: contract._count?.progress || 0,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Contract Detail for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformContractDetail(contract: any) {
    const base = this.transformContract(contract);

    return {
      ...base,
      milestones: contract.milestones?.map((m: any) => this.transformMilestone(m)) || [],
      progress: contract.progress?.map((p: any) => this.transformProgress(p)) || [],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Milestone (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformMilestone(milestone: any) {
    return {
      id: milestone.id,
      contractId: milestone.contractId,
      name: milestone.name,
      targetVolume: Number(milestone.targetVolume),
      achievedVolume: Number(milestone.achievedVolume),
      deadline: milestone.deadline,
      achievedDate: milestone.achievedDate,
      bonusAmount: milestone.bonusAmount ? Number(milestone.bonusAmount) : null,
      isAchieved: milestone.isAchieved,
      createdAt: milestone.createdAt,
      updatedAt: milestone.updatedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Progress (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformProgress(progress: any) {
    return {
      id: progress.id,
      contractId: progress.contractId,
      month: progress.month,
      year: progress.year,
      volume: Number(progress.volume),
      revenue: Number(progress.revenue),
      target: Number(progress.target),
      cumVolume: Number(progress.cumVolume),
      cumTarget: Number(progress.cumTarget),
      gapPercent: Number(progress.gapPercent),
      notes: progress.notes,
      createdAt: progress.createdAt,
      updatedAt: progress.updatedAt,
    };
  }
}
