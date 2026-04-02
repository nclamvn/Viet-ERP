// =============================================================================
// VietERP MRP - OPTIMIZED PARTS API
// Example demonstrating all performance optimizations
// /api/v2/parts-optimized/route.ts
// =============================================================================

import { NextRequest } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/api/with-auth";

// Performance imports
import {
  cacheAside,
  CacheKeys,
  CACHE_TTL,
  filtersToKey,
  invalidateTenantCache,
} from "@/lib/performance/cache";

import {
  getPaginationParams,
  createPaginatedResult,
  findManyWithCount,
  buildSearchConditions,
  DEFAULT_SELECTS,
} from "@/lib/performance/query-optimizer";

import {
  optimizedResponse,
  paginatedResponse,
  CachePresets,
  omitEmpty,
} from "@/lib/performance/response-optimizer";

import { measureTime, queryProfiler } from "@/lib/performance/profiler";

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  category: z.string().max(50).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  sortBy: z
    .enum(["partNumber", "name", "category", "updatedAt"])
    .default("partNumber"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
  fields: z.string().optional(), // Sparse fieldsets: ?fields=id,partNumber,name
});

// =============================================================================
// GET - LIST PARTS (OPTIMIZED)
// =============================================================================

export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const startTime = performance.now();

  try {
    // Parse and validate query params
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));

    const {
      page,
      pageSize,
      search,
      category,
      isActive,
      sortBy,
      sortOrder,
      fields,
    } = params;

    // Get tenant ID (from auth context in production)
    const tenantId = request.headers.get("x-tenant-id") || "default";

    // Build cache key from filters
    const filterKey = filtersToKey({
      search,
      category,
      isActive,
      page,
      pageSize,
      sortBy,
      sortOrder,
    });
    const cacheKey = CacheKeys.partList(tenantId, filterKey);

    // Cache-aside pattern
    const result = await cacheAside(
      cacheKey,
      async () => {
        // Build where clause
        const where: Prisma.PartWhereInput = {};

        // Search optimization
        if (search) {
          const searchCondition = buildSearchConditions(search, [
            "partNumber",
            "name",
            "description",
          ]);
          if (searchCondition) {
            where.OR = searchCondition.OR as Prisma.PartWhereInput[];
          }
        }

        // Category filter (index-friendly)
        if (category) {
          where.category = category;
        }

        // Active filter (index-friendly) - Part uses status field
        if (isActive !== undefined) {
          where.status = isActive === "true" ? "active" : "inactive";
        }

        // Build select clause (sparse fieldsets)
        let select: Record<string, boolean> = DEFAULT_SELECTS.part.list;

        if (fields) {
          const requestedFields = fields.split(",").map((f) => f.trim());
          select = {};
          for (const field of requestedFields) {
            if (field in DEFAULT_SELECTS.part.detail) {
              select[field] = true;
            }
          }
          // Always include id
          select.id = true;
        }

        // Parallel count and data fetch
        const { items, total } = await findManyWithCount(prisma.part, {
          where,
          select,
          orderBy: { [sortBy]: sortOrder },
          ...getPaginationParams({ page, pageSize }),
        });

        return {
          items: items.map((item: Record<string, unknown>) => omitEmpty(item)),
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        };
      },
      { ttl: CACHE_TTL.MEDIUM, tags: [`tenant:${tenantId}:parts`] },
    );

    // Record profiling
    const duration = performance.now() - startTime;
    queryProfiler.record({
      query: "parts.list",
      model: "Part",
      operation: "findMany",
      duration,
      timestamp: new Date(),
      result: { rowCount: result.items.length, cached: duration < 10 },
    });

    // Return optimized response with caching headers
    return paginatedResponse(result, request, {
      cache: CachePresets.publicShort,
      etag: true,
    });
  } catch (error: unknown) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/v2/parts-optimized",
    });

    return optimizedResponse(
      { success: false, error: "Failed to fetch parts" },
      request,
      { status: 500, cache: CachePresets.noCache },
    );
  }
});

// =============================================================================
// POST - CREATE PART (WITH CACHE INVALIDATION)
// =============================================================================

export const POST = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await request.json();
    const tenantId = request.headers.get("x-tenant-id") || "default";

    // Create part
    const { result: part, duration } = await measureTime(
      () =>
        prisma.part.create({
          data: {
            ...body,
            ...(tenantId !== "default" && { tenantId }),
          },
          select: DEFAULT_SELECTS.part.detail,
        }),
      "parts.create",
    );

    // Invalidate tenant cache
    await invalidateTenantCache(tenantId);

    // Return response without caching (mutation)
    return optimizedResponse({ success: true, data: part }, request, {
      status: 201,
      cache: CachePresets.noCache,
    });
  } catch (error: unknown) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/v2/parts-optimized",
    });

    return optimizedResponse(
      { success: false, error: "Failed to create part" },
      request,
      { status: 500, cache: CachePresets.noCache },
    );
  }
});

// =============================================================================
// HELPER FUNCTIONS (Internal use only, not exported as route handlers)
// =============================================================================

async function _getPartById(id: string, request: NextRequest) {
  const tenantId = request.headers.get("x-tenant-id") || "default";
  const cacheKey = CacheKeys.part(id);

  const part = await cacheAside(
    cacheKey,
    async () => {
      return prisma.part.findUnique({
        where: { id },
        select: DEFAULT_SELECTS.part.detail,
      });
    },
    { ttl: CACHE_TTL.LONG },
  );

  if (!part) {
    return optimizedResponse(
      { success: false, error: "Part not found" },
      request,
      { status: 404, cache: CachePresets.noCache },
    );
  }

  return optimizedResponse({ success: true, data: part }, request, {
    cache: CachePresets.publicMedium,
    etag: true,
  });
}

async function _batchGetParts(ids: string[], request: NextRequest) {
  const tenantId = request.headers.get("x-tenant-id") || "default";

  // Use IN clause instead of multiple queries
  const parts = await prisma.part.findMany({
    where: {
      id: { in: ids },
    },
    select: DEFAULT_SELECTS.part.list,
  });

  // Create lookup map
  const partsMap = new Map(parts.map((p) => [p.id, p]));

  // Return in requested order
  const orderedParts = ids.map((id) => partsMap.get(id) || null);

  return optimizedResponse({ success: true, data: orderedParts }, request, {
    cache: CachePresets.publicShort,
  });
}

async function _getPartStats(request: NextRequest) {
  const tenantId = request.headers.get("x-tenant-id") || "default";
  const cacheKey = `tenant:${tenantId}:parts:stats`;

  const stats = await cacheAside(
    cacheKey,
    async () => {
      // Use groupBy for efficient aggregation
      const categoryStats = await prisma.part.groupBy({
        by: ["category"],
        _count: { id: true },
        where: {
          status: "active",
        },
      });

      const totalCount = await prisma.part.count();

      const activeCount = await prisma.part.count({
        where: {
          status: "active",
        },
      });

      return {
        total: totalCount,
        active: activeCount,
        inactive: totalCount - activeCount,
        byCategory: categoryStats.map((s) => ({
          category: s.category,
          count: s._count?.id ?? 0,
        })),
      };
    },
    { ttl: CACHE_TTL.MEDIUM },
  );

  return optimizedResponse({ success: true, data: stats }, request, {
    cache: CachePresets.publicShort,
  });
}
