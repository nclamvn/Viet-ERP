// ============================================================
// @vierp/master-data - Customer Event Handler
// Listens for customer events from CRM, OTB, Accounting
// Syncs to master data store
// ============================================================

import { subscribe } from '@vierp/events';
import { EVENT_SUBJECTS } from '@vierp/shared';
import { customerService } from '../services/customer.service';
import type { SyncResult } from '../types';

const CONSUMER_PREFIX = 'master-data-customer';

/**
 * Start listening for customer events from all modules
 */
export async function startCustomerHandlers(): Promise<void> {
  // Customer Created — from CRM, OTB, or any module
  await subscribe(
    EVENT_SUBJECTS.CUSTOMER.CREATED,
    `${CONSUMER_PREFIX}-created`,
    async (event) => {
      console.log(`[MASTER-DATA] Customer created event from ${event.source}:`, event.data);

      try {
        const data = event.data as Record<string, unknown>;

        // Skip if event originated from master-data (avoid loops)
        if (event.source === 'master-data') return;

        // Check if customer already exists by code
        const code = data.code as string;
        if (code) {
          const existing = await customerService.getByCode(code, event.tenantId);
          if (existing) {
            // Update instead of create
            await customerService.update(existing.id, data as any, {
              tenantId: event.tenantId,
              userId: event.userId,
              source: event.source,
            });
            logSync({ success: true, entity: 'customer', entityId: existing.id, action: 'update', sourceModule: event.source });
            return;
          }
        }

        const { record } = await customerService.create(data as any, {
          tenantId: event.tenantId,
          userId: event.userId,
          source: event.source,
        });
        logSync({ success: true, entity: 'customer', entityId: record.id, action: 'create', sourceModule: event.source });
      } catch (error) {
        console.error(`[MASTER-DATA] Failed to sync customer created:`, error);
        logSync({ success: false, entity: 'customer', entityId: '', action: 'create', sourceModule: event.source, error: String(error) });
      }
    }
  );

  // Customer Updated
  await subscribe(
    EVENT_SUBJECTS.CUSTOMER.UPDATED,
    `${CONSUMER_PREFIX}-updated`,
    async (event) => {
      console.log(`[MASTER-DATA] Customer updated event from ${event.source}`);

      if (event.source === 'master-data') return;

      try {
        const data = event.data as Record<string, unknown>;
        const id = data.id as string;

        if (!id) {
          console.warn('[MASTER-DATA] Customer update event missing ID');
          return;
        }

        await customerService.update(id, data as any, {
          tenantId: event.tenantId,
          userId: event.userId,
          source: event.source,
        });
        logSync({ success: true, entity: 'customer', entityId: id, action: 'update', sourceModule: event.source });
      } catch (error) {
        console.error(`[MASTER-DATA] Failed to sync customer update:`, error);
      }
    }
  );

  // Customer Deleted
  await subscribe(
    EVENT_SUBJECTS.CUSTOMER.DELETED,
    `${CONSUMER_PREFIX}-deleted`,
    async (event) => {
      console.log(`[MASTER-DATA] Customer deleted event from ${event.source}`);

      if (event.source === 'master-data') return;

      try {
        const data = event.data as Record<string, unknown>;
        const id = data.id as string;

        if (!id) return;

        await customerService.delete(id, {
          tenantId: event.tenantId,
          userId: event.userId,
          source: event.source,
        });
        logSync({ success: true, entity: 'customer', entityId: id, action: 'delete', sourceModule: event.source });
      } catch (error) {
        console.error(`[MASTER-DATA] Failed to sync customer delete:`, error);
      }
    }
  );

  console.log('[MASTER-DATA] Customer handlers started');
}

function logSync(result: SyncResult): void {
  const status = result.success ? '✓' : '✗';
  console.log(`[MASTER-DATA-SYNC] ${status} ${result.entity}/${result.entityId} ${result.action} from ${result.sourceModule}${result.error ? ` — ${result.error}` : ''}`);
}
