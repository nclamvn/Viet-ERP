// ============================================================
// @vierp/events — Dead Letter Queue (DLQ)
// RRI-T Upgrade: QA Destroyer × D7 Edge Cases × ERROR Axis
//
// Fixes:
// - No DLQ → Failed events captured with full context
// - No retry policy → Exponential backoff with max retries
// - No poisoned message detection → Auto-DLQ after max retries
// - No DLQ monitoring → Inspection + replay APIs
// ============================================================

import type { EventEnvelope } from '@vierp/shared';

// ─── Types ───────────────────────────────────────────────────

export interface DLQEntry<T = unknown> {
  id: string;
  originalEvent: EventEnvelope<T>;
  subject: string;
  consumerName: string;
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
  retryCount: number;
  maxRetries: number;
  firstFailedAt: string;
  lastFailedAt: string;
  status: 'pending' | 'retrying' | 'replayed' | 'discarded';
  metadata?: Record<string, any>;
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface DLQStats {
  total: number;
  pending: number;
  retrying: number;
  replayed: number;
  discarded: number;
  oldestEntry?: string;
  newestEntry?: string;
  topErrors: Array<{ message: string; count: number }>;
  byConsumer: Record<string, number>;
}

// ─── Default Retry Policies ─────────────────────────────────

export const RETRY_POLICIES: Record<string, RetryPolicy> = {
  default: {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
  },
  critical: {
    maxRetries: 10,
    baseDelayMs: 500,
    maxDelayMs: 300000, // 5 min
    backoffMultiplier: 3,
  },
  idempotent: {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  },
  fire_and_forget: {
    maxRetries: 1,
    baseDelayMs: 5000,
    maxDelayMs: 5000,
    backoffMultiplier: 1,
  },
};

// ─── Retry Delay Calculator ─────────────────────────────────

/**
 * Calculate delay with exponential backoff + jitter
 */
export function calculateRetryDelay(attempt: number, policy: RetryPolicy): number {
  const exponentialDelay = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, policy.maxDelayMs);
  // Add ±20% jitter to prevent thundering herd
  const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
  return Math.round(cappedDelay + jitter);
}

/**
 * Check if a message should be retried or sent to DLQ
 */
export function shouldRetry(retryCount: number, policy: RetryPolicy): boolean {
  return retryCount < policy.maxRetries;
}

// ─── In-Memory DLQ Store ────────────────────────────────────

export class DeadLetterQueue {
  private entries: Map<string, DLQEntry> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }

  /**
   * Add a failed event to the DLQ
   */
  add<T>(params: {
    event: EventEnvelope<T>;
    subject: string;
    consumerName: string;
    error: Error;
    retryCount: number;
    maxRetries: number;
    metadata?: Record<string, any>;
  }): DLQEntry<T> {
    const now = new Date().toISOString();
    const existing = this.entries.get(params.event.id);

    if (existing) {
      // Update existing entry
      existing.retryCount = params.retryCount;
      existing.lastFailedAt = now;
      existing.error = {
        message: params.error.message,
        stack: params.error.stack,
        code: (params.error as any).code,
      };
      return existing as DLQEntry<T>;
    }

    // Evict oldest if at capacity
    if (this.entries.size >= this.maxSize) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) this.entries.delete(oldestKey);
    }

    const entry: DLQEntry<T> = {
      id: `dlq_${params.event.id}`,
      originalEvent: params.event,
      subject: params.subject,
      consumerName: params.consumerName,
      error: {
        message: params.error.message,
        stack: params.error.stack,
        code: (params.error as any).code,
      },
      retryCount: params.retryCount,
      maxRetries: params.maxRetries,
      firstFailedAt: now,
      lastFailedAt: now,
      status: 'pending',
      metadata: params.metadata,
    };

    this.entries.set(params.event.id, entry);
    return entry;
  }

  /**
   * Get DLQ entry by event ID
   */
  get(eventId: string): DLQEntry | undefined {
    return this.entries.get(eventId);
  }

  /**
   * List DLQ entries with pagination and filters
   */
  list(options: {
    status?: DLQEntry['status'];
    consumerName?: string;
    subject?: string;
    limit?: number;
    offset?: number;
  } = {}): { entries: DLQEntry[]; total: number } {
    let results = Array.from(this.entries.values());

    if (options.status) {
      results = results.filter(e => e.status === options.status);
    }
    if (options.consumerName) {
      results = results.filter(e => e.consumerName === options.consumerName);
    }
    if (options.subject) {
      results = results.filter(e => e.subject.startsWith(options.subject!));
    }

    // Sort by lastFailedAt descending
    results.sort((a, b) => new Date(b.lastFailedAt).getTime() - new Date(a.lastFailedAt).getTime());

    const total = results.length;
    const offset = options.offset || 0;
    const limit = options.limit || 50;
    const entries = results.slice(offset, offset + limit);

    return { entries, total };
  }

  /**
   * Mark entry for replay
   */
  markForReplay(eventId: string): DLQEntry | undefined {
    const entry = this.entries.get(eventId);
    if (entry) {
      entry.status = 'retrying';
    }
    return entry;
  }

  /**
   * Mark entry as replayed successfully
   */
  markReplayed(eventId: string): void {
    const entry = this.entries.get(eventId);
    if (entry) {
      entry.status = 'replayed';
    }
  }

  /**
   * Discard entry (give up)
   */
  discard(eventId: string): void {
    const entry = this.entries.get(eventId);
    if (entry) {
      entry.status = 'discarded';
    }
  }

  /**
   * Purge completed entries
   */
  purge(statuses: DLQEntry['status'][] = ['replayed', 'discarded']): number {
    let purged = 0;
    for (const [key, entry] of this.entries) {
      if (statuses.includes(entry.status)) {
        this.entries.delete(key);
        purged++;
      }
    }
    return purged;
  }

  /**
   * Get DLQ statistics
   */
  getStats(): DLQStats {
    const entries = Array.from(this.entries.values());

    const errorCounts = new Map<string, number>();
    const consumerCounts: Record<string, number> = {};

    let pending = 0, retrying = 0, replayed = 0, discarded = 0;

    for (const entry of entries) {
      switch (entry.status) {
        case 'pending': pending++; break;
        case 'retrying': retrying++; break;
        case 'replayed': replayed++; break;
        case 'discarded': discarded++; break;
      }

      const errMsg = entry.error.message.substring(0, 100);
      errorCounts.set(errMsg, (errorCounts.get(errMsg) || 0) + 1);
      consumerCounts[entry.consumerName] = (consumerCounts[entry.consumerName] || 0) + 1;
    }

    const topErrors = Array.from(errorCounts.entries())
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const sorted = entries.sort((a, b) =>
      new Date(a.firstFailedAt).getTime() - new Date(b.firstFailedAt).getTime()
    );

    return {
      total: entries.length,
      pending,
      retrying,
      replayed,
      discarded,
      oldestEntry: sorted[0]?.firstFailedAt,
      newestEntry: sorted[sorted.length - 1]?.firstFailedAt,
      topErrors,
      byConsumer: consumerCounts,
    };
  }

  /**
   * Get size of DLQ
   */
  get size(): number {
    return this.entries.size;
  }
}

// ─── Singleton DLQ Instance ─────────────────────────────────

let dlqInstance: DeadLetterQueue | null = null;

export function getDLQ(): DeadLetterQueue {
  if (!dlqInstance) {
    dlqInstance = new DeadLetterQueue();
  }
  return dlqInstance;
}
