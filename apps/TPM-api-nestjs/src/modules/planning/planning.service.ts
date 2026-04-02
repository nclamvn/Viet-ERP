import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateScenarioDto } from './dto/create-scenario.dto';
import { UpdateScenarioDto } from './dto/update-scenario.dto';
import { ScenarioQueryDto } from './dto/scenario-query.dto';
import { BaselineQueryDto } from './dto/baseline-query.dto';
import { CreateBaselineDto } from './dto/create-baseline.dto';
import { UpdateBaselineDto } from './dto/update-baseline.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class PlanningService {
  private readonly logger = new Logger(PlanningService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── LIST SCENARIOS ─────────────────────────────────────────────────────────
  async findAllScenarios(query: ScenarioQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { status, search, createdById, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const where: Prisma.ScenarioWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (createdById) {
      where.createdById = createdById;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const validSortFields = ['createdAt', 'name', 'status', 'updatedAt'];
    const orderBy: Prisma.ScenarioOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.scenario.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          baseline: {
            select: { id: true, companyId: true, periodYear: true, periodType: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { versions: true },
          },
        },
      }),
      this.prisma.scenario.count({ where }),
    ]);

    const transformedData = data.map((s) => this.transformScenario(s));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ── GET SCENARIO BY ID ─────────────────────────────────────────────────────
  async findOneScenario(id: string) {
    const scenario = await this.prisma.scenario.findUnique({
      where: { id },
      include: {
        baseline: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        versions: {
          orderBy: { version: 'desc' },
        },
        _count: {
          select: { versions: true },
        },
      },
    });

    if (!scenario) {
      throw new NotFoundException(`Scenario with ID ${id} not found`);
    }

    return this.transformScenarioDetail(scenario);
  }

  // ── CREATE SCENARIO ────────────────────────────────────────────────────────
  async createScenario(dto: CreateScenarioDto, userId: string) {
    if (dto.baselineId) {
      const baseline = await this.prisma.baseline.findUnique({ where: { id: dto.baselineId } });
      if (!baseline) {
        throw new BadRequestException(`Baseline with ID ${dto.baselineId} not found`);
      }
    }

    const scenario = await this.prisma.scenario.create({
      data: {
        name: dto.name,
        description: dto.description,
        baselineId: dto.baselineId,
        parameters: dto.parameters,
        assumptions: dto.assumptions,
        status: 'DRAFT',
        createdById: userId,
      },
      include: {
        baseline: {
          select: { id: true, companyId: true, periodYear: true, periodType: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { versions: true },
        },
      },
    });

    // Create initial version
    await this.prisma.scenarioVersion.create({
      data: {
        scenarioId: scenario.id,
        version: 1,
        parameters: dto.parameters,
        notes: 'Initial version',
        createdById: userId,
      },
    });

    this.logger.log(`Scenario created: ${scenario.name} by user ${userId}`);

    return this.transformScenario(scenario);
  }

  // ── UPDATE SCENARIO (DRAFT ONLY) ──────────────────────────────────────────
  async updateScenario(id: string, dto: UpdateScenarioDto, userId: string) {
    const scenario = await this.prisma.scenario.findUnique({ where: { id } });

    if (!scenario) {
      throw new NotFoundException(`Scenario with ID ${id} not found`);
    }

    if (scenario.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot update scenario in ${scenario.status} status. Only DRAFT scenarios can be modified.`,
      );
    }

    if (dto.baselineId) {
      const baseline = await this.prisma.baseline.findUnique({ where: { id: dto.baselineId } });
      if (!baseline) {
        throw new BadRequestException(`Baseline with ID ${dto.baselineId} not found`);
      }
    }

    const updated = await this.prisma.scenario.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        baselineId: dto.baselineId,
        parameters: dto.parameters,
        assumptions: dto.assumptions,
      },
      include: {
        baseline: {
          select: { id: true, companyId: true, periodYear: true, periodType: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { versions: true },
        },
      },
    });

    // Create new version if parameters changed
    if (dto.parameters) {
      const lastVersion = await this.prisma.scenarioVersion.findFirst({
        where: { scenarioId: id },
        orderBy: { version: 'desc' },
      });

      await this.prisma.scenarioVersion.create({
        data: {
          scenarioId: id,
          version: (lastVersion?.version || 0) + 1,
          parameters: dto.parameters,
          notes: 'Updated parameters',
          createdById: userId,
        },
      });
    }

    this.logger.log(`Scenario updated: ${updated.name} by user ${userId}`);

    return this.transformScenario(updated);
  }

  // ── RUN SCENARIO ───────────────────────────────────────────────────────────
  async runScenario(id: string, userId: string) {
    const scenario = await this.prisma.scenario.findUnique({ where: { id } });

    if (!scenario) {
      throw new NotFoundException(`Scenario with ID ${id} not found`);
    }

    if (scenario.status !== 'DRAFT') {
      throw new BadRequestException(
        `Scenario must be in DRAFT status to run. Current status: ${scenario.status}`,
      );
    }

    const updated = await this.prisma.scenario.update({
      where: { id },
      data: {
        status: 'RUNNING',
        results: Prisma.JsonNull,
        comparison: Prisma.JsonNull,
      },
      include: {
        baseline: {
          select: { id: true, companyId: true, periodYear: true, periodType: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { versions: true },
        },
      },
    });

    this.logger.log(`Scenario run started: ${updated.name} by user ${userId}`);

    return this.transformScenario(updated);
  }

  // ── COMPLETE SCENARIO ──────────────────────────────────────────────────────
  async completeScenario(id: string, userId: string) {
    const scenario = await this.prisma.scenario.findUnique({ where: { id } });

    if (!scenario) {
      throw new NotFoundException(`Scenario with ID ${id} not found`);
    }

    if (scenario.status !== 'RUNNING') {
      throw new BadRequestException(
        `Scenario must be in RUNNING status to complete. Current status: ${scenario.status}`,
      );
    }

    const updated = await this.prisma.scenario.update({
      where: { id },
      data: {
        status: 'COMPLETED',
      },
      include: {
        baseline: {
          select: { id: true, companyId: true, periodYear: true, periodType: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { versions: true },
        },
      },
    });

    this.logger.log(`Scenario completed: ${updated.name} by user ${userId}`);

    return this.transformScenario(updated);
  }

  // ── ARCHIVE SCENARIO ──────────────────────────────────────────────────────
  async archiveScenario(id: string, userId: string) {
    const scenario = await this.prisma.scenario.findUnique({ where: { id } });

    if (!scenario) {
      throw new NotFoundException(`Scenario with ID ${id} not found`);
    }

    if (scenario.status === 'ARCHIVED') {
      throw new BadRequestException('Scenario is already archived');
    }

    const updated = await this.prisma.scenario.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
      },
      include: {
        baseline: {
          select: { id: true, companyId: true, periodYear: true, periodType: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { versions: true },
        },
      },
    });

    this.logger.log(`Scenario archived: ${updated.name} by user ${userId}`);

    return this.transformScenario(updated);
  }

  // ── DELETE SCENARIO (DRAFT ONLY) ──────────────────────────────────────────
  async deleteScenario(id: string, userId: string) {
    const scenario = await this.prisma.scenario.findUnique({ where: { id } });

    if (!scenario) {
      throw new NotFoundException(`Scenario with ID ${id} not found`);
    }

    if (scenario.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot delete scenario in ${scenario.status} status. Only DRAFT scenarios can be deleted.`,
      );
    }

    await this.prisma.scenario.delete({ where: { id } });

    this.logger.log(`Scenario deleted: ${scenario.name} by user ${userId}`);

    return { success: true, message: 'Scenario deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BASELINES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── LIST BASELINES ─────────────────────────────────────────────────────────
  async findAllBaselines(query: BaselineQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      companyId,
      customerId,
      productId,
      channel,
      periodYear,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.BaselineWhereInput = {};

    if (companyId) {
      where.companyId = companyId;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (productId) {
      where.productId = productId;
    }

    if (channel) {
      where.channel = channel;
    }

    if (periodYear) {
      where.periodYear = periodYear;
    }

    if (search) {
      where.OR = [
        { category: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { region: { contains: search, mode: 'insensitive' } },
      ];
    }

    const validSortFields = ['createdAt', 'periodYear', 'baselineVolume', 'baselineRevenue'];
    const orderBy: Prisma.BaselineOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.baseline.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          company: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true, code: true } },
          product: { select: { id: true, name: true, sku: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.baseline.count({ where }),
    ]);

    const transformedData = data.map((b) => this.transformBaseline(b));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ── GET BASELINE BY ID ─────────────────────────────────────────────────────
  async findOneBaseline(id: string) {
    const baseline = await this.prisma.baseline.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        updatedBy: { select: { id: true, name: true } },
        lockedBy: { select: { id: true, name: true } },
        scenarios: {
          select: { id: true, name: true, status: true },
          take: 10,
        },
      },
    });

    if (!baseline) {
      throw new NotFoundException(`Baseline with ID ${id} not found`);
    }

    return this.transformBaseline(baseline);
  }

  // ── CREATE BASELINE ────────────────────────────────────────────────────────
  async createBaseline(dto: CreateBaselineDto, userId: string) {
    const baseline = await this.prisma.baseline.create({
      data: {
        companyId: dto.companyId,
        customerId: dto.customerId,
        productId: dto.productId,
        channel: dto.channel,
        category: dto.category,
        brand: dto.brand,
        region: dto.region,
        periodType: dto.periodType,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
        periodWeek: dto.periodWeek,
        periodQuarter: dto.periodQuarter,
        baselineVolume: dto.baselineVolume,
        baselineRevenue: dto.baselineRevenue,
        baselineUnits: dto.baselineUnits,
        baselineCases: dto.baselineCases,
        avgPricePerUnit: dto.avgPricePerUnit,
        avgPricePerCase: dto.avgPricePerCase,
        sourceType: dto.sourceType,
        calculationMethod: dto.calculationMethod,
        historicalPeriods: dto.historicalPeriods,
        notes: dto.notes,
        tags: dto.tags || [],
        createdById: userId,
      },
      include: {
        company: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Baseline created for company ${dto.companyId} by user ${userId}`);

    return this.transformBaseline(baseline);
  }

  // ── UPDATE BASELINE ────────────────────────────────────────────────────────
  async updateBaseline(id: string, dto: UpdateBaselineDto, userId: string) {
    const baseline = await this.prisma.baseline.findUnique({ where: { id } });

    if (!baseline) {
      throw new NotFoundException(`Baseline with ID ${id} not found`);
    }

    if (baseline.isLocked) {
      throw new BadRequestException('Cannot update a locked baseline');
    }

    const updated = await this.prisma.baseline.update({
      where: { id },
      data: {
        ...dto,
        updatedById: userId,
      },
      include: {
        company: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Baseline updated: ${id} by user ${userId}`);

    return this.transformBaseline(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY & CALENDAR
  // ═══════════════════════════════════════════════════════════════════════════

  // ── PLANNING SUMMARY ──────────────────────────────────────────────────────
  async getSummary() {
    const [scenarioCounts, baselineCount, recentScenarios] = await Promise.all([
      this.prisma.scenario.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.baseline.count(),
      this.prisma.scenario.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          updatedAt: true,
        },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    let totalScenarios = 0;
    scenarioCounts.forEach((s) => {
      byStatus[s.status] = s._count.id;
      totalScenarios += s._count.id;
    });

    return {
      totalScenarios,
      totalBaselines: baselineCount,
      scenariosByStatus: byStatus,
      recentScenarios,
    };
  }

  // ── FISCAL PERIOD CALENDAR ─────────────────────────────────────────────────
  async getCalendar(year?: number, companyId?: string) {
    const where: Prisma.FiscalPeriodWhereInput = {};

    if (year) {
      where.year = year;
    }

    if (companyId) {
      where.companyId = companyId;
    }

    const periods = await this.prisma.fiscalPeriod.findMany({
      where,
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
      include: {
        company: { select: { id: true, name: true } },
      },
    });

    return periods.map((p) => ({
      id: p.id,
      companyId: p.companyId,
      companyName: (p as any).company?.name,
      year: p.year,
      month: p.month,
      quarter: p.quarter,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      closedAt: p.closedAt,
      totalAccrued: Number(p.totalAccrued),
      totalReversed: Number(p.totalReversed),
      totalSettled: Number(p.totalSettled),
      createdAt: p.createdAt,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private transformScenario(scenario: any) {
    return {
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      baselineId: scenario.baselineId,
      baseline: scenario.baseline,
      status: scenario.status,
      parameters: scenario.parameters,
      assumptions: scenario.assumptions,
      results: scenario.results,
      comparison: scenario.comparison,
      createdById: scenario.createdById,
      createdBy: scenario.createdBy,
      versionCount: scenario._count?.versions || 0,
      createdAt: scenario.createdAt,
      updatedAt: scenario.updatedAt,
    };
  }

  private transformScenarioDetail(scenario: any) {
    const base = this.transformScenario(scenario);

    return {
      ...base,
      baseline: scenario.baseline ? this.transformBaseline(scenario.baseline) : null,
      versions: scenario.versions || [],
    };
  }

  private transformBaseline(baseline: any) {
    return {
      id: baseline.id,
      companyId: baseline.companyId,
      company: baseline.company,
      customerId: baseline.customerId,
      customer: baseline.customer,
      productId: baseline.productId,
      product: baseline.product,
      channel: baseline.channel,
      category: baseline.category,
      brand: baseline.brand,
      region: baseline.region,
      periodType: baseline.periodType,
      periodYear: baseline.periodYear,
      periodMonth: baseline.periodMonth,
      periodWeek: baseline.periodWeek,
      periodQuarter: baseline.periodQuarter,
      baselineVolume: Number(baseline.baselineVolume),
      baselineRevenue: Number(baseline.baselineRevenue),
      baselineUnits: baseline.baselineUnits,
      baselineCases: baseline.baselineCases ? Number(baseline.baselineCases) : null,
      avgPricePerUnit: baseline.avgPricePerUnit ? Number(baseline.avgPricePerUnit) : null,
      avgPricePerCase: baseline.avgPricePerCase ? Number(baseline.avgPricePerCase) : null,
      sourceType: baseline.sourceType,
      calculationMethod: baseline.calculationMethod,
      historicalPeriods: baseline.historicalPeriods,
      calculationDetails: baseline.calculationDetails,
      isLocked: baseline.isLocked,
      lockedAt: baseline.lockedAt,
      lockedBy: baseline.lockedBy,
      lockReason: baseline.lockReason,
      notes: baseline.notes,
      tags: baseline.tags,
      createdById: baseline.createdById,
      createdBy: baseline.createdBy,
      updatedBy: baseline.updatedBy,
      scenarios: baseline.scenarios,
      createdAt: baseline.createdAt,
      updatedAt: baseline.updatedAt,
    };
  }
}
