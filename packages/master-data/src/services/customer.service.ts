// ============================================================
// @vierp/master-data - Customer Service
// CRUD + sync for Customer master data
// ============================================================

import { prisma } from '@vierp/database';
import type { Customer } from '@vierp/shared';
import type { MasterDataQuery, MasterDataEntity } from '../types';
import { BaseMasterDataService, MasterDataError } from './base.service';

export class CustomerService extends BaseMasterDataService<Customer & { id: string; tenantId: string }> {
  protected entityName: MasterDataEntity = 'customer';

  protected async findById(id: string, tenantId: string) {
    const record = await prisma.customer.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    return record ? this.mapToType(record) : null;
  }

  protected async findByCode(code: string, tenantId: string) {
    const record = await prisma.customer.findFirst({
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

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
      ];
    }

    if (query.code) {
      where.code = { contains: query.code, mode: 'insensitive' };
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
      prisma.customer.findMany({
        where: where as any,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
      }),
      prisma.customer.count({ where: where as any }),
    ]);

    return { data: data.map(this.mapToType), total };
  }

  protected async createRecord(data: any, tenantId: string) {
    // Check for duplicate code
    const existing = await prisma.customer.findFirst({
      where: { code: data.code, tenantId },
    });
    if (existing) {
      throw new MasterDataError(`Customer code already exists: ${data.code}`, 'DUPLICATE_CODE', 409);
    }

    const record = await prisma.customer.create({
      data: {
        code: data.code,
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        taxCode: data.taxCode || null,
        type: (data.type || 'COMPANY').toUpperCase() as any,
        status: 'ACTIVE',
        address: data.address ? JSON.parse(JSON.stringify(data.address)) : undefined,
        tenantId,
        createdBy: data.createdBy || null,
      },
    });

    return this.mapToType(record);
  }

  protected async updateRecord(id: string, data: Partial<any>, tenantId: string) {
    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.taxCode !== undefined) updateData.taxCode = data.taxCode;
    if (data.type !== undefined) updateData.type = data.type.toUpperCase();
    if (data.status !== undefined) updateData.status = data.status.toUpperCase();
    if (data.address !== undefined) updateData.address = JSON.parse(JSON.stringify(data.address));

    const record = await prisma.customer.update({
      where: { id },
      data: updateData as any,
    });

    return this.mapToType(record);
  }

  protected async softDeleteRecord(id: string, tenantId: string) {
    const record = await prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'INACTIVE' as any },
    });
    return this.mapToType(record);
  }

  protected async restoreRecord(id: string, tenantId: string) {
    const record = await prisma.customer.update({
      where: { id },
      data: { deletedAt: null, status: 'ACTIVE' as any },
    });
    return this.mapToType(record);
  }

  // ==================== Customer-specific methods ====================

  async findByTaxCode(taxCode: string, tenantId: string) {
    const record = await prisma.customer.findFirst({
      where: { taxCode, tenantId, deletedAt: null },
    });
    return record ? this.mapToType(record) : null;
  }

  async getStats(tenantId: string) {
    const [total, active, inactive] = await Promise.all([
      prisma.customer.count({ where: { tenantId, deletedAt: null } }),
      prisma.customer.count({ where: { tenantId, status: 'ACTIVE', deletedAt: null } }),
      prisma.customer.count({ where: { tenantId, status: 'INACTIVE', deletedAt: null } }),
    ]);
    return { total, active, inactive, companies: 0, individuals: 0 };
  }

  // ==================== Mapping ====================

  private mapToType(record: any): Customer & { id: string; tenantId: string } {
    return {
      id: record.id,
      code: record.code,
      name: record.name,
      email: record.email || undefined,
      phone: record.phone || undefined,
      taxCode: record.taxCode || undefined,
      type: record.type?.toLowerCase() === 'individual' ? 'individual' : 'company',
      status: record.status?.toLowerCase() === 'active' ? 'active' : 'inactive',
      address: record.address as any,
      tenantId: record.tenantId,
      createdBy: record.createdBy || '',
      updatedBy: record.createdBy || '',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt || undefined,
    };
  }
}

export const customerService = new CustomerService();
