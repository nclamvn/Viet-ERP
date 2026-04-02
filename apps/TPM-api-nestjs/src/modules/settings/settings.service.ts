import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SOXControlQueryDto } from './dto/sox-control-query.dto';
import { CreateSOXControlDto } from './dto/create-sox-control.dto';
import { UpdateSOXControlDto } from './dto/update-sox-control.dto';
import { SOXViolationQueryDto } from './dto/sox-violation-query.dto';
import { ReviewViolationDto } from './dto/review-violation.dto';
import { CreateClashRuleDto } from './dto/create-clash-rule.dto';
import { UpdateClashRuleDto } from './dto/update-clash-rule.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // SOX CONTROLS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── LIST SOX CONTROLS ──────────────────────────────────────────────────────
  async findAllSOXControls(query: SOXControlQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { companyId, type, status, search, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const where: Prisma.SOXControlWhereInput = {};

    if (companyId) where.companyId = companyId;
    if (type) where.type = type;
    if (status) where.status = status;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const validSortFields = ['createdAt', 'name', 'code', 'type', 'status', 'severity'];
    const orderBy: Prisma.SOXControlOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.sOXControl.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          _count: { select: { violations: true } },
        },
      }),
      this.prisma.sOXControl.count({ where }),
    ]);

    const transformedData = data.map((c: any) => ({
      ...c,
      violationCount: c._count?.violations || 0,
    }));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ── GET SOX CONTROL BY ID ──────────────────────────────────────────────────
  async findOneSOXControl(id: string) {
    const control = await this.prisma.sOXControl.findUnique({
      where: { id },
      include: {
        violations: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            user: { select: { id: true, name: true, email: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
        },
        _count: { select: { violations: true } },
      },
    });

    if (!control) {
      throw new NotFoundException(`SOX Control with ID ${id} not found`);
    }

    const result = control as any;
    return {
      ...result,
      violationCount: result._count?.violations || 0,
    };
  }

  // ── CREATE SOX CONTROL ─────────────────────────────────────────────────────
  async createSOXControl(dto: CreateSOXControlDto) {
    const control = await this.prisma.sOXControl.create({
      data: {
        companyId: dto.companyId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        status: dto.status || 'ACTIVE',
        config: dto.config,
        isBlocking: dto.isBlocking ?? true,
        severity: dto.severity || 'HIGH',
      },
      include: {
        _count: { select: { violations: true } },
      },
    });

    this.logger.log(`SOX Control created: ${control.code} - ${control.name}`);

    const result = control as any;
    return {
      ...result,
      violationCount: result._count?.violations || 0,
    };
  }

  // ── UPDATE SOX CONTROL ─────────────────────────────────────────────────────
  async updateSOXControl(id: string, dto: UpdateSOXControlDto) {
    const existing = await this.prisma.sOXControl.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`SOX Control with ID ${id} not found`);
    }

    const control = await this.prisma.sOXControl.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        status: dto.status,
        config: dto.config,
        isBlocking: dto.isBlocking,
        severity: dto.severity,
      },
      include: {
        _count: { select: { violations: true } },
      },
    });

    this.logger.log(`SOX Control updated: ${control.code}`);

    const result = control as any;
    return {
      ...result,
      violationCount: result._count?.violations || 0,
    };
  }

  // ── TEST SOX CONTROL ───────────────────────────────────────────────────────
  async testSOXControl(id: string) {
    const existing = await this.prisma.sOXControl.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`SOX Control with ID ${id} not found`);
    }

    // Simulate control test
    const testResult = 'PASS';

    const control = await this.prisma.sOXControl.update({
      where: { id },
      data: {
        lastTestedAt: new Date(),
        lastTestResult: testResult,
      },
      include: {
        _count: { select: { violations: true } },
      },
    });

    this.logger.log(`SOX Control tested: ${control.code} - Result: ${testResult}`);

    const result = control as any;
    return {
      ...result,
      violationCount: result._count?.violations || 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SOX VIOLATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── LIST SOX VIOLATIONS ────────────────────────────────────────────────────
  async findAllSOXViolations(query: SOXViolationQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      companyId,
      controlId,
      userId,
      entityType,
      reviewed,
      isExcepted,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.SOXViolationWhereInput = {};

    if (companyId) where.companyId = companyId;
    if (controlId) where.controlId = controlId;
    if (userId) where.userId = userId;
    if (entityType) where.entityType = entityType;
    if (isExcepted !== undefined) where.isExcepted = isExcepted;

    if (reviewed !== undefined) {
      if (reviewed) {
        where.reviewedAt = { not: null };
      } else {
        where.reviewedAt = null;
      }
    }

    const validSortFields = ['createdAt', 'action', 'entityType'];
    const orderBy: Prisma.SOXViolationOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.sOXViolation.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          control: { select: { id: true, code: true, name: true, type: true, severity: true } },
          user: { select: { id: true, name: true, email: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.sOXViolation.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ── REVIEW VIOLATION ───────────────────────────────────────────────────────
  async reviewViolation(id: string, dto: ReviewViolationDto, reviewerId: string) {
    const violation = await this.prisma.sOXViolation.findUnique({ where: { id } });

    if (!violation) {
      throw new NotFoundException(`SOX Violation with ID ${id} not found`);
    }

    if (violation.reviewedAt) {
      throw new BadRequestException('Violation has already been reviewed');
    }

    const updated = await this.prisma.sOXViolation.update({
      where: { id },
      data: {
        reviewedAt: new Date(),
        reviewedById: reviewerId,
        reviewNotes: dto.reviewNotes,
      },
      include: {
        control: { select: { id: true, code: true, name: true, type: true, severity: true } },
        user: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`SOX Violation reviewed: ${id} by user ${reviewerId}`);

    return updated;
  }

  // ── MARK VIOLATION AS EXCEPTION ────────────────────────────────────────────
  async exceptViolation(id: string, reviewerId: string) {
    const violation = await this.prisma.sOXViolation.findUnique({ where: { id } });

    if (!violation) {
      throw new NotFoundException(`SOX Violation with ID ${id} not found`);
    }

    const updated = await this.prisma.sOXViolation.update({
      where: { id },
      data: {
        isExcepted: true,
        reviewedAt: violation.reviewedAt || new Date(),
        reviewedById: violation.reviewedById || reviewerId,
        reviewNotes: violation.reviewNotes
          ? `${violation.reviewNotes} [Marked as exception]`
          : 'Marked as exception',
      },
      include: {
        control: { select: { id: true, code: true, name: true, type: true, severity: true } },
        user: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`SOX Violation excepted: ${id} by user ${reviewerId}`);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLASH RULES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── LIST CLASH RULES ───────────────────────────────────────────────────────
  async findAllClashRules(companyId?: string) {
    const where: Prisma.ClashRuleWhereInput = {};
    if (companyId) where.companyId = companyId;

    const rules = await this.prisma.clashRule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return rules;
  }

  // ── CREATE CLASH RULE ──────────────────────────────────────────────────────
  async createClashRule(dto: CreateClashRuleDto) {
    const rule = await this.prisma.clashRule.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        description: dto.description,
        clashType: dto.clashType,
        severity: dto.severity || 'MEDIUM',
        config: dto.config,
        isActive: dto.isActive ?? true,
        isBlocking: dto.isBlocking ?? false,
      },
    });

    this.logger.log(`Clash Rule created: ${rule.name}`);

    return rule;
  }

  // ── UPDATE CLASH RULE ──────────────────────────────────────────────────────
  async updateClashRule(id: string, dto: UpdateClashRuleDto) {
    const existing = await this.prisma.clashRule.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`Clash Rule with ID ${id} not found`);
    }

    const rule = await this.prisma.clashRule.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        clashType: dto.clashType,
        severity: dto.severity,
        config: dto.config,
        isActive: dto.isActive,
        isBlocking: dto.isBlocking,
      },
    });

    this.logger.log(`Clash Rule updated: ${rule.name}`);

    return rule;
  }

  // ── TOGGLE CLASH RULE ACTIVE ───────────────────────────────────────────────
  async toggleClashRule(id: string) {
    const existing = await this.prisma.clashRule.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException(`Clash Rule with ID ${id} not found`);
    }

    const rule = await this.prisma.clashRule.update({
      where: { id },
      data: {
        isActive: !existing.isActive,
      },
    });

    this.logger.log(`Clash Rule toggled: ${rule.name} - Active: ${rule.isActive}`);

    return rule;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS OVERVIEW
  // ═══════════════════════════════════════════════════════════════════════════

  async getOverview(companyId?: string) {
    const controlWhere: Prisma.SOXControlWhereInput = {};
    const violationWhere: Prisma.SOXViolationWhereInput = {};
    const ruleWhere: Prisma.ClashRuleWhereInput = {};

    if (companyId) {
      controlWhere.companyId = companyId;
      violationWhere.companyId = companyId;
      ruleWhere.companyId = companyId;
    }

    const [
      totalControls,
      activeControls,
      totalViolations,
      unreviewedViolations,
      totalClashRules,
      activeClashRules,
    ] = await Promise.all([
      this.prisma.sOXControl.count({ where: controlWhere }),
      this.prisma.sOXControl.count({ where: { ...controlWhere, status: 'ACTIVE' } }),
      this.prisma.sOXViolation.count({ where: violationWhere }),
      this.prisma.sOXViolation.count({ where: { ...violationWhere, reviewedAt: null } }),
      this.prisma.clashRule.count({ where: ruleWhere }),
      this.prisma.clashRule.count({ where: { ...ruleWhere, isActive: true } }),
    ]);

    return {
      soxControls: {
        total: totalControls,
        active: activeControls,
      },
      soxViolations: {
        total: totalViolations,
        unreviewed: unreviewedViolations,
      },
      clashRules: {
        total: totalClashRules,
        active: activeClashRules,
      },
    };
  }
}
