// ============================================================
// @vierp/events - Core Event Types
// ============================================================

import type { z } from 'zod';

/**
 * Module identifier enum for event source/routing
 * Các module trong hệ thống ERP
 */
export enum Module {
  CRM = 'crm',
  ACCOUNTING = 'accounting',
  ECOMMERCE = 'ecommerce',
  MRP = 'mrp',
  HRM = 'hrm',
  OTB = 'otb',
  TPM = 'tpm',
  PM = 'pm',
}

/**
 * Base event type - all events must implement this structure
 * Cấu trúc cơ bản cho tất cả sự kiện
 */
export interface BaseEvent<T = unknown> {
  /** Unique event identifier */
  id: string;
  /** Event type/name (e.g., 'crm.lead.created') */
  type: string;
  /** Source module that emitted the event */
  source: Module;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Correlation ID for tracing related events */
  correlationId: string;
  /** Causation ID linking to triggering event */
  causationId?: string;
  /** Event payload with validation */
  payload: T;
  /** Tenant ID for multi-tenancy */
  tenantId: string;
  /** User ID who triggered the event */
  userId: string;
  /** Metadata for routing and filtering */
  metadata?: Record<string, unknown>;
}

/**
 * Event handler function type
 * Hàm xử lý sự kiện
 */
export type EventHandler<T = unknown> = (event: BaseEvent<T>) => Promise<void>;

/**
 * Typed event handler with schema validation
 * Hàm xử lý sự kiện có kiểm tra kiểu
 */
export type TypedEventHandler<S extends z.ZodType> = (
  event: BaseEvent<z.infer<S>>
) => Promise<void>;

/**
 * Event bus configuration
 * Cấu hình cho Event Bus
 */
export interface EventBusConfig {
  /** NATS Server URL */
  natsUrl: string;
  /** Module identifier */
  module: Module;
  /** Optional custom connection options */
  connectionOptions?: Record<string, unknown>;
  /** Retry policy */
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
    maxBackoffMs: number;
  };
}

/**
 * Event publishing options
 */
export interface PublishOptions {
  /** Custom correlation ID for tracing */
  correlationId?: string;
  /** Causation ID linking to parent event */
  causationId?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Event subscription options
 */
export interface SubscriptionOptions {
  /** Consumer group name (for load balancing) */
  consumerGroup?: string;
  /** Max retries before DLQ */
  maxRetries?: number;
  /** Custom error handler */
  onError?: (error: Error, event: BaseEvent) => Promise<void>;
}

/**
 * Event flow metadata
 * Thông tin tự động cho luồng sự kiện
 */
export interface EventFlowMeta {
  /** Events that trigger this flow */
  triggers: string[];
  /** Generated event type */
  target: string;
  /** Mapping function */
  mapper: (triggerEvent: BaseEvent<unknown>) => Promise<unknown>;
}
