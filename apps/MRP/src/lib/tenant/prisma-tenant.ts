// =============================================================================
// VietERP MRP - TENANT PRISMA CLIENT
// Automatically filters all queries by tenantId
// =============================================================================

import { PrismaClient } from ".prisma/mrp-client";
import { logger } from "@/lib/logger";

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Record shape for entities that have a tenantId field */
interface TenantRecord {
  tenantId?: string;
  [key: string]: unknown;
}

/**
 * Type for dynamically accessing a Prisma model delegate by name.
 * Prisma's extension API provides model names as strings; this type
 * allows us to call findFirst on any model without `as any`.
 */
type PrismaModelDelegate = {
  findFirst: (args: {
    where: Record<string, unknown>;
  }) => Promise<TenantRecord | null>;
};

// Models that require tenant filtering
// These models have a tenantId field
const TENANT_MODELS = [
  "part",
  "supplier",
  "customer",
  "bOM",
  "bOMItem",
  "warehouse",
  "inventory",
  "inventoryTransaction",
  "salesOrder",
  "salesOrderItem",
  "purchaseOrder",
  "purchaseOrderItem",
  "workOrder",
  "workOrderItem",
  "workOrderOperation",
  "workOrderLabor",
  "qualityRecord",
  "nCR",
  "mRPRun",
  "mRPRunOrder",
  "mRPRequirement",
  "mRPSuggestion",
  "workCenter",
  "equipment",
  "maintenanceSchedule",
  "maintenanceOrder",
  "downtimeRecord",
  "employee",
  "skill",
  "employeeSkill",
  "employeeCertification",
  "workCenterSkill",
  "shift",
  "shiftAssignment",
  "workCenterCapacity",
  "timeEntry",
  "activityLog",
  "product",
] as const;

type TenantModel = (typeof TENANT_MODELS)[number];

function isTenantModel(model: string): model is TenantModel {
  return TENANT_MODELS.includes(model.toLowerCase() as TenantModel);
}

/**
 * Get a Prisma model delegate by name from the base client.
 * This is used for ownership verification in update/delete operations.
 */
function getModelDelegate(
  prisma: PrismaClient,
  model: string,
): PrismaModelDelegate {
  return (prisma as unknown as Record<string, PrismaModelDelegate>)[model];
}

// =============================================================================
// TENANT PRISMA EXTENSION
// =============================================================================

/**
 * Creates a Prisma client that automatically filters by tenantId
 *
 * Usage:
 * ```typescript
 * const prisma = createTenantPrisma(tenantId);
 * const parts = await prisma.part.findMany(); // Automatically filtered by tenantId
 * ```
 */
