// ============================================================
// @vierp/events — Event Schema Versioning + Idempotency
// RRI-T Upgrade: BA Analyst × D5 Data Integrity × DATA Axis
//
// Fixes:
// - No event versioning → Semantic versioned schemas
// - No backward compat → Up-migration transforms
// - No idempotency → Deduplication with idempotency keys
// - No event catalog → Self-documenting event registry
// ============================================================

// ─── Event Schema Versioning ────────────────────────────────

export interface EventSchema<T = unknown> {
  type: string;
  version: number;
  description: string;
  /** Transform from previous version to this version */
  upMigrate?: (data: any) => T;
  /** Validate data matches this version */
  validate?: (data: any) => { valid: boolean; errors?: string[] };
}

export interface VersionedEnvelope<T = unknown> {
  id: string;
  type: string;
  version: number;
  source: string;
  timestamp: string;
  tenantId: string;
  userId: string;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  data: T;
  metadata?: Record<string, any>;
}

// ─── Schema Registry ────────────────────────────────────────

class EventSchemaRegistry {
  private schemas: Map<string, Map<number, EventSchema>> = new Map();

  /**
   * Register an event schema version
   */
  register<T>(schema: EventSchema<T>): void {
    if (!this.schemas.has(schema.type)) {
      this.schemas.set(schema.type, new Map());
    }
    this.schemas.get(schema.type)!.set(schema.version, schema);
  }

  /**
   * Get latest version number for an event type
   */
  getLatestVersion(type: string): number {
    const versions = this.schemas.get(type);
    if (!versions || versions.size === 0) return 1;
    return Math.max(...versions.keys());
  }

  /**
   * Get schema for specific version
   */
  getSchema(type: string, version: number): EventSchema | undefined {
    return this.schemas.get(type)?.get(version);
  }

  /**
   * Migrate event data from one version to the latest
   */
  migrate<T>(type: string, data: any, fromVersion: number): { data: T; version: number } {
    const versions = this.schemas.get(type);
    if (!versions) return { data, version: fromVersion };

    const latestVersion = this.getLatestVersion(type);
    let currentData = data;

    for (let v = fromVersion + 1; v <= latestVersion; v++) {
      const schema = versions.get(v);
      if (schema?.upMigrate) {
        currentData = schema.upMigrate(currentData);
      }
    }

    return { data: currentData as T, version: latestVersion };
  }

  /**
   * Validate event data against its schema
   */
  validate(type: string, version: number, data: any): { valid: boolean; errors?: string[] } {
    const schema = this.getSchema(type, version);
    if (!schema?.validate) return { valid: true };
    return schema.validate(data);
  }

  /**
   * List all registered event types and their versions
   */
  catalog(): Array<{ type: string; versions: number[]; latestVersion: number; description: string }> {
    const result: Array<{ type: string; versions: number[]; latestVersion: number; description: string }> = [];

    for (const [type, versions] of this.schemas) {
      const versionNumbers = Array.from(versions.keys()).sort((a, b) => a - b);
      const latest = versions.get(Math.max(...versionNumbers));
      result.push({
        type,
        versions: versionNumbers,
        latestVersion: Math.max(...versionNumbers),
        description: latest?.description || '',
      });
    }

    return result.sort((a, b) => a.type.localeCompare(b.type));
  }
}

// ─── Singleton Registry ─────────────────────────────────────

let registryInstance: EventSchemaRegistry | null = null;

export function getSchemaRegistry(): EventSchemaRegistry {
  if (!registryInstance) {
    registryInstance = new EventSchemaRegistry();
    registerDefaultSchemas(registryInstance);
  }
  return registryInstance;
}

// ─── Default ERP Event Schemas ──────────────────────────────

