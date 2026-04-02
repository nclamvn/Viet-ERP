import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { TemplateQueryDto } from './dto/template-query.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST TEMPLATES (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: TemplateQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      category,
      isPublic,
      companyId,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.PromotionTemplateWhereInput = {};

    if (category) {
      where.category = category;
    }

    if (isPublic !== undefined) {
      where.isPublic = isPublic;
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

    // Build orderBy with dynamic field validation
    const validSortFields = [
      'createdAt',
      'updatedAt',
      'name',
      'category',
      'usageCount',
      'isPublic',
    ];
    const orderBy: Prisma.PromotionTemplateOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.promotionTemplate.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          company: {
            select: { id: true, name: true, code: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: {
              versions: true,
            },
          },
        },
      }),
      this.prisma.promotionTemplate.count({ where }),
    ]);

    // Transform data to match frontend expectations
    const transformedData = data.map((template) => this.transformTemplate(template));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE TEMPLATE (with related data)
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const template = await this.prisma.promotionTemplate.findUnique({
      where: { id },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        versions: {
          orderBy: { version: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            versions: true,
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    return this.transformTemplateDetail(template);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET TEMPLATES BY CATEGORY
  // ═══════════════════════════════════════════════════════════════════════════
  async findByCategory(category: string) {
    // Validate category value
    const validCategories = ['SEASONAL', 'DISPLAY', 'LISTING', 'REBATE', 'CUSTOM'];
    if (!validCategories.includes(category)) {
      throw new BadRequestException(
        `Invalid category "${category}". Valid values: ${validCategories.join(', ')}`,
      );
    }

    const templates = await this.prisma.promotionTemplate.findMany({
      where: {
        category: category as Prisma.EnumTemplateCategoryFilter['equals'],
      },
      orderBy: { usageCount: 'desc' },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: {
            versions: true,
          },
        },
      },
    });

    return templates.map((template) => this.transformTemplate(template));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE TEMPLATE
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateTemplateDto, userId: string) {
    // Validate company exists
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });

    if (!company) {
      throw new BadRequestException(`Company with ID ${dto.companyId} not found`);
    }

    const template = await this.prisma.promotionTemplate.create({
      data: {
        name: dto.name,
        description: dto.description,
        template: dto.template as Prisma.InputJsonValue,
        category: dto.category || 'CUSTOM',
        channels: dto.channels || [],
        isPublic: dto.isPublic ?? false,
        usageCount: 0,
        companyId: dto.companyId,
        createdById: userId,
      },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: {
            versions: true,
          },
        },
      },
    });

    this.logger.log(`Template created: ${template.name} (${template.id})`);

    return this.transformTemplate(template);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE TEMPLATE
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateTemplateDto, userId: string) {
    const existing = await this.prisma.promotionTemplate.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    // Check if template JSON has changed - if so, create a new version
    const templateChanged =
      dto.template !== undefined &&
      JSON.stringify(dto.template) !== JSON.stringify(existing.template);

    // Build update data
    const updateData: Prisma.PromotionTemplateUpdateInput = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.template !== undefined) updateData.template = dto.template as Prisma.InputJsonValue;
    if (dto.category !== undefined) updateData.category = dto.category;
    if (dto.channels !== undefined) updateData.channels = dto.channels;
    if (dto.isPublic !== undefined) updateData.isPublic = dto.isPublic;

    if (templateChanged) {
      // Determine the next version number
      const currentVersion = existing.versions[0]?.version ?? 0;
      const nextVersion = currentVersion + 1;

      // Use transaction to update template and create version atomically
      const updated = await this.prisma.$transaction(async (tx) => {
        // Create version snapshot of the OLD template before updating
        await tx.templateVersion.create({
          data: {
            templateId: id,
            version: nextVersion,
            changes: dto.template as Prisma.InputJsonValue,
            snapshot: existing.template as Prisma.InputJsonValue,
            createdById: userId,
          },
        });

        // Update the template
        return tx.promotionTemplate.update({
          where: { id },
          data: updateData,
          include: {
            company: {
              select: { id: true, name: true, code: true },
            },
            createdBy: {
              select: { id: true, name: true, email: true },
            },
            _count: {
              select: {
                versions: true,
              },
            },
          },
        });
      });

      this.logger.log(
        `Template updated with new version (v${nextVersion}): ${updated.name} (${updated.id})`,
      );

      return this.transformTemplate(updated);
    }

    // No template JSON change - simple update
    const updated = await this.prisma.promotionTemplate.update({
      where: { id },
      data: updateData,
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: {
            versions: true,
          },
        },
      },
    });

    this.logger.log(`Template updated: ${updated.name} (${updated.id})`);

    return this.transformTemplate(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMOVE TEMPLATE (hard delete - cascades to versions)
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const template = await this.prisma.promotionTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    await this.prisma.promotionTemplate.delete({
      where: { id },
    });

    this.logger.log(`Template deleted: ${template.name} (${template.id})`);

    return { success: true, message: 'Template deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DUPLICATE TEMPLATE
  // ═══════════════════════════════════════════════════════════════════════════
  async duplicate(id: string, userId: string) {
    const source = await this.prisma.promotionTemplate.findUnique({
      where: { id },
    });

    if (!source) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    const duplicate = await this.prisma.promotionTemplate.create({
      data: {
        name: `${source.name} (Copy)`,
        description: source.description,
        template: source.template as Prisma.InputJsonValue,
        category: source.category,
        channels: source.channels,
        isPublic: source.isPublic,
        usageCount: 0,
        companyId: source.companyId,
        createdById: userId,
      },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: {
            versions: true,
          },
        },
      },
    });

    this.logger.log(`Template duplicated: ${source.name} -> ${duplicate.name} (${duplicate.id})`);

    return this.transformTemplate(duplicate);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET CATEGORIES
  // ═══════════════════════════════════════════════════════════════════════════
  getCategories() {
    return [
      { value: 'SEASONAL', label: 'Seasonal' },
      { value: 'DISPLAY', label: 'Display' },
      { value: 'LISTING', label: 'Listing' },
      { value: 'REBATE', label: 'Rebate' },
      { value: 'CUSTOM', label: 'Custom' },
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Template for List Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformTemplate(template: any) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      template: template.template,
      category: template.category,
      channels: template.channels,
      isPublic: template.isPublic,
      usageCount: template.usageCount,
      companyId: template.companyId,
      company: template.company || null,
      createdById: template.createdById,
      createdBy: template.createdBy || null,
      versionCount: template._count?.versions || 0,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Template Detail Response (with versions)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformTemplateDetail(template: any) {
    const base = this.transformTemplate(template);

    return {
      ...base,
      versions:
        template.versions?.map((v: any) => ({
          id: v.id,
          version: v.version,
          changes: v.changes,
          snapshot: v.snapshot,
          createdAt: v.createdAt,
          createdById: v.createdById,
        })) || [],
    };
  }
}
