// ============================================================
// @vierp/events - Event Publisher
// Usage:
//   import { publish } from '@vierp/events/publisher';
//   await publish('vierp.customer.created', { id, name, email }, ctx);
// ============================================================

import { getJetStream, sc } from './connection';
import type { EventEnvelope } from '@vierp/shared';

/**
 * Publish an event to NATS JetStream
 * @param subject - Event subject (e.g., 'vierp.customer.created')
 * @param data - Event payload
 * @param context - Tenant and user context
 * @returns Published event envelope
 */
export async function publish<T>(
  subject: string,
  data: T,
  context: { tenantId: string; userId: string; source?: string }
): Promise<EventEnvelope<T>> {
  const js = await getJetStream();

  const envelope: EventEnvelope<T> = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`,
    type: subject,
    source: context.source || process.env.MODULE_NAME || 'unknown',
    timestamp: new Date().toISOString(),
    tenantId: context.tenantId,
    userId: context.userId,
    data,
  };

  const payload = sc.encode(JSON.stringify(envelope));
  const ack = await js.publish(subject, payload, {
    msgID: envelope.id, // Deduplication
  });

  console.log(`[EVENT] Published ${subject} → stream=${ack.stream}, seq=${ack.seq}`);
  return envelope;
}

/**
 * Batch publish multiple events
 */
export async function publishBatch<T>(
  events: Array<{ subject: string; data: T }>,
  context: { tenantId: string; userId: string; source?: string }
): Promise<EventEnvelope<T>[]> {
  const results: EventEnvelope<T>[] = [];
  for (const event of events) {
    const envelope = await publish(event.subject, event.data, context);
    results.push(envelope);
  }
  return results;
}
