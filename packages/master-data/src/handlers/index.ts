// ============================================================
// @vierp/master-data - Event Handlers
// Bootstrap all NATS event listeners for master data sync
// ============================================================

import { ensureStreams } from '@vierp/events';
import { startCustomerHandlers } from './customer.handler';
import { startProductHandlers } from './product.handler';
import { startEmployeeHandlers } from './employee.handler';

/**
 * Initialize all master data event handlers.
 * Call this once at application startup.
 *
 * Flow:
 * 1. Ensure NATS JetStream streams exist
 * 2. Start durable consumers for each entity type
 * 3. Begin listening for events from all modules
 */
export async function startMasterDataSync(): Promise<void> {
  console.log('[MASTER-DATA] Initializing sync engine...');

  // Ensure streams exist
  await ensureStreams();

  // Start all entity handlers in parallel
  await Promise.all([
    startCustomerHandlers(),
    startProductHandlers(),
    startEmployeeHandlers(),
  ]);

  console.log('[MASTER-DATA] Sync engine ready — listening for events from all modules');
}

export { startCustomerHandlers } from './customer.handler';
export { startProductHandlers } from './product.handler';
export { startEmployeeHandlers } from './employee.handler';
