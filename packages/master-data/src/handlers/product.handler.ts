// ============================================================
// @vierp/master-data - Product Event Handler
// Listens for product events from MRP, OTB, Inventory
// ============================================================

import { subscribe } from '@vierp/events';
import { EVENT_SUBJECTS } from '@vierp/shared';
import { productService } from '../services/product.service';
import type { SyncResult } from '../types';

const CONSUMER_PREFIX = 'master-data-product';

export async function startProductHandlers(): Promise<void> {
  // Product Created
  await subscribe(
    EVENT_SUBJECTS.PRODUCT.CREATED,
    `${CONSUMER_PREFIX}-created`,
    async (event) => {
      if (event.source === 'master-data') return;

      try {
        const data = event.data as Record<string, unknown>;
        const code = data.code as string;

        if (code) {
          const existing = await productService.getByCode(code, event.tenantId);
          if (existing) {
            await productService.update(existing.id, data as any, {
              tenantId: event.tenantId,
              userId: event.userId,
              source: event.source,
            });
            logSync({ success: true, entity: 'product', entityId: existing.id, action: 'update', sourceModule: event.source });
            return;
          }
        }

        const { record } = await productService.create(data as any, {
          tenantId: event.tenantId,
          userId: event.userId,
          source: event.source,
        });
        logSync({ success: true, entity: 'product', entityId: record.id, action: 'create', sourceModule: event.source });
      } catch (error) {
        console.error(`[MASTER-DATA] Failed to sync product created:`, error);
        logSync({ success: false, entity: 'product', entityId: '', action: 'create', sourceModule: event.source, error: String(error) });
      }
    }
  );

  // Product Updated
  await subscribe(
    EVENT_SUBJECTS.PRODUCT.UPDATED,
    `${CONSUMER_PREFIX}-updated`,
    async (event) => {
      if (event.source === 'master-data') return;

      try {
        const data = event.data as Record<string, unknown>;
        const id = data.id as string;
        if (!id) return;

        await productService.update(id, data as any, {
          tenantId: event.tenantId,
          userId: event.userId,
          source: event.source,
        });
        logSync({ success: true, entity: 'product', entityId: id, action: 'update', sourceModule: event.source });
      } catch (error) {
        console.error(`[MASTER-DATA] Failed to sync product update:`, error);
      }
    }
  );

  // Product Deleted
  await subscribe(
    EVENT_SUBJECTS.PRODUCT.DELETED,
    `${CONSUMER_PREFIX}-deleted`,
    async (event) => {
      if (event.source === 'master-data') return;

      try {
        const data = event.data as Record<string, unknown>;
        const id = data.id as string;
        if (!id) return;

        await productService.delete(id, {
          tenantId: event.tenantId,
          userId: event.userId,
          source: event.source,
        });
        logSync({ success: true, entity: 'product', entityId: id, action: 'delete', sourceModule: event.source });
      } catch (error) {
        console.error(`[MASTER-DATA] Failed to sync product delete:`, error);
      }
    }
  );

  console.log('[MASTER-DATA] Product handlers started');
}

function logSync(result: SyncResult): void {
  const status = result.success ? '✓' : '✗';
  console.log(`[MASTER-DATA-SYNC] ${status} ${result.entity}/${result.entityId} ${result.action} from ${result.sourceModule}${result.error ? ` — ${result.error}` : ''}`);
}
