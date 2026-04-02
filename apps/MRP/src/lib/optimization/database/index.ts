// =============================================================================
// VietERP MRP - DATABASE OPTIMIZATION MODULE
// Production-ready database utilities for high-volume data
// =============================================================================

import { PrismaClient, Prisma } from ".prisma/mrp-client";
import { logger } from "@/lib/logger";

// Re-export the existing Prisma instance from the project
import { prisma } from "@/lib/prisma";
export { prisma };

// =============================================================================
// PRISMA MODEL DELEGATE INTERFACES
// =============================================================================

/** Represents a Prisma model delegate with createMany capability */
interface PrismaCreateManyDelegate {
  createMany(args: {
    data: Record<string, unknown>[];
    skipDuplicates?: boolean;
  }): Prisma.PrismaPromise<{ count: number }>;
}

/** Represents a Prisma model delegate with update capability */
interface PrismaUpdateDelegate {
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Prisma.PrismaPromise<unknown>;
}

/** Represents a Prisma model delegate with deleteMany capability */
interface PrismaDeleteManyDelegate {
  deleteMany(args: {
    where: { id: { in: string[] } };
  }): Prisma.PrismaPromise<{ count: number }>;
}

/** Represents a Prisma model delegate with findMany capability */
interface PrismaFindManyDelegate {
  findMany(args: Record<string, unknown>): Prisma.PrismaPromise<unknown[]>;
}

/** Represents a Prisma model delegate with findMany and count capability */
interface PrismaFindManyWithCountDelegate {
  findMany(args: Record<string, unknown>): Prisma.PrismaPromise<unknown[]>;
  count(args: { where: Record<string, unknown> }): Prisma.PrismaPromise<number>;
}

// =============================================================================
// BATCH OPERATIONS FOR LARGE DATASETS
// =============================================================================

export interface BatchOptions {
  batchSize?: number;
  onProgress?: (processed: number, total: number) => void;
  onError?: (error: Error, item: unknown) => void;
  continueOnError?: boolean;
}

/**
 * Process large datasets in batches to prevent memory issues
 */
export async function batchProcess<T, R>(
  items: T[],
  processor: (batch: T[]) => Promise<R[]>,
  options: BatchOptions = {},
): Promise<{ results: R[]; errors: Array<{ item: T; error: Error }> }> {
  const {
    batchSize = 100,
    onProgress,
    onError,
    continueOnError = true,
  } = options;

  const results: R[] = [];
  const errors: Array<{ item: T; error: Error }> = [];
  const total = items.length;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    try {
      const batchResults = await processor(batch);
      results.push(...batchResults);
    } catch (error) {
      if (continueOnError) {
        batch.forEach((item) => {
          errors.push({ item, error: error as Error });
          onError?.(error as Error, item);
        });
      } else {
        throw error;
      }
    }

    onProgress?.(Math.min(i + batchSize, total), total);
  }

  return { results, errors };
}

/**
 * Batch create with conflict handling
 */
export async function batchCreate<T extends Record<string, unknown>>(
  model: PrismaCreateManyDelegate,
  data: T[],
  options: BatchOptions & { skipDuplicates?: boolean } = {},
): Promise<{ created: number; skipped: number; errors: number }> {
  const { batchSize = 100, skipDuplicates = true } = options;

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    try {
      const result = await model.createMany({
        data: batch,
        skipDuplicates,
      });
      created += result.count;
      skipped += batch.length - result.count;
    } catch (error) {
      errors += batch.length;
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        {
          context: "database-optimization",
          operation: "batchCreate",
          index: i,
        },
      );
    }

    options.onProgress?.(Math.min(i + batchSize, data.length), data.length);
  }

  return { created, skipped, errors };
}

/**
 * Batch update with transactions
 */
export async function batchUpdate<
  T extends { id: string; [key: string]: unknown },
>(
  model: PrismaUpdateDelegate,
  updates: T[],
  options: BatchOptions = {},
): Promise<{ updated: number; errors: number }> {
  const { batchSize = 50 } = options;

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);

    try {
      await prisma.$transaction(
        batch.map((item) => {
          const { id, ...data } = item;
          return model.update({ where: { id }, data });
        }),
      );
      updated += batch.length;
    } catch (error) {
      errors += batch.length;
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        {
          context: "database-optimization",
          operation: "batchUpdate",
          index: i,
        },
      );
    }

    options.onProgress?.(
      Math.min(i + batchSize, updates.length),
      updates.length,
    );
  }

  return { updated, errors };
}

/**
 * Batch delete with safety checks
 */
