// ============================================================
// @vierp/master-data - Supplier Service
// CRUD for Supplier master data (new entity — not in shared DB yet)
// Uses in-memory store until Prisma schema is extended
// ============================================================

import type { MasterDataQuery, MasterDataEntity, Supplier } from '../types';
import { BaseMasterDataService, MasterDataError } from './base.service';

/**
 * Supplier Service — manages vendor/supplier records.
 * Used by MRP (materials procurement), OTB (purchasing), Accounting (AP).
 *
 * NOTE: This uses a Map-based store as a reference implementation.
 * Once the Prisma schema is extended with a Supplier model, swap to DB calls.
 */
export class SupplierService extends BaseMasterDataService<Supplier & { id: string; tenantId: string }> {
  protected entityName: MasterDataEntity = 'supplier';

  // In-memory store — replaced by Prisma when DB schema is ready
  private store = new Map<string, Supplier>();

  protected async findById(id: string, tenantId: string) {
    const record = this.store.get(id);
    if (!record || record.tenantId !== tenantId || record.deletedAt) return null;
    return record as Supplier & { id: string; tenantId: string };
  }

  protected async findByCode(code: string, tenantId: string) {
    for (const record of this.store.values()) {
      if (record.code === code && record.tenantId === tenantId && !record.deletedAt) {
        return record as Supplier & { id: string; tenantId: string };
      }
    }
    return null;
  }

  protected async findMany(query: MasterDataQuery) {
    let records = Array.from(this.store.values())
      .filter(r => r.tenantId === query.tenantId);

    if (!query.includeDeleted) {
      records = records.filter(r => !r.deletedAt);
    }

    if (query.status) {
      records = records.filter(r => r.status === query.status);
    }

    if (query.search) {
      const s = query.search.toLowerCase();
      records = records.filter(r =>
        r.name.toLowerCase().includes(s) ||
        r.code.toLowerCase().includes(s) ||
        (r.email && r.email.toLowerCase().includes(s))
      );
    }

    const total = records.length;
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const start = (page - 1) * pageSize;

    // Sort
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';
    records.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortBy];
      const bv = (b as Record<string, unknown>)[sortBy];
      if (av === bv) return 0;
      const cmp = av! > bv! ? 1 : -1;
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    return { data: records.slice(start, start + pageSize) as (Supplier & { id: string; tenantId: string })[], total };
  }

  protected async createRecord(data: any, tenantId: string) {
    const existing = await this.findByCode(data.code, tenantId);
    if (existing) {
      throw new MasterDataError(`Supplier code already exists: ${data.code}`, 'DUPLICATE_CODE', 409);
    }

    const id = `sup_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const record: Supplier = {
      id,
      code: data.code,
      name: data.name,
      email: data.email,
      phone: data.phone,
      taxCode: data.taxCode,
      bankAccount: data.bankAccount,
      bankName: data.bankName,
      address: data.address,
      contactPerson: data.contactPerson,
      paymentTermDays: data.paymentTermDays || 30,
      rating: data.rating,
      tenantId,
      status: 'active',
      createdBy: data.createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    this.store.set(id, record);
    return record as Supplier & { id: string; tenantId: string };
  }

  protected async updateRecord(id: string, data: Partial<any>, tenantId: string) {
    const existing = this.store.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new MasterDataError(`Supplier not found: ${id}`, 'NOT_FOUND', 404);
    }

    const updated: Supplier = {
      ...existing,
      ...data,
      id, // Preserve ID
      tenantId, // Preserve tenantId
      updatedAt: new Date(),
    };

    this.store.set(id, updated);
    return updated as Supplier & { id: string; tenantId: string };
  }

  protected async softDeleteRecord(id: string, tenantId: string) {
    const existing = this.store.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new MasterDataError(`Supplier not found: ${id}`, 'NOT_FOUND', 404);
    }

    existing.deletedAt = new Date();
    existing.status = 'inactive';
    existing.updatedAt = new Date();
    return existing as Supplier & { id: string; tenantId: string };
  }

  protected async restoreRecord(id: string, tenantId: string) {
    const existing = this.store.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new MasterDataError(`Supplier not found: ${id}`, 'NOT_FOUND', 404);
    }

    existing.deletedAt = null;
    existing.status = 'active';
    existing.updatedAt = new Date();
    return existing as Supplier & { id: string; tenantId: string };
  }

  // ==================== Supplier-specific ====================

  async findByTaxCode(taxCode: string, tenantId: string) {
    for (const record of this.store.values()) {
      if (record.taxCode === taxCode && record.tenantId === tenantId && !record.deletedAt) {
        return record;
      }
    }
    return null;
  }

  async getStats(tenantId: string) {
    const records = Array.from(this.store.values())
      .filter(r => r.tenantId === tenantId && !r.deletedAt);

    return {
      total: records.length,
      active: records.filter(r => r.status === 'active').length,
      inactive: records.filter(r => r.status === 'inactive').length,
      averageRating: records.reduce((sum, r) => sum + (r.rating || 0), 0) / (records.length || 1),
    };
  }
}

export const supplierService = new SupplierService();
