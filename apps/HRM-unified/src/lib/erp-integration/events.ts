// ============================================================
// HRM Event Integration with NATS JetStream
// Publishes HR events to ERP ecosystem event bus
// ============================================================

import { publish, subscribe, ensureStreams } from '@vierp/events';
import { EVENT_SUBJECTS } from '@vierp/shared';

// ==================== Event Publishers ====================

interface EventContext {
  tenantId: string;
  userId: string;
}

/**
 * Publish an HR event to the ERP event bus
 */
export async function publishHRMEvent(
  eventType: keyof typeof HRM_EVENTS,
  data: Record<string, unknown>,
  context: EventContext
): Promise<void> {
  const subject = HRM_EVENTS[eventType];
  if (!subject) {
    console.warn(`[HRM] Unknown event type: ${eventType}`);
    return;
  }

  await publish(subject, data, { ...context, source: 'hrm' });
}

/**
 * HRM-specific event types mapped to NATS subjects
 */
const HRM_EVENTS = {
  // Employee lifecycle
  EMPLOYEE_CREATED: EVENT_SUBJECTS.EMPLOYEE.CREATED,
  EMPLOYEE_UPDATED: EVENT_SUBJECTS.EMPLOYEE.UPDATED,
  EMPLOYEE_TERMINATED: EVENT_SUBJECTS.EMPLOYEE.TERMINATED,

  // HR-specific events (extend base)
  EMPLOYEE_PROMOTED: 'erp.employee.promoted',
  EMPLOYEE_TRANSFERRED: 'erp.employee.transferred',
  LEAVE_APPROVED: 'erp.employee.leave_approved',
  PAYROLL_COMPLETED: 'erp.employee.payroll_completed',
  CONTRACT_EXPIRING: 'erp.employee.contract_expiring',
  REVIEW_COMPLETED: 'erp.employee.review_completed',
  KPI_PUBLISHED: 'erp.employee.kpi_published',
} as const;

// ==================== Event Subscribers ====================

/**
 * Subscribe to events from other ERP modules that HRM needs
 */
export async function subscribeHRMEvents(): Promise<void> {
  // Listen for customer events (to sync customer contacts as potential candidates)
  await subscribe(
    EVENT_SUBJECTS.CUSTOMER.CREATED,
    'hrm-customer-sync',
    async (event) => {
      console.log('[HRM] New customer created in CRM:', event.data);
      // Could auto-create referral source for recruitment
    }
  );

  // Listen for production events (for workforce planning)
  await subscribe(
    'erp.production.>',
    'hrm-production-listener',
    async (event) => {
      console.log('[HRM] Production event:', event.type, event.data);
      // Could trigger overtime alerts or hiring needs
    }
  );

  // Listen for accounting events (payroll integration)
  await subscribe(
    EVENT_SUBJECTS.ACCOUNTING.JOURNAL_POSTED,
    'hrm-accounting-sync',
    async (event) => {
      console.log('[HRM] Accounting journal posted:', event.data);
      // Could update payroll status
    }
  );
}

/**
 * Initialize all HRM event handlers (call at app startup)
 */
export async function initHRMEventHandlers(): Promise<void> {
  try {
    await ensureStreams();
    await subscribeHRMEvents();
    console.log('[HRM] Event handlers initialized');
  } catch (error) {
    console.error('[HRM] Failed to initialize event handlers:', error);
    // Non-fatal — HRM can work without event bus
  }
}
