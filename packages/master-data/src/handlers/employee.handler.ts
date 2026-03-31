// ============================================================
// @vierp/master-data - Employee Event Handler
// Listens for employee events from HRM
// ============================================================

import { subscribe } from '@vierp/events';
import { EVENT_SUBJECTS } from '@vierp/shared';
import { employeeService } from '../services/employee.service';
import type { SyncResult } from '../types';

const CONSUMER_PREFIX = 'master-data-employee';

export async function startEmployeeHandlers(): Promise<void> {
  // Employee Created — primarily from HRM
  await subscribe(
    EVENT_SUBJECTS.EMPLOYEE.CREATED,
    `${CONSUMER_PREFIX}-created`,
    async (event) => {
      if (event.source === 'master-data') return;

      try {
        const data = event.data as Record<string, unknown>;
        const code = data.code as string;

        if (code) {
          const existing = await employeeService.getByCode(code, event.tenantId);
          if (existing) {
            await employeeService.update(existing.id, data as any, {
              tenantId: event.tenantId,
              userId: event.userId,
              source: event.source,
            });
            logSync({ success: true, entity: 'employee', entityId: existing.id, action: 'update', sourceModule: event.source });
            return;
          }
        }

        const { record } = await employeeService.create(data as any, {
          tenantId: event.tenantId,
          userId: event.userId,
          source: event.source,
        });
        logSync({ success: true, entity: 'employee', entityId: record.id, action: 'create', sourceModule: event.source });
      } catch (error) {
        console.error(`[MASTER-DATA] Failed to sync employee created:`, error);
        logSync({ success: false, entity: 'employee', entityId: '', action: 'create', sourceModule: event.source, error: String(error) });
      }
    }
  );

  // Employee Updated
  await subscribe(
    EVENT_SUBJECTS.EMPLOYEE.UPDATED,
    `${CONSUMER_PREFIX}-updated`,
    async (event) => {
      if (event.source === 'master-data') return;

      try {
        const data = event.data as Record<string, unknown>;
        const id = data.id as string;
        if (!id) return;

        await employeeService.update(id, data as any, {
          tenantId: event.tenantId,
          userId: event.userId,
          source: event.source,
        });
        logSync({ success: true, entity: 'employee', entityId: id, action: 'update', sourceModule: event.source });
      } catch (error) {
        console.error(`[MASTER-DATA] Failed to sync employee update:`, error);
      }
    }
  );

  // Employee Terminated
  await subscribe(
    EVENT_SUBJECTS.EMPLOYEE.TERMINATED,
    `${CONSUMER_PREFIX}-terminated`,
    async (event) => {
      if (event.source === 'master-data') return;

      try {
        const data = event.data as Record<string, unknown>;
        const id = data.id as string;
        if (!id) return;

        await employeeService.delete(id, {
          tenantId: event.tenantId,
          userId: event.userId,
          source: event.source,
        });
        logSync({ success: true, entity: 'employee', entityId: id, action: 'delete', sourceModule: event.source });
      } catch (error) {
        console.error(`[MASTER-DATA] Failed to sync employee termination:`, error);
      }
    }
  );

  console.log('[MASTER-DATA] Employee handlers started');
}

function logSync(result: SyncResult): void {
  const status = result.success ? '✓' : '✗';
  console.log(`[MASTER-DATA-SYNC] ${status} ${result.entity}/${result.entityId} ${result.action} from ${result.sourceModule}${result.error ? ` — ${result.error}` : ''}`);
}
