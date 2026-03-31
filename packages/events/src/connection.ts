// ============================================================
// @vierp/events - NATS JetStream Connection Manager
// Singleton connection with auto-reconnect
// ============================================================

import { connect, NatsConnection, JetStreamClient, JetStreamManager, StringCodec } from 'nats';

let connection: NatsConnection | null = null;
let jetstream: JetStreamClient | null = null;
let jetstreamManager: JetStreamManager | null = null;

export const sc = StringCodec();

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';

/**
 * Get or create NATS connection (singleton)
 */
export async function getConnection(): Promise<NatsConnection> {
  if (connection && !connection.isClosed()) {
    return connection;
  }

  connection = await connect({
    servers: NATS_URL,
    name: `erp-${process.env.MODULE_NAME || 'unknown'}`,
    reconnect: true,
    maxReconnectAttempts: -1, // Unlimited
    reconnectTimeWait: 2000,  // 2s between attempts
    pingInterval: 30000,       // 30s ping
  });

  // Handle connection events
  (async () => {
    for await (const status of connection!.status()) {
      switch (status.type) {
        case 'reconnect':
          console.log(`[NATS] Reconnected to ${status.data}`);
          break;
        case 'disconnect':
          console.warn('[NATS] Disconnected');
          break;
        case 'error':
          console.error('[NATS] Error:', status.data);
          break;
      }
    }
  })();

  console.log(`[NATS] Connected to ${NATS_URL}`);
  return connection;
}

/**
 * Get JetStream client (for publish/subscribe with persistence)
 */
export async function getJetStream(): Promise<JetStreamClient> {
  if (jetstream) return jetstream;
  const nc = await getConnection();
  jetstream = nc.jetstream();
  return jetstream;
}

/**
 * Get JetStream Manager (for stream/consumer management)
 */
export async function getJetStreamManager(): Promise<JetStreamManager> {
  if (jetstreamManager) return jetstreamManager;
  const nc = await getConnection();
  jetstreamManager = await nc.jetstreamManager();
  return jetstreamManager;
}

/**
 * Ensure ERP streams exist (call once at app startup)
 */
export async function ensureStreams(): Promise<void> {
  const jsm = await getJetStreamManager();

  const streams = [
    { name: 'VIERP_CUSTOMERS', subjects: ['vierp.customer.>'] },
    { name: 'VIERP_PRODUCTS', subjects: ['vierp.product.>'] },
    { name: 'VIERP_EMPLOYEES', subjects: ['vierp.employee.>'] },
    { name: 'VIERP_ORDERS', subjects: ['vierp.order.>'] },
    { name: 'VIERP_INVENTORY', subjects: ['vierp.inventory.>'] },
    { name: 'VIERP_PRODUCTION', subjects: ['vierp.production.>'] },
    { name: 'VIERP_INVOICES', subjects: ['vierp.invoice.>'] },
    { name: 'VIERP_ACCOUNTING', subjects: ['vierp.accounting.>'] },
    { name: 'VIERP_SUPPLIERS', subjects: ['vierp.supplier.>'] },
  ];

  for (const stream of streams) {
    try {
      await jsm.streams.info(stream.name);
    } catch {
      // Stream doesn't exist, create it
      await jsm.streams.add({
        name: stream.name,
        subjects: stream.subjects,
        retention: 'limits' as any,
        max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
        max_bytes: 1024 * 1024 * 512, // 512MB
        storage: 'file' as any,
        num_replicas: 1,
        discard: 'old' as any,
      });
      console.log(`[NATS] Created stream: ${stream.name}`);
    }
  }
}

/**
 * Gracefully close connection
 */
export async function closeConnection(): Promise<void> {
  if (connection && !connection.isClosed()) {
    await connection.drain();
    connection = null;
    jetstream = null;
    jetstreamManager = null;
    console.log('[NATS] Connection closed');
  }
}
