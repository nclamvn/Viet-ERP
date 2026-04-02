import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateGeographicUnitDto, GeographicLevelEnum } from './dto/create-geographic-unit.dto';
import { UpdateGeographicUnitDto } from './dto/update-geographic-unit.dto';
import { GeographicUnitQueryDto } from './dto/geographic-unit-query.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

// Level hierarchy order for validation (lower index = higher in hierarchy)
const LEVEL_ORDER: GeographicLevelEnum[] = [
  GeographicLevelEnum.COUNTRY,
  GeographicLevelEnum.REGION,
  GeographicLevelEnum.PROVINCE,
  GeographicLevelEnum.DISTRICT,
  GeographicLevelEnum.DEALER,
];

function getLevelIndex(level: string): number {
  return LEVEL_ORDER.indexOf(level as GeographicLevelEnum);
}

@Injectable()
export class RegionsService {
  private readonly logger = new Logger(RegionsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST GEOGRAPHIC UNITS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: GeographicUnitQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { level, parentId, isActive, search, sortBy, sortOrder = 'asc' } = query;

    // Build where clause
    const where: Prisma.GeographicUnitWhereInput = {};

    if (level) {
      where.level = level;
    }

    if (parentId) {
      where.parentId = parentId;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { nameEn: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy with validated sort fields
    const validSortFields = ['name', 'code', 'level', 'sortOrder', 'createdAt', 'updatedAt'];
    const orderBy =
      sortBy && validSortFields.includes(sortBy)
        ? { [sortBy]: sortOrder }
        : { name: 'asc' as const };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.geographicUnit.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          parent: {
            select: { id: true, name: true, code: true, level: true },
          },
          _count: {
            select: {
              children: true,
              budgetAllocations: true,
              targetAllocations: true,
            },
          },
        },
      }),
      this.prisma.geographicUnit.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE GEOGRAPHIC UNIT
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const unit = await this.prisma.geographicUnit.findUnique({
      where: { id },
      include: {
        parent: {
          select: { id: true, name: true, code: true, level: true },
        },
        children: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            code: true,
            name: true,
            nameEn: true,
            level: true,
            isActive: true,
            sortOrder: true,
          },
        },
        _count: {
          select: {
            children: true,
            budgetAllocations: true,
            targetAllocations: true,
          },
        },
      },
    });

    if (!unit) {
      throw new NotFoundException(`Geographic unit with ID ${id} not found`);
    }

    return unit;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE GEOGRAPHIC UNIT
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateGeographicUnitDto) {
    // Validate code uniqueness
    const existing = await this.prisma.geographicUnit.findUnique({
      where: { code: dto.code },
    });

    if (existing) {
      throw new ConflictException(`Geographic unit with code "${dto.code}" already exists`);
    }

    // Validate parent exists and level constraints
    if (dto.parentId) {
      const parent = await this.prisma.geographicUnit.findUnique({
        where: { id: dto.parentId },
      });

      if (!parent) {
        throw new BadRequestException(`Parent geographic unit with ID "${dto.parentId}" not found`);
      }

      // Child level must be lower in hierarchy than parent level
      const parentIndex = getLevelIndex(parent.level);
      const childIndex = getLevelIndex(dto.level);

      if (childIndex <= parentIndex) {
        throw new BadRequestException(
          `Child level "${dto.level}" must be lower in hierarchy than parent level "${parent.level}". ` +
            `Expected one of: ${LEVEL_ORDER.slice(parentIndex + 1).join(', ')}`,
        );
      }
    }

    const unit = await this.prisma.geographicUnit.create({
      data: {
        code: dto.code,
        name: dto.name,
        nameEn: dto.nameEn,
        level: dto.level,
        parentId: dto.parentId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: {
        parent: {
          select: { id: true, name: true, code: true, level: true },
        },
        _count: {
          select: {
            children: true,
            budgetAllocations: true,
            targetAllocations: true,
          },
        },
      },
    });

    this.logger.log(`Geographic unit created: ${unit.code} - ${unit.name} (${unit.level})`);

    return unit;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE GEOGRAPHIC UNIT
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateGeographicUnitDto) {
    const unit = await this.prisma.geographicUnit.findUnique({
      where: { id },
    });

    if (!unit) {
      throw new NotFoundException(`Geographic unit with ID ${id} not found`);
    }

    // Determine the effective level after update
    const effectiveLevel = dto.level || unit.level;

    // Validate parent level constraints if parentId or level is changing
    if (dto.parentId !== undefined || dto.level !== undefined) {
      const effectiveParentId = dto.parentId !== undefined ? dto.parentId : unit.parentId;

      if (effectiveParentId) {
        const parent = await this.prisma.geographicUnit.findUnique({
          where: { id: effectiveParentId },
        });

        if (!parent) {
          throw new BadRequestException(
            `Parent geographic unit with ID "${effectiveParentId}" not found`,
          );
        }

        const parentIndex = getLevelIndex(parent.level);
        const childIndex = getLevelIndex(effectiveLevel);

        if (childIndex <= parentIndex) {
          throw new BadRequestException(
            `Level "${effectiveLevel}" must be lower in hierarchy than parent level "${parent.level}". ` +
              `Expected one of: ${LEVEL_ORDER.slice(parentIndex + 1).join(', ')}`,
          );
        }
      }

      // If level is changing, also validate against existing children
      if (dto.level && dto.level !== unit.level) {
        const children = await this.prisma.geographicUnit.findMany({
          where: { parentId: id },
          select: { level: true, code: true },
        });

        for (const child of children) {
          const newParentIndex = getLevelIndex(dto.level);
          const childIndex = getLevelIndex(child.level);
          if (childIndex <= newParentIndex) {
            throw new BadRequestException(
              `Cannot change level to "${dto.level}" because child "${child.code}" has level "${child.level}" ` +
                `which would violate the hierarchy constraint`,
            );
          }
        }
      }
    }

    // Prevent setting parentId to self
    if (dto.parentId === id) {
      throw new BadRequestException('A geographic unit cannot be its own parent');
    }

    const updated = await this.prisma.geographicUnit.update({
      where: { id },
      data: {
        name: dto.name,
        nameEn: dto.nameEn,
        level: dto.level,
        parentId: dto.parentId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
      include: {
        parent: {
          select: { id: true, name: true, code: true, level: true },
        },
        _count: {
          select: {
            children: true,
            budgetAllocations: true,
            targetAllocations: true,
          },
        },
      },
    });

    this.logger.log(`Geographic unit updated: ${updated.code} - ${updated.name}`);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE GEOGRAPHIC UNIT
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const unit = await this.prisma.geographicUnit.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            children: true,
            budgetAllocations: true,
          },
        },
      },
    });

    if (!unit) {
      throw new NotFoundException(`Geographic unit with ID ${id} not found`);
    }

    // Check for children
    if (unit._count.children > 0) {
      throw new BadRequestException(
        `Cannot delete geographic unit with ${unit._count.children} child unit(s). Remove or reassign children first.`,
      );
    }

    // Check for budget allocations
    if (unit._count.budgetAllocations > 0) {
      throw new BadRequestException(
        `Cannot delete geographic unit with ${unit._count.budgetAllocations} budget allocation(s). Remove allocations first.`,
      );
    }

    await this.prisma.geographicUnit.delete({
      where: { id },
    });

    this.logger.log(`Geographic unit deleted: ${unit.code} - ${unit.name}`);

    return { success: true, message: 'Geographic unit deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET HIERARCHY (full tree structure)
  // ═══════════════════════════════════════════════════════════════════════════
  async getHierarchy() {
    const allUnits = await this.prisma.geographicUnit.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        nameEn: true,
        level: true,
        parentId: true,
        isActive: true,
        sortOrder: true,
        latitude: true,
        longitude: true,
      },
    });

    // Build tree structure recursively
    const unitMap = new Map<string, any>();
    const roots: any[] = [];

    // First pass: create map of all units with empty children array
    for (const unit of allUnits) {
      unitMap.set(unit.id, { ...unit, children: [] });
    }

    // Second pass: build tree
    for (const unit of allUnits) {
      const node = unitMap.get(unit.id);
      if (unit.parentId && unitMap.has(unit.parentId)) {
        unitMap.get(unit.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET LEVELS (enum values with labels)
  // ═══════════════════════════════════════════════════════════════════════════
  getLevels() {
    return [
      { value: GeographicLevelEnum.COUNTRY, label: 'Country', order: 0 },
      { value: GeographicLevelEnum.REGION, label: 'Region', order: 1 },
      { value: GeographicLevelEnum.PROVINCE, label: 'Province', order: 2 },
      { value: GeographicLevelEnum.DISTRICT, label: 'District', order: 3 },
      { value: GeographicLevelEnum.DEALER, label: 'Dealer', order: 4 },
    ];
  }
}
