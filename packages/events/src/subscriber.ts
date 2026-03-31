// ============================================================
// @vierp/events - Event Subscriber
// Usage:
//   import { subscribe } from '@vierp/events/subscriber';
//   await subscribe('vierp.customer.created', 'crm-service', async (event) => {
//     console.log('New customer:', event.data);
//   });
// ============================================================

import { AckPolicy, DeliverPolicy } from 'nats';
import { getJetStream, getJetStreamManager, sc } from './connection';
import type { EventEnvelope } from '@vierp/shared';

export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => Promise<void>;

interface SubscribeOptions {
  /** Filter by tenant (optional) */
  tenantId?: string;
  /** Start from: 'new' (only future) or 'all' (replay from beginning) */
  startFrom?: 'new' | 'all';
  /** Max number of inflight messages before ack */
  maxInflight?: number;
  /** Ack wait timeout in milliseconds */
  ackWaitMs?: number;
}

/**
 * Subscribe to events with durable consumer (survives restarts)
 * @param subject - Event subject pattern (e.g., 'vierp.customer.>' for all customer events)
 * @param consumerName - Unique consumer name (e.g., 'crm-customer-sync')
 * @param handler - Async function to process each event
 * @param options - Subscription options
 */
export async function subscribe<T = unknown>(
  subject: string,
  consumerName: string,
  handler: EventHandler<T>,
  options: SubscribeOptions = {}
): Promise<{ unsubscribe: () => void }> {
  const js = await getJetStream();
  const jsm = await getJetStreamManager();

  // Determine which stream this subject belongs to
  const streamName = resolveStreamName(subject);

  // Create or get durable consumer
  try {
    await jsm.consumers.info(streamName, consumerName);
  } catch {
    await jsm.consumers.add(streamName, {
      durable_name: consumerName,
      filter_subject: subject,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: options.startFrom === 'all'
        ? DeliverPolicy.All
        : DeliverPolicy.New,
      max_ack_pending: options.maxInflight || 10,
      ack_wait: (options.ackWaitMs || 30000) * 1_000_000, // Convert to nanoseconds
    });
    console.log(`[EVENT] Created consumer: ${consumerName} on ${streamName}`);
  }

  // Subscribe and process messages
  const consumer = await js.consumers.get(streamName, consumerName);
  const messages = await consumer.consume();

  let running = true;

  (async () => {
    for await (const msg of messages) {
      if (!running) break;

      try {
        const envelope: EventEnvelope<T> = JSON.parse(sc.decode(msg.data));

        // Filter by tenant if specified
        if (options.tenantId && envelope.tenantId !== options.tenantId) {
          msg.ack();
          continue;
        }

        await handler(envelope);
        msg.ack();
      } catch (error) {
        console.error(`[EVENT] Handler error for ${subject}:`, error);
        // NAK with delay (retry after 5s)
        msg.nak(5000);
      }
    }
  })();

  console.log(`[EVENT] Subscribed to ${subject} as ${consumerName}`);

  return {
    unsubscribe: () => {
      running = false;
      messages.stop();
      console.log(`[EVENT] Unsubscribed ${consumerName} from ${subject}`);
    },
  };
}

/**
 * Resolve stream name from subject
 */
function resolveStreamName(subject: string): string {
  const mapping: Record<string, string> = {
    'vierp.customer': 'VIERP_CUSTOMERS',
    'vierp.product': 'VIERP_PRODUCTS',
    'vierp.employee': 'VIERP_EMPLOYEES',
    'vierp.order': 'VIERP_ORDERS',
    'vierp.inventory': 'VIERP_INVENTORY',
    'vierp.production': 'VIERP_PRODUCTION',
    'vierp.invoice': 'VIERP_INVOICES',
    'vierp.accounting': 'VIERP_ACCOUNTING',
    'vierp.supplier': 'VIERP_SUPPLIERS',
  };

  // Match subject prefix to stream
  for (const [prefix, stream] of Object.entries(mapping)) {
    if (subject.startsWith(prefix)) return stream;
  }

  throw new Error(`Unknown stream for subject: ${subject}`);
}
