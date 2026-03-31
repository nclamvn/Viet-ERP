// ============================================================
// @vierp/sdk — Webhook System
// Register, verify, and dispatch webhooks from ERP events
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto';

// ==================== Types ====================

export interface WebhookConfig {
  id: string;
  url: string;
  secret: string;
  events: string[];             // e.g., ['customer.created', 'order.completed']
  isActive: boolean;
  tenantId: string;
  metadata?: Record<string, string>;
  retryPolicy?: RetryPolicy;
  createdAt: Date;
}

export interface WebhookPayload {
  id: string;                    // Unique delivery ID
  event: string;                 // Event type
  timestamp: string;             // ISO 8601
  tenantId: string;
  data: unknown;
  webhookId: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: WebhookPayload;
  status: 'pending' | 'delivered' | 'failed' | 'retrying';
  statusCode?: number;
  responseBody?: string;
  attempts: number;
  nextRetryAt?: Date;
  deliveredAt?: Date;
  error?: string;
}

export interface RetryPolicy {
  maxRetries: number;            // default: 5
  initialDelayMs: number;        // default: 1000
  maxDelayMs: number;            // default: 300000 (5 min)
  backoffMultiplier: number;     // default: 2
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 300_000,
  backoffMultiplier: 2,
};

// ==================== Webhook Manager ====================

export class WebhookManager {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private deliveryQueue: WebhookDelivery[] = [];

  /**
   * Register a new webhook
   */
  register(config: WebhookConfig): void {
    this.webhooks.set(config.id, {
      ...config,
      retryPolicy: config.retryPolicy || DEFAULT_RETRY_POLICY,
    });
  }

  /**
   * Unregister a webhook
   */
  unregister(webhookId: string): void {
    this.webhooks.delete(webhookId);
  }

  /**
   * Dispatch an event to all matching webhooks
   */
  async dispatch(event: string, data: unknown, tenantId: string): Promise<WebhookDelivery[]> {
    const matchingWebhooks = Array.from(this.webhooks.values())
      .filter(wh => wh.isActive && wh.tenantId === tenantId && this.matchesEvent(wh.events, event));

    const deliveries: WebhookDelivery[] = [];

    for (const webhook of matchingWebhooks) {
      const delivery = await this.deliver(webhook, event, data, tenantId);
      deliveries.push(delivery);
    }

    return deliveries;
  }

  /**
   * Deliver a webhook payload to a single endpoint
   */
  private async deliver(
    webhook: WebhookConfig,
    event: string,
    data: unknown,
    tenantId: string
  ): Promise<WebhookDelivery> {
    const deliveryId = `whd_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

    const payload: WebhookPayload = {
      id: deliveryId,
      event,
      timestamp: new Date().toISOString(),
      tenantId,
      data,
      webhookId: webhook.id,
    };

    const delivery: WebhookDelivery = {
      id: deliveryId,
      webhookId: webhook.id,
      event,
      payload,
      status: 'pending',
      attempts: 0,
    };

    // Attempt delivery
    const body = JSON.stringify(payload);
    const signature = this.sign(body, webhook.secret);
    const retryPolicy = webhook.retryPolicy || DEFAULT_RETRY_POLICY;

    for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt++) {
      delivery.attempts = attempt + 1;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-ID': webhook.id,
            'X-Webhook-Delivery': deliveryId,
            'X-Webhook-Event': event,
            'X-Webhook-Signature': `sha256=${signature}`,
            'X-Webhook-Timestamp': payload.timestamp,
            'User-Agent': 'ERP-Webhook/1.0',
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        delivery.statusCode = response.status;

        if (response.ok) {
          delivery.status = 'delivered';
          delivery.deliveredAt = new Date();
          try {
            delivery.responseBody = await response.text();
          } catch {}
          break;
        }

        // Non-retryable status codes
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          delivery.status = 'failed';
          delivery.error = `HTTP ${response.status}`;
          break;
        }

        delivery.status = 'retrying';
      } catch (error) {
        delivery.error = error instanceof Error ? error.message : String(error);
        delivery.status = attempt < retryPolicy.maxRetries ? 'retrying' : 'failed';
      }

      // Exponential backoff delay
      if (attempt < retryPolicy.maxRetries) {
        const delay = Math.min(
          retryPolicy.initialDelayMs * Math.pow(retryPolicy.backoffMultiplier, attempt),
          retryPolicy.maxDelayMs
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    this.deliveryQueue.push(delivery);
    return delivery;
  }

  // ==================== Signature Verification ====================

  /**
   * Sign a payload with HMAC-SHA256
   */
  sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Verify webhook signature (for receivers)
   */
  static verifySignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const sig = signature.startsWith('sha256=') ? signature.slice(7) : signature;

    try {
      return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  // ==================== Helpers ====================

  private matchesEvent(patterns: string[], event: string): boolean {
    return patterns.some(pattern => {
      if (pattern === '*') return true;
      if (pattern.endsWith('.*')) {
        return event.startsWith(pattern.slice(0, -2));
      }
      return pattern === event;
    });
  }

  getDeliveryHistory(webhookId?: string, limit = 50): WebhookDelivery[] {
    let deliveries = this.deliveryQueue;
    if (webhookId) {
      deliveries = deliveries.filter(d => d.webhookId === webhookId);
    }
    return deliveries.slice(-limit);
  }

  getActiveWebhooks(tenantId: string): WebhookConfig[] {
    return Array.from(this.webhooks.values())
      .filter(wh => wh.tenantId === tenantId && wh.isActive);
  }
}
