// ============================================================
// @vierp/master-data - API Route Handlers
// Generic API handlers for master data CRUD operations.
// Designed for Next.js API routes but framework-agnostic.
// ============================================================

import type { ApiResponse, PaginationMeta } from '@vierp/shared';
import { publish } from '@vierp/events';
import { EVENT_SUBJECTS } from '@vierp/shared';
import { customerService } from '../services/customer.service';
import { productService } from '../services/product.service';
import { employeeService } from '../services/employee.service';
import { supplierService } from '../services/supplier.service';
import { MasterDataError } from '../services/base.service';
import type { MasterDataEntity, MasterDataQuery, BulkResult } from '../types';

// ==================== Service Registry ====================

const services: Record<string, any> = {
  customer: customerService,
  product: productService,
  employee: employeeService,
  supplier: supplierService,
};

const eventSubjects: Record<string, Record<string, string>> = {
  customer: EVENT_SUBJECTS.CUSTOMER,
  product: EVENT_SUBJECTS.PRODUCT,
  employee: EVENT_SUBJECTS.EMPLOYEE,
};

// ==================== Generic Handlers ====================

/**
 * List entities with pagination, search, and filtering
 */
export async function handleList(
  entity: MasterDataEntity,
  query: MasterDataQuery
): Promise<ApiResponse<unknown[]>> {
  const service = getService(entity);
  const { data, meta } = await service.list(query);
  return { success: true, data, meta };
}

/**
 * Get single entity by ID
 */
export async function handleGet(
  entity: MasterDataEntity,
  id: string,
  tenantId: string
): Promise<ApiResponse<unknown>> {
  const service = getService(entity);
  const record = await service.get(id, tenantId);

  if (!record) {
    return { success: false, error: { code: 'NOT_FOUND', message: `${entity} not found` } };
  }

  return { success: true, data: record };
}

/**
 * Get entity by code
 */
export async function handleGetByCode(
  entity: MasterDataEntity,
  code: string,
  tenantId: string
): Promise<ApiResponse<unknown>> {
  const service = getService(entity);
  const record = await service.getByCode(code, tenantId);

  if (!record) {
    return { success: false, error: { code: 'NOT_FOUND', message: `${entity} with code ${code} not found` } };
  }

  return { success: true, data: record };
}

/**
 * Create new entity and publish event
 */
export async function handleCreate(
  entity: MasterDataEntity,
  data: Record<string, unknown>,
  context: { tenantId: string; userId: string }
): Promise<ApiResponse<unknown>> {
  try {
    const service = getService(entity);
    const { record } = await service.create(data, { ...context, source: 'master-data' });

    // Publish creation event so other modules can sync
    await publishEntityEvent(entity, 'CREATED', record, context);

    return { success: true, data: record };
  } catch (error) {
    return handleServiceError(error);
  }
}

/**
 * Update entity and publish event
 */
export async function handleUpdate(
  entity: MasterDataEntity,
  id: string,
  data: Record<string, unknown>,
  context: { tenantId: string; userId: string }
): Promise<ApiResponse<unknown>> {
  try {
    const service = getService(entity);
    const { record } = await service.update(id, data, { ...context, source: 'master-data' });

    await publishEntityEvent(entity, 'UPDATED', record, context);

    return { success: true, data: record };
  } catch (error) {
    return handleServiceError(error);
  }
}

/**
 * Soft-delete entity and publish event
 */
export async function handleDelete(
  entity: MasterDataEntity,
  id: string,
  context: { tenantId: string; userId: string }
): Promise<ApiResponse<unknown>> {
  try {
    const service = getService(entity);
    const { record } = await service.delete(id, { ...context, source: 'master-data' });

    await publishEntityEvent(entity, 'DELETED', record, context);

    return { success: true, data: record };
  } catch (error) {
    return handleServiceError(error);
  }
}

/**
 * Restore soft-deleted entity
 */
export async function handleRestore(
  entity: MasterDataEntity,
  id: string,
  context: { tenantId: string; userId: string }
): Promise<ApiResponse<unknown>> {
  try {
    const service = getService(entity);
    const { record } = await service.restore(id, { ...context, source: 'master-data' });

    await publishEntityEvent(entity, 'CREATED', record, context); // Publish as created to re-sync

    return { success: true, data: record };
  } catch (error) {
    return handleServiceError(error);
  }
}

/**
 * Bulk operations (create/update/upsert/delete)
 */
export async function handleBulk(
  entity: MasterDataEntity,
  operation: { action: string; records: unknown[]; tenantId: string; userId: string }
): Promise<ApiResponse<BulkResult>> {
  try {
    const service = getService(entity);
    const result = await service.bulk(operation);
    return { success: true, data: result };
  } catch (error) {
    return handleServiceError(error);
  }
}

