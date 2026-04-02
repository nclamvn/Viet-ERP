import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST CUSTOMERS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: CustomerQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      channel,
      isActive,
      companyId,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.CustomerWhereInput = {};

    if (channel) {
      where.channel = channel;
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
        { code: { contains: search, mode: 'insensitive' } },
        { subChannel: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { taxCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy with dynamic field validation
    const validSortFields = ['createdAt', 'name', 'code', 'channel', 'isActive', 'updatedAt'];
    const orderBy: Prisma.CustomerOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          company: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: {
              promotions: true,
              claims: true,
              funds: true,
            },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    // Transform data to match frontend expectations
    const transformedData = data.map((customer) => this.transformCustomer(customer));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE CUSTOMER (with related data)
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: {
            promotions: true,
            claims: true,
            funds: true,
          },
        },
        promotions: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            startDate: true,
            endDate: true,
            budget: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        claims: {
          select: {
            id: true,
            code: true,
            status: true,
            amount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return this.transformCustomerDetail(customer);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE CUSTOMER
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateCustomerDto) {
    // Validate unique [companyId, code]
    const existing = await this.prisma.customer.findUnique({
      where: {
        companyId_code: {
          companyId: dto.companyId,
          code: dto.code,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Customer with code "${dto.code}" already exists in this company`,
      );
    }

    // Validate company exists
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });

    if (!company) {
      throw new BadRequestException(`Company with ID ${dto.companyId} not found`);
    }

    const customer = await this.prisma.customer.create({
      data: {
        code: dto.code,
        name: dto.name,
        channel: dto.channel || 'MT',
        subChannel: dto.subChannel,
        address: dto.address,
        taxCode: dto.taxCode,
        companyId: dto.companyId,
      },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: {
            promotions: true,
            claims: true,
            funds: true,
          },
        },
      },
    });

    this.logger.log(`Customer created: ${customer.code} (${customer.name})`);

    return this.transformCustomer(customer);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE CUSTOMER
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    // Validate name uniqueness within the same company if name is being changed
    if (dto.name && dto.name !== customer.name) {
      const duplicate = await this.prisma.customer.findFirst({
        where: {
          companyId: customer.companyId,
          name: dto.name,
          id: { not: id },
        },
      });

      if (duplicate) {
        throw new ConflictException(
          `Customer with name "${dto.name}" already exists in this company`,
        );
      }
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name,
        channel: dto.channel,
        subChannel: dto.subChannel,
        address: dto.address,
        taxCode: dto.taxCode,
      },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: {
            promotions: true,
            claims: true,
            funds: true,
          },
        },
      },
    });

    this.logger.log(`Customer updated: ${updated.code} (${updated.name})`);

    return this.transformCustomer(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMOVE CUSTOMER (soft delete - set isActive = false)
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        _count: {
          select: { promotions: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    // Check for active promotions before deactivating
    const activePromotions = await this.prisma.promotion.count({
      where: {
        customerId: id,
        status: { in: ['PLANNED', 'CONFIRMED', 'EXECUTING'] },
      },
    });

    if (activePromotions > 0) {
      throw new BadRequestException(
        `Cannot deactivate customer with ${activePromotions} active promotion(s). Please complete or cancel them first.`,
      );
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(`Customer deactivated: ${updated.code} (${updated.name})`);

    return { success: true, message: 'Customer deactivated successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOGGLE ACTIVE STATUS
  // ═══════════════════════════════════════════════════════════════════════════
  async toggleActive(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    // If activating, just flip. If deactivating, check for active promotions.
    if (customer.isActive) {
      const activePromotions = await this.prisma.promotion.count({
        where: {
          customerId: id,
          status: { in: ['PLANNED', 'CONFIRMED', 'EXECUTING'] },
        },
      });

      if (activePromotions > 0) {
        throw new BadRequestException(
          `Cannot deactivate customer with ${activePromotions} active promotion(s). Please complete or cancel them first.`,
        );
      }
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: { isActive: !customer.isActive },
      include: {
        company: {
          select: { id: true, name: true, code: true },
        },
        _count: {
          select: {
            promotions: true,
            claims: true,
            funds: true,
          },
        },
      },
    });

    this.logger.log(
      `Customer ${updated.isActive ? 'activated' : 'deactivated'}: ${updated.code} (${updated.name})`,
    );

    return this.transformCustomer(updated);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Customer for List Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformCustomer(customer: any) {
    return {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      channel: customer.channel,
      subChannel: customer.subChannel,
      address: customer.address,
      taxCode: customer.taxCode,
      isActive: customer.isActive,
      companyId: customer.companyId,
      company: customer.company || null,
      promotionCount: customer._count?.promotions || 0,
      claimCount: customer._count?.claims || 0,
      fundCount: customer._count?.funds || 0,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Customer Detail Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformCustomerDetail(customer: any) {
    const base = this.transformCustomer(customer);

    return {
      ...base,
      recentPromotions:
        customer.promotions?.map((p: any) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          status: p.status,
          startDate: p.startDate,
          endDate: p.endDate,
          budget: Number(p.budget),
        })) || [],
      recentClaims:
        customer.claims?.map((c: any) => ({
          id: c.id,
          code: c.code,
          status: c.status,
          amount: Number(c.amount),
          createdAt: c.createdAt,
        })) || [],
    };
  }
}
