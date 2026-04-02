import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateTargetDto } from './dto/create-target.dto';
import { UpdateTargetDto } from './dto/update-target.dto';
import { TargetQueryDto } from './dto/target-query.dto';
import { CreateTargetAllocationDto } from './dto/create-target-allocation.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class TargetsService {
  private readonly logger = new Logger(TargetsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST TARGETS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: TargetQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      year,
      quarter,
      metric,
      status,
      isActive,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.TargetWhereInput = {};

    if (year !== undefined) {
      where.year = year;
    }

    if (quarter !== undefined) {
      where.quarter = quarter;
    }

    if (metric) {
      where.metric = metric;
    }

    if (status) {
      where.status = status;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy with validated sort fields
    const validSortFields = [
      'createdAt',
      'name',
      'code',
      'totalTarget',
      'totalAchieved',
      'year',
      'status',
    ];
    const orderBy: Prisma.TargetOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.target.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          _count: {
            select: { allocations: true },
          },
        },
      }),
      this.prisma.target.count({ where }),
    ]);

    // Transform Decimal→Number
    const transformedData = data.map((target) => this.transformTarget(target));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE TARGET
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const target = await this.prisma.target.findUnique({
      where: { id },
      include: {
        allocations: {
          include: {
            geographicUnit: {
              select: { id: true, name: true, code: true, level: true },
            },
            children: {
              select: {
                id: true,
                code: true,
                targetValue: true,
                achievedValue: true,
                progressPercent: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { allocations: true },
        },
      },
    });

    if (!target) {
      throw new NotFoundException(`Target with ID ${id} not found`);
    }

    return this.transformTargetDetail(target);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE TARGET
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateTargetDto, userId: string) {
    // Validate code uniqueness
    const existing = await this.prisma.target.findUnique({
      where: { code: dto.code },
    });

    if (existing) {
      throw new ConflictException(`Target with code "${dto.code}" already exists`);
    }

    const target = await this.prisma.target.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        year: dto.year,
        quarter: dto.quarter,
        month: dto.month,
        totalTarget: dto.totalTarget,
        totalAchieved: 0,
        metric: dto.metric || 'CASES',
        status: 'DRAFT',
        isActive: true,
        createdBy: userId,
      },
      include: {
        _count: {
          select: { allocations: true },
        },
      },
    });

    this.logger.log(`Target created: ${target.code} by user ${userId}`);

    return this.transformTarget(target);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE TARGET
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateTargetDto) {
    const target = await this.prisma.target.findUnique({ where: { id } });

    if (!target) {
      throw new NotFoundException(`Target with ID ${id} not found`);
    }

    // Only DRAFT targets can be modified (for totalTarget changes)
    if (target.status !== 'DRAFT' && dto.totalTarget !== undefined) {
      throw new BadRequestException(
        `Cannot modify totalTarget for target in ${target.status} status. Only DRAFT targets can have their totalTarget changed.`,
      );
    }

    const updated = await this.prisma.target.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        year: dto.year,
        quarter: dto.quarter,
        month: dto.month,
        totalTarget: dto.totalTarget,
        metric: dto.metric,
      },
      include: {
        _count: {
          select: { allocations: true },
        },
      },
    });

    this.logger.log(`Target updated: ${updated.code}`);

    return this.transformTarget(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE TARGET
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const target = await this.prisma.target.findUnique({ where: { id } });

    if (!target) {
      throw new NotFoundException(`Target with ID ${id} not found`);
    }

    // Only allow deletion in DRAFT status
    if (target.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot delete target in ${target.status} status. Only DRAFT targets can be deleted.`,
      );
    }

    // Delete target (cascades to allocations via onDelete: Cascade)
    await this.prisma.target.delete({
      where: { id },
    });

    this.logger.log(`Target deleted: ${target.code}`);

    return { success: true, message: 'Target deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVATE TARGET
  // ═══════════════════════════════════════════════════════════════════════════
  async activate(id: string) {
    const target = await this.prisma.target.findUnique({ where: { id } });

    if (!target) {
      throw new NotFoundException(`Target with ID ${id} not found`);
    }

    if (target.status !== 'DRAFT') {
      throw new BadRequestException(
        `Target must be in DRAFT status to activate. Current status: ${target.status}`,
      );
    }

    // Validate totalTarget > 0
    if (Number(target.totalTarget) <= 0) {
      throw new BadRequestException(
        'Cannot activate target with totalTarget of 0. Set a totalTarget value first.',
      );
    }

    const updated = await this.prisma.target.update({
      where: { id },
      data: { status: 'ACTIVE' },
      include: {
        _count: {
          select: { allocations: true },
        },
      },
    });

    this.logger.log(`Target activated: ${target.code}`);

    return this.transformTarget(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE TARGET
  // ═══════════════════════════════════════════════════════════════════════════
  async complete(id: string) {
    const target = await this.prisma.target.findUnique({ where: { id } });

    if (!target) {
      throw new NotFoundException(`Target with ID ${id} not found`);
    }

    if (target.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Target must be in ACTIVE status to complete. Current status: ${target.status}`,
      );
    }

    const updated = await this.prisma.target.update({
      where: { id },
      data: { status: 'COMPLETED' },
      include: {
        _count: {
          select: { allocations: true },
        },
      },
    });

    this.logger.log(`Target completed: ${target.code}`);

    return this.transformTarget(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE ACHIEVED VALUE
  // ═══════════════════════════════════════════════════════════════════════════
  async updateAchieved(id: string, totalAchieved: number) {
    const target = await this.prisma.target.findUnique({ where: { id } });

    if (!target) {
      throw new NotFoundException(`Target with ID ${id} not found`);
    }

    if (target.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Can only update achieved value for ACTIVE targets. Current status: ${target.status}`,
      );
    }

    if (totalAchieved < 0) {
      throw new BadRequestException('totalAchieved must be >= 0');
    }

    const updated = await this.prisma.target.update({
      where: { id },
      data: { totalAchieved },
      include: {
        _count: {
          select: { allocations: true },
        },
      },
    });

    this.logger.log(`Target achieved updated: ${target.code}, new value: ${totalAchieved}`);

    return this.transformTarget(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE ALLOCATION
  // ═══════════════════════════════════════════════════════════════════════════
  async createAllocation(targetId: string, dto: CreateTargetAllocationDto, userId: string) {
    // Validate target exists
    const target = await this.prisma.target.findUnique({
      where: { id: targetId },
    });

    if (!target) {
      throw new NotFoundException(`Target with ID ${targetId} not found`);
    }

    // Validate geographic unit exists
    const geoUnit = await this.prisma.geographicUnit.findUnique({
      where: { id: dto.geographicUnitId },
      select: { id: true, code: true, name: true },
    });

    if (!geoUnit) {
      throw new NotFoundException(`Geographic unit with ID ${dto.geographicUnitId} not found`);
    }

    // Validate unique [targetId, geographicUnitId]
    const existingAlloc = await this.prisma.targetAllocation.findUnique({
      where: {
        targetId_geographicUnitId: {
          targetId,
          geographicUnitId: dto.geographicUnitId,
        },
      },
    });

    if (existingAlloc) {
      throw new ConflictException(
        `Allocation for geographic unit "${geoUnit.name}" already exists on this target`,
      );
    }

    // Validate parent exists if parentId provided
    if (dto.parentId) {
      const parent = await this.prisma.targetAllocation.findUnique({
        where: { id: dto.parentId },
      });

      if (!parent) {
        throw new NotFoundException(`Parent allocation with ID ${dto.parentId} not found`);
      }

      if (parent.targetId !== targetId) {
        throw new BadRequestException('Parent allocation must belong to the same target');
      }
    }

    // Auto-generate code: TA-{targetCode}-{geoCode}
    const allocationCode = `TA-${target.code}-${geoUnit.code}`;

    // Create allocation
    const allocation = await this.prisma.targetAllocation.create({
      data: {
        code: allocationCode,
        targetId,
        geographicUnitId: dto.geographicUnitId,
        targetValue: dto.targetValue,
        achievedValue: 0,
        metric: dto.metric || target.metric,
        childrenTarget: 0,
        progressPercent: 0,
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

    // Update target's childrenTarget sum (aggregate all allocation targetValues)
    const aggregation = await this.prisma.targetAllocation.aggregate({
      where: { targetId },
      _sum: { targetValue: true },
    });

    // Note: Target model doesn't have a childrenTarget field directly,
    // but we log the total allocation for reference
    this.logger.log(
      `Allocation created for target ${target.code}: ${dto.targetValue} ${target.metric}, total allocated: ${Number(aggregation._sum.targetValue || 0)}`,
    );

    return this.transformAllocation(allocation);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET ALLOCATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  async getAllocations(targetId: string) {
    const target = await this.prisma.target.findUnique({
      where: { id: targetId },
    });

    if (!target) {
      throw new NotFoundException(`Target with ID ${targetId} not found`);
    }

    const allocations = await this.prisma.targetAllocation.findMany({
      where: { targetId },
      include: {
        geographicUnit: {
          select: { id: true, name: true, code: true, level: true },
        },
        children: {
          select: {
            id: true,
            code: true,
            targetValue: true,
            achievedValue: true,
            progressPercent: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return allocations.map((a) => this.transformAllocation(a));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const targets = await this.prisma.target.findMany({
      select: {
        totalTarget: true,
        totalAchieved: true,
        status: true,
        metric: true,
        year: true,
      },
    });

    // Calculate totals
    const totalTargetSum = targets.reduce((sum, t) => sum + Number(t.totalTarget), 0);
    const totalAchievedSum = targets.reduce((sum, t) => sum + Number(t.totalAchieved), 0);
    const achievementRate = totalTargetSum > 0 ? (totalAchievedSum / totalTargetSum) * 100 : 0;

    // Count by status
    const byStatus: Record<string, number> = {};
    targets.forEach((t) => {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    });

    // Count by metric
    const byMetric: Record<string, number> = {};
    targets.forEach((t) => {
      byMetric[t.metric] = (byMetric[t.metric] || 0) + 1;
    });

    return {
      totalTarget: totalTargetSum,
      totalAchieved: totalAchievedSum,
      achievementRate,
      targetCount: targets.length,
      byStatus,
      byMetric,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET AVAILABLE YEARS
  // ═══════════════════════════════════════════════════════════════════════════
  async getAvailableYears() {
    const result = await this.prisma.target.findMany({
      select: { year: true },
      distinct: ['year'],
      orderBy: { year: 'desc' },
    });

    return result.map((r) => r.year);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Target for Response (Decimal→Number + computed fields)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformTarget(target: any) {
    const totalTarget = Number(target.totalTarget);
    const totalAchieved = Number(target.totalAchieved);
    const achievementRate = totalTarget > 0 ? (totalAchieved / totalTarget) * 100 : 0;

    return {
      id: target.id,
      code: target.code,
      name: target.name,
      description: target.description,
      year: target.year,
      quarter: target.quarter,
      month: target.month,
      totalTarget,
      totalAchieved,
      achievementRate: Math.round(achievementRate * 100) / 100,
      metric: target.metric,
      status: target.status,
      isActive: target.isActive,
      createdBy: target.createdBy,
      createdAt: target.createdAt,
      updatedAt: target.updatedAt,
      allocationCount: target._count?.allocations || 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Target Detail for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformTargetDetail(target: any) {
    const base = this.transformTarget(target);

    return {
      ...base,
      allocations: target.allocations?.map((a: any) => this.transformAllocation(a)) || [],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Allocation for Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformAllocation(allocation: any) {
    const targetValue = Number(allocation.targetValue);
    const achievedValue = Number(allocation.achievedValue);
    const progressPercent = Number(allocation.progressPercent);
    const childrenTarget = Number(allocation.childrenTarget);

    return {
      id: allocation.id,
      code: allocation.code,
      targetId: allocation.targetId,
      geographicUnitId: allocation.geographicUnitId,
      geographicUnit: allocation.geographicUnit,
      parentId: allocation.parentId,
      targetValue,
      achievedValue,
      metric: allocation.metric,
      childrenTarget,
      progressPercent,
      status: allocation.status,
      notes: allocation.notes,
      createdAt: allocation.createdAt,
      updatedAt: allocation.updatedAt,
      createdBy: allocation.createdBy,
      children:
        allocation.children?.map((c: any) => ({
          ...c,
          targetValue: Number(c.targetValue),
          achievedValue: Number(c.achievedValue),
          progressPercent: Number(c.progressPercent),
        })) || [],
    };
  }
}