export async function batchDelete(
  model: PrismaDeleteManyDelegate,
  ids: string[],
  options: BatchOptions = {},
): Promise<{ deleted: number; errors: number }> {
  const { batchSize = 100 } = options;

  let deleted = 0;
  let errors = 0;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);

    try {
      const result = await model.deleteMany({
        where: { id: { in: batch } },
      });
      deleted += result.count;
    } catch (error) {
      errors += batch.length;
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        {
          context: "database-optimization",
          operation: "batchDelete",
          index: i,
        },
      );
    }

    options.onProgress?.(Math.min(i + batchSize, ids.length), ids.length);
  }

  return { deleted, errors };
}

// =============================================================================
// CURSOR-BASED PAGINATION FOR LARGE DATASETS
// =============================================================================

export interface CursorPaginationOptions {
  cursor?: string;
  take?: number;
  orderBy?: Record<string, "asc" | "desc">;
}

export interface CursorPaginationResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

/**
 * Efficient cursor-based pagination for large tables
 */
export async function cursorPaginate<T extends { id: string }>(
  model: PrismaFindManyDelegate,
  where: Record<string, unknown> = {},
  options: CursorPaginationOptions = {},
): Promise<CursorPaginationResult<T>> {
  const { cursor, take = 20, orderBy = { createdAt: "desc" } } = options;

  const queryOptions: Record<string, unknown> = {
    where,
    take: take + 1, // Fetch one extra to check if there's more
    orderBy,
  };

  if (cursor) {
    queryOptions.cursor = { id: cursor };
    queryOptions.skip = 1; // Skip the cursor item
  }

  const items = (await model.findMany(queryOptions)) as T[];
  const hasMore = items.length > take;
  const data = hasMore ? items.slice(0, -1) : items;
  const nextCursor = hasMore ? data[data.length - 1]?.id : null;

  return { data, nextCursor, hasMore };
}

// =============================================================================
// STREAMING FOR VERY LARGE DATASETS
// =============================================================================

export interface StreamOptions {
  batchSize?: number;
  where?: Record<string, unknown>;
  orderBy?: Record<string, "asc" | "desc">;
  select?: Record<string, boolean>;
}

/**
 * Stream large datasets without loading everything into memory
 */
export async function* streamRecords<T extends { id: string }>(
  model: PrismaFindManyDelegate,
  options: StreamOptions = {},
): AsyncGenerator<T[], void, unknown> {
  const {
    batchSize = 1000,
    where = {},
    orderBy = { id: "asc" },
    select,
  } = options;
  let cursor: string | undefined;

  while (true) {
    const queryOptions: Record<string, unknown> = {
      where,
      take: batchSize,
      orderBy,
      ...(select && { select }),
    };

    if (cursor) {
      queryOptions.cursor = { id: cursor };
      queryOptions.skip = 1;
    }

    const batch = (await model.findMany(queryOptions)) as T[];

    if (batch.length === 0) break;

    yield batch;

    if (batch.length < batchSize) break;

    cursor = batch[batch.length - 1].id;
  }
}

/**
 * Export large dataset to file using streaming
 */
export async function exportToStream(
  model: PrismaFindManyDelegate,
  writeStream: NodeJS.WritableStream,
  options: StreamOptions & {
    transform?: (item: Record<string, unknown>) => string;
  } = {},
): Promise<{ count: number }> {
  const { transform = JSON.stringify } = options;
  let count = 0;

  for await (const batch of streamRecords(model, options)) {
    for (const item of batch) {
      writeStream.write(transform(item) + "\n");
      count++;
    }
  }

  writeStream.end();
  return { count };
}

// =============================================================================
// QUERY OPTIMIZATION HELPERS
// =============================================================================

/**
 * Build optimized select clause - only fetch needed fields
 */
export function buildSelect(fields: string[]): Record<string, boolean> {
  return fields.reduce(
    (acc, field) => {
      acc[field] = true;
      return acc;
    },
    {} as Record<string, boolean>,
  );
}

/**
 * Build search conditions optimized for indexes
 */
export function buildSearchConditions(
  search: string,
  fields: string[],
): Record<string, unknown> {
  if (!search || search.length < 2) return {};

  const searchTerm = search.trim();

  // Use startsWith for short searches (better index usage)
  // Use contains for longer searches (more relevant results)
  const mode = searchTerm.length <= 3 ? "startsWith" : "contains";

  return {
    OR: fields.map((field) => ({
      [field]: { [mode]: searchTerm, mode: "insensitive" },
    })),
  };
}

/**
 * Build date range filter
 */