function registerDefaultSchemas(registry: EventSchemaRegistry): void {
  // ── Customer Events ───────────────────────────────
  registry.register({
    type: 'vierp.customer.created',
    version: 1,
    description: 'Khách hàng mới được tạo / New customer created',
    validate: (data) => {
      const errors: string[] = [];
      if (!data.id) errors.push('Missing customer id');
      if (!data.name) errors.push('Missing customer name');
      return { valid: errors.length === 0, errors };
    },
  });

  registry.register({
    type: 'vierp.customer.created',
    version: 2,
    description: 'Customer created — added taxCode and address fields',
    upMigrate: (data: any) => ({
      ...data,
      taxCode: data.taxCode || null,
      address: data.address || { province: '', district: '', ward: '', street: '' },
      tags: data.tags || [],
    }),
  });

  // ── Order Events ──────────────────────────────────
  registry.register({
    type: 'vierp.order.created',
    version: 1,
    description: 'Đơn hàng mới / New order created',
    validate: (data) => {
      const errors: string[] = [];
      if (!data.orderId) errors.push('Missing orderId');
      if (!data.customerId) errors.push('Missing customerId');
      if (!Array.isArray(data.lines) || data.lines.length === 0) errors.push('Order must have at least one line');
      return { valid: errors.length === 0, errors };
    },
  });

  registry.register({
    type: 'vierp.order.created',
    version: 2,
    description: 'Order created — added payment method and shipping info',
    upMigrate: (data: any) => ({
      ...data,
      paymentMethod: data.paymentMethod || 'COD',
      shippingProvider: data.shippingProvider || null,
      estimatedDelivery: data.estimatedDelivery || null,
    }),
  });

  registry.register({
    type: 'vierp.order.status_changed',
    version: 1,
    description: 'Trạng thái đơn hàng thay đổi / Order status changed',
  });

  // ── Inventory Events ──────────────────────────────
  registry.register({
    type: 'vierp.inventory.adjusted',
    version: 1,
    description: 'Tồn kho điều chỉnh / Inventory adjusted',
    validate: (data) => {
      const errors: string[] = [];
      if (!data.productId) errors.push('Missing productId');
      if (typeof data.quantity !== 'number') errors.push('quantity must be a number');
      if (!data.reason) errors.push('Missing adjustment reason');
      return { valid: errors.length === 0, errors };
    },
  });

  registry.register({
    type: 'vierp.inventory.low_stock',
    version: 1,
    description: 'Cảnh báo tồn kho thấp / Low stock warning',
  });

  // ── Employee Events ───────────────────────────────
  registry.register({
    type: 'vierp.employee.created',
    version: 1,
    description: 'Nhân viên mới / New employee created',
  });

  registry.register({
    type: 'vierp.employee.terminated',
    version: 1,
    description: 'Nhân viên nghỉ việc / Employee terminated',
  });

  // ── Accounting Events ─────────────────────────────
  registry.register({
    type: 'vierp.accounting.journal_posted',
    version: 1,
    description: 'Bút toán đã ghi sổ / Journal entry posted',
    validate: (data) => {
      const errors: string[] = [];
      if (!data.journalId) errors.push('Missing journalId');
      if (!data.periodId) errors.push('Missing periodId');
      return { valid: errors.length === 0, errors };
    },
  });

  registry.register({
    type: 'vierp.accounting.period_closed',
    version: 1,
    description: 'Kỳ kế toán đóng / Accounting period closed',
  });

  // ── Invoice Events ────────────────────────────────
  registry.register({
    type: 'vierp.invoice.created',
    version: 1,
    description: 'Hóa đơn tạo mới / Invoice created',
  });

  registry.register({
    type: 'vierp.invoice.sent',
    version: 1,
    description: 'Hóa đơn đã gửi / Invoice sent to customer',
  });

  // ── Production Events ─────────────────────────────
  registry.register({
    type: 'vierp.production.order_created',
    version: 1,
    description: 'Lệnh sản xuất tạo / Production order created',
  });

  registry.register({
    type: 'vierp.production.completed',
    version: 1,
    description: 'Sản xuất hoàn thành / Production completed',
  });
}

// ─── Idempotency Store ──────────────────────────────────────

export interface IdempotencyRecord {
  key: string;
  eventId: string;
  processedAt: string;
  result: 'success' | 'error';
  expiresAt: number; // Unix timestamp ms
}

