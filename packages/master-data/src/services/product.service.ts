// ============================================================
// @vierp/master-data - Product Service
// CRUD + sync for Product master data
// ============================================================

import { prisma } from '@vierp/database';
import type { Product } from '@vierp/shared';
import type { MasterDataQuery, MasterDataEntity } from '../types';
import { BaseMasterDataService, MasterDataError } from './base.service';

export class ProductService extends BaseMasterDataService<Product & { id: string; tenantId: string }> {
  protected entityName: MasterDataEntity = 'product';

  protected async findById(id: string, tenantId: string) {
    const record = await prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    return record ? this.mapToType(record) : null;
  }

  protected async findByCode(code: string, tenantId: string) {
    const record = await prisma.product.findFirst({
      where: { code, tenantId, deletedAt: null },
    });
    return record ? this.mapToType(record) : null;
  }

  protected async findMany(query: MasterDataQuery) {
    const where: Record<string, unknown> = {
      tenantId: query.tenantId,
    };

    if (!query.includeDeleted) {
      where.deletedAt = null;
    }

    if (query.status) {
      where.status = query.status.toUpperCase();
    }

    if (query.category) {
      where.category = { contains: query.category, mode: 'insensitive' };
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.createdAfter) {
      where.createdAt = { ...(where.createdAt as object || {}), gte: query.createdAfter };
    }

    if (query.createdBefore) {
      where.createdAt = { ...(where.createdAt as object || {}), lte: query.createdBefore };
    }

    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where: where as any,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
      }),
      prisma.product.count({ where: where as any }),
    ]);

    return { data: data.map(this.mapToType), total };
  }

  protected async createRecord(data: any, tenantId: string) {
    const existing = await prisma.product.findFirst({
      where: { code: data.code, tenantId },
    });
    if (existing) {
      throw new MasterDataError(`Product code already exists: ${data.code}`, 'DUPLICATE_CODE', 409);
    }

    const record = await prisma.product.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description || null,
        unit: data.unit || 'PCS',
        category: data.category || null,
        price: data.price || 0,
        cost: data.cost || 0,
        status: 'ACTIVE',
        tenantId,
        createdBy: data.createdBy || null,
      },
    });

    return this.mapToType(record);
  }

  protected async updateRecord(id: string, data: Partial<any>, tenantId: string) {
    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.unit !== undefined) updateData.unit = data.unit;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.cost !== undefined) updateData.cost = data.cost;
    if (data.status !== undefined) updateData.status = data.status.toUpperCase();

    const record = await prisma.product.update({
      where: { id },
      data: updateData as any,
    });

    return this.mapToType(record);
  }

  protected async softDeleteRecord(id: string, tenantId: string) {
    const record = await prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DISCONTINUED' as any },
    });
    return this.mapToType(record);
  }

  protected async restoreRecord(id: string, tenantId: string) {
    const record = await prisma.product.update({
      where: { id },
      data: { deletedAt: null, status: 'ACTIVE' as any },
    });
    return this.mapToType(record);
  }

  // ==================== Product-specific methods ====================

  async findByCategory(category: string, tenantId: string) {
    const records = await prisma.product.findMany({
      where: { category, tenantId, deletedAt: null, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
    return records.map(this.mapToType);
  }

  async getCategories(tenantId: string): Promise<string[]> {
    const result = await prisma.product.findMany({
      where: { tenantId, deletedAt: null, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return result.map(r => r.category).filter(Boolean) as string[];
  }

  async getStats(tenantId: string) {
    const [total, active, discontinued] = await Promise.all([
      prisma.product.count({ where: { tenantId, deletedAt: null } }),
      prisma.product.count({ where: { tenantId, status: 'ACTIVE', deletedAt: null } }),
      prisma.product.count({ where: { tenantId, status: 'DISCONTINUED', deletedAt: null } }),
    ]);
    return { total, active, discontinued };
  }

  // ==================== Mapping ====================

  private mapToType(record: any): Product & { id: string; tenantId: string } {
    return {
      id: record.id,
      code: record.code,
      name: record.name,
      description: record.description || undefined,
      unit: record.unit,
      category: record.category || undefined,
      price: Number(record.price),
      cost: Number(record.cost),
      status: record.status?.toLowerCase() === 'active'
        ? 'active'
        : record.status?.toLowerCase() === 'discontinued'
        ? 'discontinued'
        : 'inactive',
      tenantId: record.tenantId,
      createdBy: record.createdBy || '',
      updatedBy: record.createdBy || '',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt || undefined,
    };
  }
}

export const productService = new ProductService();