export function buildDateRange(
  field: string,
  from?: Date | string,
  to?: Date | string,
): Record<string, unknown> {
  const conditions: Record<string, Date> = {};

  if (from) {
    conditions.gte = new Date(from);
  }
  if (to) {
    conditions.lte = new Date(to);
  }

  return Object.keys(conditions).length > 0 ? { [field]: conditions } : {};
}

/**
 * Parallel count and data fetch
 */
export async function findManyWithCount<T>(
  model: PrismaFindManyWithCountDelegate,
  options: {
    where?: Record<string, unknown>;
    select?: Record<string, boolean>;
    include?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc">;
    skip?: number;
    take?: number;
  },
): Promise<{ data: T[]; total: number }> {
  const { where = {}, ...rest } = options;

  const [data, total] = await prisma.$transaction([
    model.findMany({ where, ...rest }),
    model.count({ where }),
  ]);

  return { data: data as T[], total: total as number };
}

// =============================================================================
// CONNECTION HEALTH & CLEANUP
// =============================================================================

/**
 * Check database connection health
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latency: number;
  error?: string;
}> {
  const start = performance.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      healthy: true,
      latency: performance.now() - start,
    };
  } catch (error) {
    return {
      healthy: false,
      latency: performance.now() - start,
      error: (error as Error).message,
    };
  }
}

/**
 * Graceful shutdown
 */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Reconnect on connection loss
 */
export async function reconnectDatabase(): Promise<boolean> {
  try {
    await prisma.$disconnect();
    await prisma.$connect();
    return true;
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "database-optimization",
      operation: "reconnectDatabase",
    });
    return false;
  }
}

// =============================================================================
// TRANSACTION HELPERS
// =============================================================================

export type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Execute with automatic retry on deadlock
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries?: number; delay?: number } = {},
): Promise<T> {
  const { maxRetries = 3, delay = 100 } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check for deadlock or serialization failure
      const prismaErr = error as { code?: string; message?: string };
      const isRetryable =
        prismaErr.code === "P2034" || // Transaction failed due to serialization failure
        prismaErr.code === "40001" || // Serialization failure (PostgreSQL)
        prismaErr.message?.includes("deadlock");

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }

  throw lastError;
}

/**
 * Safe transaction with timeout
 */
export async function safeTransaction<T>(
  operations: (tx: TransactionClient) => Promise<T>,
  options: { timeout?: number; maxWait?: number } = {},
): Promise<T> {
  const { timeout = 10000, maxWait = 5000 } = options;

  return prisma.$transaction(operations, {
    timeout,
    maxWait,
  });
}

// =============================================================================
// BULK UPSERT
// =============================================================================

/**
 * Efficient bulk upsert using parameterized SQL for PostgreSQL
 * Uses $1, $2, ... placeholders to prevent SQL injection
 */
export async function bulkUpsert<T extends Record<string, unknown>>(
  tableName: string,
  data: T[],
  uniqueFields: string[],
  updateFields: string[],
): Promise<{ affected: number }> {
  if (data.length === 0) return { affected: 0 };

  // Validate table and field names (allow only alphanumeric + underscore)
  const validName = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (!validName.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }

  const fields = Object.keys(data[0]);
  for (const field of [...fields, ...uniqueFields, ...updateFields]) {
    if (!validName.test(field)) {
      throw new Error(`Invalid field name: ${field}`);
    }
  }

  // Build parameterized values
  const params: unknown[] = [];
  const valuePlaceholders = data
    .map((item) => {
      const placeholders = fields.map((f) => {
        params.push(item[f] ?? null);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    })
    .join(",\n");

  const conflictFields = uniqueFields.map((f) => `"${f}"`).join(", ");
  const updateClause = updateFields
    .map((f) => `"${f}" = EXCLUDED."${f}"`)
    .join(", ");

  const sql = `
    INSERT INTO "${tableName}" (${fields.map((f) => `"${f}"`).join(", ")})
    VALUES ${valuePlaceholders}
    ON CONFLICT (${conflictFields}) DO UPDATE SET
    ${updateClause},
    "updatedAt" = NOW()
  `;

  const result = await prisma.$executeRawUnsafe(sql, ...params);
  return { affected: result };
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  prisma,
  batchProcess,
  batchCreate,
  batchUpdate,
  batchDelete,
  cursorPaginate,
  streamRecords,
  exportToStream,
  buildSelect,
  buildSearchConditions,
  buildDateRange,
  findManyWithCount,
  checkDatabaseHealth,
  disconnectDatabase,
  reconnectDatabase,
  executeWithRetry,
  safeTransaction,
  bulkUpsert,
};
