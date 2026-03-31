// ============================================================
// @vierp/master-data - Type Definitions
// ============================================================

import type { PaginationParams, Customer, Product, Employee, EventEnvelope } from '@vierp/shared';

// ==================== Supplier (New Entity) ====================

export interface Supplier {
  id: string;
  code: string;
  name: string;
  email?: string;
  phone?: string;
  taxCode?: string;
  bankAccount?: string;
  bankName?: string;
  address?: {
    street?: string;
    ward?: string;
    district?: string;
    city: string;
    province?: string;
    country: string;
    postalCode?: string;
  };
  contactPerson?: string;
  paymentTermDays: number;
  rating?: number;
  tenantId: string;
  status: 'active' | 'inactive';
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

// ==================== Warehouse (New Entity) ====================

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address?: string;
  managerId?: string;
  tenantId: string;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

// ==================== Unit of Measure ====================

export interface UnitOfMeasure {
  id: string;
  code: string;
  name: string;
  description?: string;
  conversionFactor: number;
  baseUnitId?: string;
  tenantId: string;
  isActive: boolean;
}

// ==================== Master Data Sync ====================

export type MasterDataEntity = 'customer' | 'product' | 'employee' | 'supplier' | 'warehouse' | 'uom';

export type SyncAction = 'create' | 'update' | 'delete' | 'restore';

export interface SyncEvent<T = unknown> {
  entity: MasterDataEntity;
  action: SyncAction;
  data: T;
  sourceModule: string;
  tenantId: string;
  userId: string;
  timestamp: string;
  version: number;
}

export interface SyncResult {
  success: boolean;
  entity: MasterDataEntity;
  entityId: string;
  action: SyncAction;
  sourceModule: string;
  conflictResolution?: 'source_wins' | 'target_wins' | 'merged';
  error?: string;
}

export interface SyncConflict {
  entity: MasterDataEntity;
  entityId: string;
  field: string;
  sourceValue: unknown;
  targetValue: unknown;
  sourceModule: string;
  targetModule: string;
  resolvedAt?: Date;
  resolution?: 'source_wins' | 'target_wins' | 'manual';
}

// ==================== Query & Filter ====================

export interface MasterDataQuery extends PaginationParams {
  tenantId: string;
  status?: string;
  code?: string;
  name?: string;
  category?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  includeDeleted?: boolean;
}

export interface BulkOperation<T> {
  action: 'create' | 'update' | 'upsert' | 'delete';
  records: T[];
  tenantId: string;
  userId: string;
}

export interface BulkResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
}

// ==================== Change History ====================

export interface ChangeRecord {
  id: string;
  entity: MasterDataEntity;
  entityId: string;
  action: SyncAction;
  changes: Record<string, { old: unknown; new: unknown }>;
  sourceModule: string;
  userId: string;
  tenantId: string;
  version: number;
  createdAt: Date;
}

// ==================== Re-exports for convenience ====================

export type { Customer, Product, Employee, EventEnvelope };
export type { Supplier as MasterSupplier };
