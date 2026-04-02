// src/lib/prisma.ts
// Optimized Prisma client with connection pooling and performance settings

import "@/lib/env";
import { PrismaClient } from ".prisma/mrp-client";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Note: Connection pooling is configured via DATABASE_URL connection string
// Example: postgresql://user:pass@host/db?connection_limit=10&pool_timeout=10

// Create optimized Prisma client
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    // Logging configuration
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

// Initialize client
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Query performance logging (development only)
if (process.env.NODE_ENV === "development") {
  // @ts-expect-error - Prisma event typing
  prisma.$on("query", (e: { query: string; duration: number }) => {
    if (e.duration > 100) {
      logger.warn(
        `[Prisma] Slow query (${e.duration}ms): ${e.query.substring(0, 200)}`,
      );
    }
  });
}

// Graceful shutdown
async function disconnect() {
  await prisma.$disconnect();
}

process.on("beforeExit", disconnect);
process.on("SIGINT", disconnect);
process.on("SIGTERM", disconnect);

// Prevent multiple instances in development
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;

// ============================================
// QUERY OPTIMIZATION UTILITIES
// ============================================

/**
 * Select only required fields to reduce data transfer
 */
export const selectMinimal = {
  id: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Common pagination options
 */
export function paginate(page: number = 1, pageSize: number = 50) {
  return {
    skip: (page - 1) * pageSize,
    take: Math.min(pageSize, 100), // Max 100 items per page
  };
}

/**
 * Cursor-based pagination (more efficient for large datasets)
 */
export function cursorPaginate(cursor?: string, pageSize: number = 50) {
  return {
    take: Math.min(pageSize, 100),
    ...(cursor && {
      skip: 1,
      cursor: { id: cursor },
    }),
  };
}

/**
 * Execute query with timeout
 */
export async function queryWithTimeout<T>(
  queryFn: () => Promise<T>,
  timeoutMs: number = 30000,
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Query timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  return Promise.race([queryFn(), timeoutPromise]);
}

/**
 * Batch operations for bulk updates
 */
export async function batchUpdate<T>(
  items: T[],
  updateFn: (item: T) => Promise<void>,
  batchSize: number = 100,
): Promise<{ success: number; errors: number }> {
  let success = 0;
  let errors = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (item) => {
        try {
          await updateFn(item);
          success++;
        } catch {
          errors++;
        }
      }),
    );
  }

  return { success, errors };
}
