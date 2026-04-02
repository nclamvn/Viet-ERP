import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST PRODUCTS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: ProductQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      category,
      brand,
      isActive,
      companyId,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.ProductWhereInput = {};

    if (category) {
      where.category = category;
    }

    if (brand) {
      where.brand = brand;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (companyId) {
      where.companyId = companyId;
    }

    if (search) {
      where.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = [
      'createdAt',
      'name',
      'sku',
      'category',
      'brand',
      'price',
      'cogs',
      'updatedAt',
    ];
    const orderBy: Prisma.ProductOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          company: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: { tacticItems: true, baselines: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // Transform data
    const transformedData = data.map((product) => this.transformProduct(product));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE PRODUCT
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { tacticItems: true, baselines: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return this.transformProduct(product);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE PRODUCT
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateProductDto) {
    // Validate unique [companyId, sku]
    const existing = await this.prisma.product.findUnique({
      where: {
        companyId_sku: {
          companyId: dto.companyId,
          sku: dto.sku,
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Product with SKU "${dto.sku}" already exists for this company`);
    }

    const product = await this.prisma.product.create({
      data: {
        sku: dto.sku,
        name: dto.name,
        category: dto.category,
        brand: dto.brand,
        cogs: dto.cogs,
        price: dto.price,
        unit: dto.unit || 'EA',
        companyId: dto.companyId,
      },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { tacticItems: true, baselines: true },
        },
      },
    });

    this.logger.log(`Product created: ${product.sku} - ${product.name}`);

    return this.transformProduct(product);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE PRODUCT
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        category: dto.category,
        brand: dto.brand,
        cogs: dto.cogs,
        price: dto.price,
        unit: dto.unit,
      },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: { tacticItems: true, baselines: true },
        },
      },
    });

    this.logger.log(`Product updated: ${updated.sku} - ${updated.name}`);

    return this.transformProduct(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMOVE (SOFT DELETE / DEACTIVATE) PRODUCT
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        _count: {
          select: { tacticItems: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    // Check for active tactic items
    if (product._count.tacticItems > 0) {
      throw new BadRequestException(
        `Cannot deactivate product with ${product._count.tacticItems} active tactic item(s). Remove tactic items first.`,
      );
    }

    await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(`Product deactivated: ${product.sku} - ${product.name}`);

    return { success: true, message: 'Product deactivated successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET DISTINCT CATEGORIES
  // ═══════════════════════════════════════════════════════════════════════════
  async getCategories() {
    const result = await this.prisma.product.findMany({
      where: {
        category: { not: null },
        isActive: true,
      },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });

    return result.map((r) => r.category).filter(Boolean);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET DISTINCT BRANDS
  // ═══════════════════════════════════════════════════════════════════════════
  async getBrands() {
    const result = await this.prisma.product.findMany({
      where: {
        brand: { not: null },
        isActive: true,
      },
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    });

    return result.map((r) => r.brand).filter(Boolean);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Product for Response (Decimal -> Number)
  // ═══════════════════════════════════════════════════════════════════════════
  private transformProduct(product: any) {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      brand: product.brand,
      cogs: product.cogs !== null && product.cogs !== undefined ? Number(product.cogs) : null,
      price: product.price !== null && product.price !== undefined ? Number(product.price) : null,
      unit: product.unit,
      isActive: product.isActive,
      companyId: product.companyId,
      company: product.company || null,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      tacticItemCount: product._count?.tacticItems || 0,
      baselineCount: product._count?.baselines || 0,
    };
  }
}
