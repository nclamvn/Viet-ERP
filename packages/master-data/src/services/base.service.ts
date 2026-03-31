// ============================================================
// @vierp/master-data - Base Service
// Generic CRUD operations for all master data entities
// ============================================================

import type { PaginationMeta } from '@vierp/shared';
import type { MasterDataQuery, BulkOperation, BulkResult, ChangeRecord, MasterDataEntity, SyncAction } from '../types';

/**
 * Abstract base service for master data entities.
 * Provides generic CRUD, pagination, search, soft-delete, and change tracking.
 */
export abstract class BaseMasterDataService<T extends { id: string; tenantId: string }> {
  protected abstract entityName: MasterDataEntity;

  // ==================== Abstract methods (implement per entity) ====================

  protected abstract findById(id: string, tenantId: string): Promise<T | null>;
  protected abstract findByCode(code: string, tenantId: string): Promise<T | null>;
  protected abstract findMany(query: MasterDataQuery): Promise<{ data: T[]; total: number }>;
  protected abstract createRecord(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>, tenantId: string): Promise<T>;
  protected abstract updateRecord(id: string, data: Partial<T>, tenantId: string): Promise<T>;
  protected abstract softDeleteRecord(id: string, tenantId: string): Promise<T>;
  protected abstract restoreRecord(id: string, tenantId: string): Promise<T>;

  // ==================== Public API ====================

  async get(id: string, tenantId: string): Promise<T | null> {
    return this.findById(id, tenantId);
  }

  async getByCode(code: string, tenantId: string): Promise<T | null> {
    return this.findByCode(code, tenantId);
  }

  async list(query: MasterDataQuery): Promise<{ data: T[]; meta: PaginationMeta }> {
    const page = query.page || 1;
    const pageSize = Math.min(query.pageSize || 20, 100);

    const { data, total } = await this.findMany({
      ...query,
      page,
      pageSize,
    });

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async create(
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
    context: { tenantId: string; userId: string; source?: string }
  ): Promise<{ record: T; changeRecord: ChangeRecord }> {
    const record = await this.createRecord(data, context.tenantId);

    const changeRecord = this.buildChangeRecord(
      record.id,
      'create',
      {},
      record as Record<string, unknown>,
      context
    );

    return { record, changeRecord };
  }

  async update(
    id: string,
    data: Partial<T>,
    context: { tenantId: string; userId: string; source?: string }
  ): Promise<{ record: T; changeRecord: ChangeRecord }> {
    const existing = await this.findById(id, context.tenantId);
    if (!existing) {
      throw new MasterDataError(`${this.entityName} not found: ${id}`, 'NOT_FOUND', 404);
    }

    const record = await this.updateRecord(id, data, context.tenantId);

    const changes = this.diffRecords(
      existing as Record<string, unknown>,
      record as Record<string, unknown>
    );

    const changeRecord = this.buildChangeRecord(
      id,
      'update',
      changes,
      record as Record<string, unknown>,
      context
    );

    return { record, changeRecord };
  }

  async delete(
    id: string,
    context: { tenantId: string; userId: string; source?: string }
  ): Promise<{ record: T; changeRecord: ChangeRecord }> {
    const record = await this.softDeleteRecord(id, context.tenantId);

    const changeRecord = this.buildChangeRecord(
      id,
      'delete',
      {},
      record as Record<string, unknown>,
      context
    );

    return { record, changeRecord };
  }

  async restore(
    id: string,
    context: { tenantId: string; userId: string; source?: string }
  ): Promise<{ record: T; changeRecord: ChangeRecord }> {
    const record = await this.restoreRecord(id, context.tenantId);

    const changeRecord = this.buildChangeRecord(
      id,
      'restore',
      {},
      record as Record<string, unknown>,
      context
    );

    return { record, changeRecord };
  }

  async bulk(operation: BulkOperation<T>): Promise<BulkResult> {
    const result: BulkResult = {
      total: operation.records.length,
      succeeded: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < operation.records.length; i++) {
      try {
        const record = operation.records[i];
        switch (operation.action) {
          case 'create':
            await this.createRecord(
              record as Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
              operation.tenantId
            );
            break;
          case 'update':
            await this.updateRecord(record.id, record, operation.tenantId);
            break;
          case 'upsert': {
            const existing = await this.findById(record.id, operation.tenantId);
            if (existing) {
              await this.updateRecord(record.id, record, operation.tenantId);
            } else {
              await this.createRecord(
                record as Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
                operation.tenantId
              );
            }
            break;
          }
          case 'delete':
            await this.softDeleteRecord(record.id, operation.tenantId);
            break;
        }
        result.succeeded++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          index: i,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  // ==================== Conflict Resolution ====================

  /**
   * Resolve sync conflict using last-write-wins with version check
   * Modules publish events → Master Data decides which version wins
   */
  async resolveConflict(
    entityId: string,
    incomingData: Partial<T>,
    incomingVersion: number,
    sourceModule: string,
    tenantId: string
  ): Promise<{ resolution: 'source_wins' | 'target_wins' | 'merged'; record: T }> {
    const existing = await this.findById(entityId, tenantId);

    if (!existing) {
      // No conflict — entity doesn't exist, create it
      const record = await this.createRecord(
        incomingData as Omit<T, 'id' | 'createdAt' | 'updatedAt'>,
        tenantId
      );
      return { resolution: 'source_wins', record };
    }

    // Version-based conflict resolution: higher version wins
    const existingVersion = (existing as Record<string, unknown>)['version'] as number || 0;

    if (incomingVersion > existingVersion) {
      const record = await this.updateRecord(entityId, incomingData, tenantId);
      return { resolution: 'source_wins', record };
    } else if (incomingVersion === existingVersion) {
      // Same version — merge non-null fields from source
      const mergedData: Partial<T> = {};
      for (const [key, value] of Object.entries(incomingData as Record<string, unknown>)) {
        if (value != null) {
          (mergedData as Record<string, unknown>)[key] = value;
        }
      }
      const record = await this.updateRecord(entityId, mergedData, tenantId);
      return { resolution: 'merged', record };
    }

    // Target (master) has higher version — keep existing
    return { resolution: 'target_wins', record: existing };
  }

  // ==================== Helpers ====================

  protected diffRecords(
    old: Record<string, unknown>,
    updated: Record<string, unknown>
  ): Record<string, { old: unknown; new: unknown }> {
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const skipFields = ['createdAt', 'updatedAt', 'deletedAt'];

    for (const key of Object.keys(updated)) {
      if (skipFields.includes(key)) continue;
      if (JSON.stringify(old[key]) !== JSON.stringify(updated[key])) {
        changes[key] = { old: old[key], new: updated[key] };
      }
    }

    return changes;
  }

  protected buildChangeRecord(
    entityId: string,
    action: SyncAction,
    changes: Record<string, { old: unknown; new: unknown }>,
    data: Record<string, unknown>,
    context: { tenantId: string; userId: string; source?: string }
  ): ChangeRecord {
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`,
      entity: this.entityName,
      entityId,
      action,
      changes,
      sourceModule: context.source || 'master-data',
      userId: context.userId,
      tenantId: context.tenantId,
      version: (data['version'] as number) || 1,
      createdAt: new Date(),
    };
  }
}

// ==================== Error Class ====================

export class MasterDataError extends Error {
  constructor(
    message: string,
    public code: string = 'MASTER_DATA_ERROR',
    public status: number = 500
  ) {
    super(message);
    this.name = 'MasterDataError';
  }
}
