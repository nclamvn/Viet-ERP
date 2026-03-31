// ============================================================
// @vierp/master-data - Employee Service
// CRUD + sync for Employee master data
// ============================================================

import { prisma } from '@vierp/database';
import type { Employee } from '@vierp/shared';
import type { MasterDataQuery, MasterDataEntity } from '../types';
import { BaseMasterDataService, MasterDataError } from './base.service';

export class EmployeeService extends BaseMasterDataService<Employee & { id: string; tenantId: string }> {
  protected entityName: MasterDataEntity = 'employee';

  protected async findById(id: string, tenantId: string) {
    const record = await prisma.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    return record ? this.mapToType(record) : null;
  }

  protected async findByCode(code: string, tenantId: string) {
    const record = await prisma.employee.findFirst({
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
        { department: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.category) {
      // category maps to department for employees
      where.department = { contains: query.category, mode: 'insensitive' };
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
      prisma.employee.findMany({
        where: where as any,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
      }),
      prisma.employee.count({ where: where as any }),
    ]);

    return { data: data.map(this.mapToType), total };
  }

  protected async createRecord(data: any, tenantId: string) {
    const existing = await prisma.employee.findFirst({
      where: { code: data.code, tenantId },
    });
    if (existing) {
      throw new MasterDataError(`Employee code already exists: ${data.code}`, 'DUPLICATE_CODE', 409);
    }

    const record = await prisma.employee.create({
      data: {
        code: data.code,
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        department: data.department || null,
        position: data.position || null,
        hireDate: data.hireDate ? new Date(data.hireDate) : new Date(),
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
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.position !== undefined) updateData.position = data.position;
    if (data.status !== undefined) updateData.status = data.status.toUpperCase();
    if (data.hireDate !== undefined) updateData.hireDate = new Date(data.hireDate);

    const record = await prisma.employee.update({
      where: { id },
      data: updateData as any,
    });

    return this.mapToType(record);
  }

  protected async softDeleteRecord(id: string, tenantId: string) {
    const record = await prisma.employee.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'TERMINATED' as any },
    });
    return this.mapToType(record);
  }

  protected async restoreRecord(id: string, tenantId: string) {
    const record = await prisma.employee.update({
      where: { id },
      data: { deletedAt: null, status: 'ACTIVE' as any },
    });
    return this.mapToType(record);
  }

  // ==================== Employee-specific methods ====================

  async findByDepartment(department: string, tenantId: string) {
    const records = await prisma.employee.findMany({
      where: { department, tenantId, deletedAt: null, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
    return records.map(this.mapToType);
  }

  async findByEmail(email: string, tenantId: string) {
    const record = await prisma.employee.findFirst({
      where: { email, tenantId, deletedAt: null },
    });
    return record ? this.mapToType(record) : null;
  }

  async getDepartments(tenantId: string): Promise<string[]> {
    const result = await prisma.employee.findMany({
      where: { tenantId, deletedAt: null, department: { not: null } },
      select: { department: true },
      distinct: ['department'],
      orderBy: { department: 'asc' },
    });
    return result.map(r => r.department).filter(Boolean) as string[];
  }

  async getStats(tenantId: string) {
    const [total, active, terminated] = await Promise.all([
      prisma.employee.count({ where: { tenantId, deletedAt: null } }),
      prisma.employee.count({ where: { tenantId, status: 'ACTIVE', deletedAt: null } }),
      prisma.employee.count({ where: { tenantId, status: 'TERMINATED', deletedAt: null } }),
    ]);
    return { total, active, terminated };
  }

  // ==================== Mapping ====================

  private mapToType(record: any): Employee & { id: string; tenantId: string } {
    return {
      id: record.id,
      code: record.code,
      name: record.name,
      email: record.email,
      phone: record.phone || undefined,
      department: record.department || undefined,
      position: record.position || undefined,
      hireDate: record.hireDate,
      status: record.status?.toLowerCase() === 'active'
        ? 'active'
        : record.status?.toLowerCase() === 'terminated'
        ? 'terminated'
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

export const employeeService = new EmployeeService();
