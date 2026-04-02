// src/lib/db/query-optimizer.ts
// Database query optimization utilities

import prisma from "@/lib/db";
import { Prisma } from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// PAGINATION UTILITIES
// ═══════════════════════════════════════════════════════════════

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export function getPaginationParams(params: PaginationParams) {
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

export async function paginatedQuery<T>(
  query: () => Promise<T[]>,
  countQuery: () => Promise<number>,
  params: PaginationParams,
): Promise<PaginatedResult<T>> {
  const { page, limit } = getPaginationParams(params);

  const [data, total] = await Promise.all([query(), countQuery()]);

  const totalPages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// SELECT OPTIMIZATION (only fetch needed fields)
// ═══════════════════════════════════════════════════════════════

// Common select patterns for frequently used models
export const employeeSelectMinimal = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  avatarUrl: true,
} as const;

export const employeeSelectWithDepartment = {
  ...employeeSelectMinimal,
  department: {
    select: {
      id: true,
      name: true,
    },
  },
  position: {
    select: {
      id: true,
      title: true,
    },
  },
} as const;

export const employeeSelectFull = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  gender: true,
  avatarUrl: true,
  hireDate: true,
  status: true,
  department: true,
  position: true,
  manager: {
    select: employeeSelectMinimal,
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════

export async function batchQuery<T, R>(
  items: T[],
  batchSize: number,
  queryFn: (batch: T[]) => Promise<R[]>,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await queryFn(batch);
    results.push(...batchResults);
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// QUERY HELPERS
// ═══════════════════════════════════════════════════════════════

export function buildSearchFilter(
  searchTerm: string | undefined,
  fields: string[],
): Prisma.EmployeeWhereInput | undefined {
  if (!searchTerm?.trim()) return undefined;

  const term = searchTerm.trim();

  return {
    OR: fields.map((field) => ({
      [field]: {
        contains: term,
        mode: "insensitive" as Prisma.QueryMode,
      },
    })),
  };
}

export function buildDateRangeFilter(
  field: string,
  startDate?: Date,
  endDate?: Date,
): Record<string, { gte?: Date; lte?: Date }> | undefined {
  if (!startDate && !endDate) return undefined;

  const filter: { gte?: Date; lte?: Date } = {};
  if (startDate) filter.gte = startDate;
  if (endDate) filter.lte = endDate;

  return { [field]: filter };
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATION HELPERS
// ═══════════════════════════════════════════════════════════════

export async function getEmployeeStats(departmentId?: string) {
  const where = departmentId ? { departmentId } : {};

  const [total, active, onLeave] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.count({
      where: { ...where, status: "ACTIVE" },
    }),
    prisma.employee.count({
      where: { ...where, status: "ON_LEAVE" },
    }),
  ]);

  return { total, active, onLeave, inactive: total - active - onLeave };
}

export async function getDepartmentStats() {
  const departments = await prisma.department.findMany({
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          employees: true,
        },
      },
    },
  });

  return departments.map(
    (dept: { id: string; name: string; _count: { employees: number } }) => ({
      id: dept.id,
      name: dept.name,
      employeeCount: dept._count.employees,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════
// TRANSACTION WRAPPER
// ═══════════════════════════════════════════════════════════════

export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  return prisma.$transaction(fn, {
    maxWait: options?.maxWait ?? 5000,
    timeout: options?.timeout ?? 10000,
  });
}
