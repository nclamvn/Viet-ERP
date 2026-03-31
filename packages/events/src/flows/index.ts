// ============================================================
// @vierp/events - Event Flows Index
// Re-export all event flow definitions
// ============================================================

export {
  mapDealWonToInvoice,
  CRMToAccountingFlow,
  validateInvoiceMapping,
} from './crm-to-accounting';

export {
  checkInventoryAndCreateProductionOrder,
  mapProductionCompletedToInventory,
  EcommerceToMRPFlows,
  validateProductionOrder,
  validateInventoryUpdate,
} from './ecommerce-to-mrp';

export {
  mapPayrollToJournalEntry,
  HRMToAccountingFlow,
  validatePayrollJournal,
  getAccountReconciliation,
} from './hrm-to-accounting';

/**
 * All registered event flows
 * Các luồng sự kiện đã đăng ký
 */
export const AllEventFlows = [
  // CRM → Accounting
  {
    id: 'crm-to-accounting-deal-to-invoice',
    triggers: ['crm.deal.won'],
    target: 'accounting.invoice.created',
    mapper: (event: any) => require('./crm-to-accounting').mapDealWonToInvoice(event),
    description: 'Auto-create invoice when deal is won',
  },

  // Ecommerce → MRP
  {
    id: 'ecommerce-to-mrp-order-inventory',
    triggers: ['ecommerce.order.placed'],
    target: 'mrp.production_order.created',
    mapper: (event: any) => require('./ecommerce-to-mrp').checkInventoryAndCreateProductionOrder(event),
    description: 'Check inventory and create production order if stock is low',
  },

  {
    id: 'mrp-production-to-inventory',
    triggers: ['mrp.production.completed'],
    target: 'mrp.inventory.updated',
    mapper: (event: any) => require('./ecommerce-to-mrp').mapProductionCompletedToInventory(event),
    description: 'Update inventory when production is completed',
  },

  // HRM → Accounting
  {
    id: 'hrm-to-accounting-payroll-journal',
    triggers: ['hrm.payroll.processed'],
    target: 'accounting.journal.posted',
    mapper: (event: any) => require('./hrm-to-accounting').mapPayrollToJournalEntry(event),
    description: 'Auto-create journal entries from payroll processing',
  },
];

/**
 * Get flows triggered by event type
 * Lấy các flow được kích hoạt bởi event type
 */
export function getFlowsByTrigger(eventType: string) {
  return AllEventFlows.filter((flow) => flow.triggers.includes(eventType));
}

/**
 * Flow registry for runtime lookup
 */
export const FlowRegistry = new Map(
  AllEventFlows.map((flow) => [flow.id, flow])
);