/**
 * Get entity statistics
 */
export async function handleStats(
  entity: MasterDataEntity,
  tenantId: string
): Promise<ApiResponse<unknown>> {
  try {
    const service = getService(entity);
    if (typeof service.getStats !== 'function') {
      return { success: false, error: { code: 'NOT_SUPPORTED', message: `Stats not available for ${entity}` } };
    }
    const stats = await service.getStats(tenantId);
    return { success: true, data: stats };
  } catch (error) {
    return handleServiceError(error);
  }
}

// ==================== Helpers ====================

function getService(entity: MasterDataEntity) {
  const service = services[entity];
  if (!service) {
    throw new MasterDataError(`Unknown entity: ${entity}`, 'INVALID_ENTITY', 400);
  }
  return service;
}

async function publishEntityEvent(
  entity: MasterDataEntity,
  action: string,
  data: unknown,
  context: { tenantId: string; userId: string }
): Promise<void> {
  const subjects = eventSubjects[entity];
  if (!subjects) return; // Supplier doesn't have event subjects yet

  const subject = subjects[action];
  if (!subject) return;

  try {
    await publish(subject, data, { ...context, source: 'master-data' });
  } catch (error) {
    // Don't fail the API call if event publishing fails
    console.error(`[MASTER-DATA] Failed to publish ${entity}.${action} event:`, error);
  }
}

function handleServiceError(error: unknown): ApiResponse<never> {
  if (error instanceof MasterDataError) {
    return {
      success: false,
      error: { code: error.code, message: error.message },
    };
  }

  console.error('[MASTER-DATA] Unexpected error:', error);
  return {
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  };
}

// ==================== Next.js Route Helper ====================

/**
 * Create Next.js API route handlers for a master data entity.
 * Usage in any module:
 *
 * ```ts
 * // app/api/master/customers/route.ts
 * import { createEntityRoutes } from '@vierp/master-data/api';
 * export const { GET, POST, PUT, DELETE } = createEntityRoutes('customer');
 * ```
 */
export function createEntityRoutes(entity: MasterDataEntity) {
  return {
    GET: async (request: Request) => {
      const url = new URL(request.url);
      const tenantId = request.headers.get('x-tenant-id') || '';
      const id = url.searchParams.get('id');
      const code = url.searchParams.get('code');

      if (id) {
        const result = await handleGet(entity, id, tenantId);
        return Response.json(result, { status: result.success ? 200 : 404 });
      }

      if (code) {
        const result = await handleGetByCode(entity, code, tenantId);
        return Response.json(result, { status: result.success ? 200 : 404 });
      }

      const query: MasterDataQuery = {
        tenantId,
        page: Number(url.searchParams.get('page')) || 1,
        pageSize: Number(url.searchParams.get('pageSize')) || 20,
        search: url.searchParams.get('search') || undefined,
        status: url.searchParams.get('status') || undefined,
        sortBy: url.searchParams.get('sortBy') || undefined,
        sortOrder: (url.searchParams.get('sortOrder') as 'asc' | 'desc') || undefined,
        category: url.searchParams.get('category') || undefined,
      };

      const result = await handleList(entity, query);
      return Response.json(result);
    },

    POST: async (request: Request) => {
      const tenantId = request.headers.get('x-tenant-id') || '';
      const userId = request.headers.get('x-user-id') || '';
      const body = await request.json();

      // Check for bulk operation
      if (body.bulk) {
        const result = await handleBulk(entity, {
          action: body.action,
          records: body.records,
          tenantId,
          userId,
        });
        return Response.json(result, { status: result.success ? 200 : 400 });
      }

      const result = await handleCreate(entity, body, { tenantId, userId });
      return Response.json(result, { status: result.success ? 201 : 400 });
    },

    PUT: async (request: Request) => {
      const url = new URL(request.url);
      const tenantId = request.headers.get('x-tenant-id') || '';
      const userId = request.headers.get('x-user-id') || '';
      const id = url.searchParams.get('id') || '';
      const body = await request.json();

      // Handle restore
      if (body._action === 'restore') {
        const result = await handleRestore(entity, id, { tenantId, userId });
        return Response.json(result, { status: result.success ? 200 : 400 });
      }

      const result = await handleUpdate(entity, id, body, { tenantId, userId });
      return Response.json(result, { status: result.success ? 200 : 400 });
    },

    DELETE: async (request: Request) => {
      const url = new URL(request.url);
      const tenantId = request.headers.get('x-tenant-id') || '';
      const userId = request.headers.get('x-user-id') || '';
      const id = url.searchParams.get('id') || '';

      const result = await handleDelete(entity, id, { tenantId, userId });
      return Response.json(result, { status: result.success ? 200 : 400 });
    },
  };
}
