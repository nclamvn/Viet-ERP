// =============================================================================
// VietERP MRP - QUERY OPTIMIZATION UTILITIES
// Prisma query patterns for optimal performance
// =============================================================================

import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";

// =============================================================================
// TYPES
// =============================================================================

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export interface SortOptions {
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export interface QueryOptions extends PaginationOptions, SortOptions {
  select?: string[];
  include?: string[];
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

// =============================================================================
// PAGINATION HELPERS
// =============================================================================

/**
 * Calculate pagination parameters
 */
export function getPaginationParams(options: PaginationOptions) {
  const { page, pageSize } = options;
  const skip = (page - 1) * pageSize;
  const take = pageSize;

  return { skip, take };
}

/**
 * Create paginated response
 */
export function createPaginatedResult<T>(
  items: T[],
  total: number,
  options: PaginationOptions,
): PaginatedResult<T> {
  const { page, pageSize } = options;
  const totalPages = Math.ceil(total / pageSize);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}

// =============================================================================
// SELECT FIELD OPTIMIZATION
// =============================================================================

/**
 * Build optimized select clause
 * Only select needed fields to reduce data transfer
 */
export function buildSelect<T extends string>(
  fields: T[],
  allowedFields: T[],
): Record<T, true> | undefined {
  if (!fields || fields.length === 0) {
    return undefined;
  }

  const select: Record<string, true> = {};

  for (const field of fields) {
    if (allowedFields.includes(field)) {
      select[field] = true;
    }
  }

  return Object.keys(select).length > 0
    ? (select as Record<T, true>)
    : undefined;
}

/**
 * Default select fields for common models
 */
export const DEFAULT_SELECTS = {
  part: {
    list: {
      id: true,
      partNumber: true,
      name: true,
      category: true,
      unit: true,
      isActive: true,
      updatedAt: true,
    },
    detail: {
      id: true,
      partNumber: true,
      name: true,
      description: true,
      category: true,
      subCategory: true,
      partType: true,
      unit: true,
      ndaaCompliant: true,
      itarControlled: true,
      rohsCompliant: true,
      reachCompliant: true,
      countryOfOrigin: true,
      hsCode: true,
      eccn: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  },

  workOrder: {
    list: {
      id: true,
      orderNumber: true,
      status: true,
      priority: true,
      quantity: true,
      startDate: true,
      dueDate: true,
      part: {
        select: {
          id: true,
          partNumber: true,
          name: true,
        },
      },
    },
    detail: true, // Full detail
  },

  inventory: {
    list: {
      id: true,
      quantity: true,
      reservedQuantity: true,
      availableQuantity: true,
      part: {
        select: {
          id: true,
          partNumber: true,
          name: true,
          unit: true,
        },
      },
      warehouse: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
  },
};

// =============================================================================
// QUERY BATCHING
// =============================================================================

/**
 * Batch multiple queries into single transaction
 * Reduces database round trips
 */
export async function batchQueries<T extends Prisma.PrismaPromise<unknown>[]>(
  queries: [...T],
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  return prisma.$transaction(queries) as Promise<{
    [K in keyof T]: Awaited<T[K]>;
  }>;
}

/**
 * Batch loader for N+1 prevention
 * Groups multiple IDs into single query
 */
export class BatchLoader<T> {
  private batchMap = new Map<string, Promise<Map<string, T>>>();
  private batchTimeout = 10; // ms

  constructor(
    private loadFn: (ids: string[]) => Promise<T[]>,
    private getKey: (item: T) => string,
  ) {}

  async load(id: string): Promise<T | null> {
    const batchKey = Math.floor(Date.now() / this.batchTimeout).toString();

    if (!this.batchMap.has(batchKey)) {
      const pendingIds: string[] = [];

      const promise = new Promise<Map<string, T>>((resolve) => {
        setTimeout(async () => {
          const items = await this.loadFn(pendingIds);
          const map = new Map<string, T>();

          for (const item of items) {
            map.set(this.getKey(item), item);
          }

          resolve(map);
          this.batchMap.delete(batchKey);
        }, this.batchTimeout);
      });

      this.batchMap.set(batchKey, promise);
    }

    const map = await this.batchMap.get(batchKey)!;
    return map.get(id) || null;
  }

  async loadMany(ids: string[]): Promise<(T | null)[]> {
    return Promise.all(ids.map((id) => this.load(id)));
  }
}

// =============================================================================
// CURSOR-BASED PAGINATION
// =============================================================================

/**
 * Cursor-based pagination for large datasets
 * More efficient than offset pagination
 */
export interface CursorPaginationOptions {
  cursor?: string;
  take: number;
  direction?: "forward" | "backward";
}

export interface CursorPaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  previousCursor: string | null;
  hasMore: boolean;
}

export function buildCursorPagination(
  options: CursorPaginationOptions,
  cursorField: string = "id",
) {
  const { cursor, take, direction = "forward" } = options;

  return {
    take: direction === "forward" ? take + 1 : -(take + 1),
    ...(cursor && {
      cursor: { [cursorField]: cursor },
      skip: 1,
    }),
  };
}

export function processCursorResult<T extends { id: string }>(
  items: T[],
  take: number,
  direction: "forward" | "backward" = "forward",
): CursorPaginatedResult<T> {
  const hasMore = items.length > take;
  const resultItems = hasMore ? items.slice(0, take) : items;

  if (direction === "backward") {
    resultItems.reverse();
  }

  return {
    items: resultItems,
    nextCursor:
      resultItems.length > 0 ? resultItems[resultItems.length - 1].id : null,
    previousCursor: resultItems.length > 0 ? resultItems[0].id : null,
    hasMore,
  };
}

// =============================================================================
// SEARCH OPTIMIZATION
// =============================================================================

/**
 * Build optimized search conditions
 * Uses index-friendly patterns
 */
export function buildSearchConditions(
  search: string | undefined,
  fields: string[],
): { OR: Record<string, unknown>[] } | undefined {
  if (!search || search.trim().length === 0) {
    return undefined;
  }

  const searchTerm = search.trim();

  // For short searches, use startsWith (index-friendly)
  // For longer searches, use contains
  const mode = searchTerm.length <= 3 ? "startsWith" : "contains";

  return {
    OR: fields.map((field) => ({
      [field]: {
        [mode]: searchTerm,
        mode: "insensitive",
      },
    })),
  };
}

/**
 * PostgreSQL full-text search
 * Much faster for large datasets
 */
export function buildFullTextSearch(
  search: string | undefined,
  field: string = "searchVector",
) {
  if (!search || search.trim().length === 0) {
    return undefined;
  }

  // Convert to tsquery format
  const tsQuery = search
    .trim()
    .split(/\s+/)
    .map((word) => `${word}:*`)
    .join(" & ");

  return {
    [field]: {
      search: tsQuery,
    },
  };
}

// =============================================================================
// AGGREGATION HELPERS
// =============================================================================

/**
 * Efficient count with filters
 */
export async function countWithFilters(
  model: { count: (...args: never[]) => Promise<number> },
  where: Record<string, unknown>,
): Promise<number> {
  const countFn = model.count as (args: {
    where: Record<string, unknown>;
  }) => Promise<number>;
  return countFn({ where });
}

/**
 * Parallel count and data fetch
 * Single round trip to database
 */
/**
 * Parallel count and data fetch.
 * Single round trip to database.
 *
 * The `model` parameter accepts a Prisma delegate (e.g. `prisma.part`).
 * Because Prisma delegate signatures are very specific, we use a loose
 * interface that is structurally compatible at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma delegates have complex generic signatures
export async function findManyWithCount<T = Record<string, unknown>>(
  model: {
    findMany: (...args: never[]) => Prisma.PrismaPromise<unknown[]>;
    count: (...args: never[]) => Prisma.PrismaPromise<number>;
  },
  args: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
    include?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    skip?: number;
    take?: number;
  },
): Promise<{ items: T[]; total: number }> {
  const findManyFn = model.findMany as (
    args: Record<string, unknown>,
  ) => Prisma.PrismaPromise<unknown[]>;
  const countFn = model.count as (
    args: Record<string, unknown>,
  ) => Prisma.PrismaPromise<number>;

  const [items, total] = await prisma.$transaction([
    findManyFn(args),
    countFn({ where: args.where }),
  ]);

  return { items: items as T[], total };
}

/**
 * Aggregation query builder
 */
export function buildAggregation(
  groupBy: string[],
  aggregations: {
    _count?: boolean | { [field: string]: boolean };
    _sum?: { [field: string]: boolean };
    _avg?: { [field: string]: boolean };
    _min?: { [field: string]: boolean };
    _max?: { [field: string]: boolean };
  },
) {
  return {
    by: groupBy,
    ...aggregations,
  };
}

// =============================================================================
// QUERY HINTS & OPTIMIZATION
// =============================================================================

/**
 * Add query timeout
 */
export function withTimeout<T>(
  query: Promise<T>,
  timeoutMs: number = 30000,
): Promise<T> {
  return Promise.race([
    query,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Query timeout")), timeoutMs),
    ),
  ]);
}

/**
 * Chunk large operations
 */
export async function chunkOperation<T, R>(
  items: T[],
  chunkSize: number,
  operation: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await operation(chunk);
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Bulk upsert with conflict handling
 */
export async function bulkUpsert<
  T extends Record<string, unknown> & { id?: string },
>(
  model: {
    upsert: (args: {
      where: Record<string, unknown>;
      create: T;
      update: T;
    }) => Prisma.PrismaPromise<unknown>;
  },
  data: T[],
  uniqueField: string,
): Promise<number> {
  await prisma.$transaction(
    data.map((item) =>
      model.upsert({
        where: { [uniqueField]: item[uniqueField] },
        create: item,
        update: item,
      }),
    ),
  );

  return data.length;
}

// =============================================================================
// EXPORT
// =============================================================================

export default {
  getPaginationParams,
  createPaginatedResult,
  buildSelect,
  DEFAULT_SELECTS,
  batchQueries,
  BatchLoader,
  buildCursorPagination,
  processCursorResult,
  buildSearchConditions,
  buildFullTextSearch,
  countWithFilters,
  findManyWithCount,
  buildAggregation,
  withTimeout,
  chunkOperation,
  bulkUpsert,
};