export class IdempotencyStore {
  private records: Map<string, IdempotencyRecord> = new Map();
  private maxSize: number;
  private defaultTTLMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: { maxSize?: number; defaultTTLMs?: number } = {}) {
    this.maxSize = options.maxSize || 50000;
    this.defaultTTLMs = options.defaultTTLMs || 24 * 60 * 60 * 1000; // 24h

    // Periodic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    // Allow process to exit
    if (this.cleanupInterval.unref) this.cleanupInterval.unref();
  }

  /**
   * Generate idempotency key from event properties
   */
  static generateKey(params: {
    type: string;
    tenantId: string;
    entityId?: string;
    userId?: string;
    timestamp?: string;
  }): string {
    const parts = [params.type, params.tenantId];
    if (params.entityId) parts.push(params.entityId);
    if (params.userId) parts.push(params.userId);
    if (params.timestamp) {
      // Round to nearest second to handle minor timing differences
      const ts = new Date(params.timestamp);
      ts.setMilliseconds(0);
      parts.push(ts.toISOString());
    }
    return parts.join(':');
  }

  /**
   * Check if an event has already been processed
   */
  isDuplicate(key: string): boolean {
    const record = this.records.get(key);
    if (!record) return false;
    if (Date.now() > record.expiresAt) {
      this.records.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get the idempotency record for a key
   */
  get(key: string): IdempotencyRecord | undefined {
    const record = this.records.get(key);
    if (!record) return undefined;
    if (Date.now() > record.expiresAt) {
      this.records.delete(key);
      return undefined;
    }
    return record;
  }

  /**
   * Record that an event has been processed
   */
  record(key: string, eventId: string, result: 'success' | 'error', ttlMs?: number): void {
    // Evict oldest if at capacity
    if (this.records.size >= this.maxSize) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey) this.records.delete(oldestKey);
    }

    this.records.set(key, {
      key,
      eventId,
      processedAt: new Date().toISOString(),
      result,
      expiresAt: Date.now() + (ttlMs || this.defaultTTLMs),
    });
  }

  /**
   * Remove expired records
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, record] of this.records) {
      if (now > record.expiresAt) {
        this.records.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Get store size
   */
  get size(): number {
    return this.records.size;
  }

  /**
   * Destroy store and stop cleanup timer
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.records.clear();
  }
}

// ─── Singleton Idempotency Store ────────────────────────────

let idempotencyInstance: IdempotencyStore | null = null;

export function getIdempotencyStore(): IdempotencyStore {
  if (!idempotencyInstance) {
    idempotencyInstance = new IdempotencyStore();
  }
  return idempotencyInstance;
}

// ─── Correlation & Causation IDs ────────────────────────────

/**
 * Generate a correlation ID for tracing event chains
 * All events in a business transaction share the same correlationId
 */
export function generateCorrelationId(): string {
  return `cor_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a causation ID (the event that caused this event)
 */
export function generateCausationId(parentEventId: string): string {
  return parentEventId;
}

// ─── Enhanced Publisher ─────────────────────────────────────

/**
 * Create a versioned event envelope with correlation + idempotency
 */
export function createVersionedEnvelope<T>(params: {
  type: string;
  data: T;
  tenantId: string;
  userId: string;
  source?: string;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}): VersionedEnvelope<T> {
  const registry = getSchemaRegistry();
  const version = registry.getLatestVersion(params.type);

  // Validate against schema
  const validation = registry.validate(params.type, version, params.data);
  if (!validation.valid) {
    throw new Error(
      `Event validation failed for ${params.type} v${version}: ${validation.errors?.join(', ')}`
    );
  }

  return {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`,
    type: params.type,
    version,
    source: params.source || process.env.MODULE_NAME || 'unknown',
    timestamp: new Date().toISOString(),
    tenantId: params.tenantId,
    userId: params.userId,
    correlationId: params.correlationId,
    causationId: params.causationId,
    idempotencyKey: params.idempotencyKey,
    data: params.data,
    metadata: params.metadata,
  };
}

/**
 * Process incoming event with version migration + idempotency check
 */
export function processIncomingEvent<T>(
  envelope: VersionedEnvelope<T>,
  options: { checkIdempotency?: boolean } = {}
): { data: T; version: number; isDuplicate: boolean } {
  const registry = getSchemaRegistry();

  // Check idempotency
  if (options.checkIdempotency && envelope.idempotencyKey) {
    const store = getIdempotencyStore();
    if (store.isDuplicate(envelope.idempotencyKey)) {
      return { data: envelope.data, version: envelope.version, isDuplicate: true };
    }
  }

  // Migrate to latest version if needed
  const latestVersion = registry.getLatestVersion(envelope.type);
  if (envelope.version < latestVersion) {
    const migrated = registry.migrate<T>(envelope.type, envelope.data, envelope.version);
    return { data: migrated.data, version: migrated.version, isDuplicate: false };
  }

  return { data: envelope.data, version: envelope.version, isDuplicate: false };
}