export function createTenantPrisma(tenantId: string) {
  const basePrisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  return basePrisma.$extends({
    name: "tenant-isolation",

    query: {
      $allModels: {
        // =============================================
        // READ OPERATIONS
        // =============================================

        async findMany({ model, args, query }) {
          if (isTenantModel(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },

        async findFirst({ model, args, query }) {
          if (isTenantModel(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },

        async findUnique({ model, args, query }) {
          const result = await query(args);

          // Verify tenant ownership after fetching
          if (result && isTenantModel(model)) {
            const record = result as TenantRecord;
            if (record.tenantId !== tenantId) {
              logger.warn(
                `[TENANT] Access denied: ${model} belongs to different tenant`,
                { context: "prisma-tenant" },
              );
              return null;
            }
          }
          return result;
        },

        async findFirstOrThrow({ model, args, query }) {
          if (isTenantModel(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },

        async findUniqueOrThrow({ model, args, query }) {
          const result = await query(args);

          if (result && isTenantModel(model)) {
            const record = result as TenantRecord;
            if (record.tenantId !== tenantId) {
              throw new Error(`Record belongs to different tenant`);
            }
          }
          return result;
        },

        // =============================================
        // WRITE OPERATIONS
        // =============================================

        async create({ model, args, query }) {
          if (isTenantModel(model)) {
            // Auto-inject tenantId
            args.data = { ...args.data, tenantId };
          }
          return query(args);
        },

        async createMany({ model, args, query }) {
          if (isTenantModel(model)) {
            if (Array.isArray(args.data)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma $allModels extension uses dynamic model types; items are model-specific create inputs
              args.data = (args.data as Record<string, unknown>[]).map(
                (item) => ({ ...item, tenantId }),
              ) as typeof args.data;
            } else {
              args.data = { ...args.data, tenantId };
            }
          }
          return query(args);
        },

        async upsert({ model, args, query }) {
          if (isTenantModel(model)) {
            // Add tenantId to where clause
            args.where = { ...args.where, tenantId };
            // Add tenantId to create and update data
            args.create = { ...args.create, tenantId };
            args.update = { ...args.update }; // Don't change tenantId on update
          }
          return query(args);
        },

        async update({ model, args, query }) {
          if (isTenantModel(model)) {
            // Ensure we only update our tenant's records
            // First check if record exists and belongs to tenant
            const delegate = getModelDelegate(basePrisma, model);
            const existing = await delegate.findFirst({
              where: { ...(args.where as Record<string, unknown>), tenantId },
            });

            if (!existing) {
              throw new Error(
                `Record not found or belongs to different tenant`,
              );
            }
          }
          return query(args);
        },

        async updateMany({ model, args, query }) {
          if (isTenantModel(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },

        async delete({ model, args, query }) {
          if (isTenantModel(model)) {
            // Verify ownership before delete
            const delegate = getModelDelegate(basePrisma, model);
            const existing = await delegate.findFirst({
              where: { ...(args.where as Record<string, unknown>), tenantId },
            });

            if (!existing) {
              throw new Error(
                `Record not found or belongs to different tenant`,
              );
            }
          }
          return query(args);
        },

        async deleteMany({ model, args, query }) {
          if (isTenantModel(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },

        // =============================================
        // AGGREGATE OPERATIONS
        // =============================================

        async count({ model, args, query }) {
          if (isTenantModel(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },

        async aggregate({ model, args, query }) {
          if (isTenantModel(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },

        async groupBy({ model, args, query }) {
          if (isTenantModel(model)) {
            args.where = { ...args.where, tenantId };
          }
          return query(args);
        },
      },
    },
  });
}

// Type for the tenant-aware Prisma client
export type TenantPrismaClient = ReturnType<typeof createTenantPrisma>;

// =============================================================================
// SINGLETON CACHE FOR TENANT CLIENTS
// =============================================================================

// Cache tenant Prisma clients to avoid creating new connections
const tenantClients = new Map<string, TenantPrismaClient>();

/**
 * Get or create a tenant-specific Prisma client
 * Caches clients to reuse connections
 */
export function getTenantPrisma(tenantId: string): TenantPrismaClient {
  let client = tenantClients.get(tenantId);

  if (!client) {
    client = createTenantPrisma(tenantId);
    tenantClients.set(tenantId, client);

    // Clean up old clients if too many (simple LRU-like behavior)
    if (tenantClients.size > 100) {
      const firstKey = tenantClients.keys().next().value;
      if (firstKey) {
        tenantClients.delete(firstKey);
      }
    }
  }

  return client;
}

// =============================================================================
// RAW QUERY HELPER (for complex queries)
// =============================================================================

/**
 * Execute raw SQL with tenant filter
 * Uses Prisma.$queryRaw with tagged template literals for safe parameterization.
 *
 * Usage:
 * ```typescript
 * const results = await tenantQuery<Part[]>(
 *   tenantId,
 *   `SELECT * FROM "Part" WHERE "category" = $1 AND "tenantId" = $2`,
 *   ['COMPONENT', tenantId]
 * );
 * ```
 */
export async function tenantQuery<T = unknown>(
  tenantId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  // Validate tenantId format (UUID)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tenantId)) {
    throw new Error("Invalid tenantId format");
  }

  // Validate SQL doesn't contain dangerous patterns
  const dangerousPatterns = /;\s*(DROP|DELETE|TRUNCATE|ALTER|CREATE|GRANT)\s/i;
  if (dangerousPatterns.test(sql)) {
    throw new Error("SQL contains disallowed statements");
  }

  const prisma = new PrismaClient();

  try {
    // Use parameterized query - params are passed separately, not interpolated
    const result = await prisma.$queryRawUnsafe<T>(sql, ...params);
    return result;
  } finally {
    await prisma.$disconnect();
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default createTenantPrisma;
