// ============================================================
// @vierp/events - Event Schemas Index
// Re-export all event schemas
// ============================================================

// CRM Schemas
export {
  LeadCreatedSchema,
  LeadScoredSchema,
  LeadConvertedSchema,
  DealWonSchema,
  DealLostSchema,
  CRMEventSchemas,
} from './crm.events';
export type {
  LeadCreated,
  LeadScored,
  LeadConverted,
  DealWon,
  DealLost,
} from './crm.events';

// Accounting Schemas
export {
  InvoiceCreatedSchema,
  InvoiceApprovedSchema,
  InvoicePaidSchema,
  PaymentReceivedSchema,
  JournalEntryPostedSchema,
  AccountingEventSchemas,
} from './accounting.events';
export type {
  InvoiceCreated,
  InvoiceApproved,
  InvoicePaid,
  PaymentReceived,
  JournalEntryPosted,
} from './accounting.events';

// Ecommerce Schemas
export {
  OrderPlacedSchema,
  OrderShippedSchema,
  OrderDeliveredSchema,
  OrderCancelledSchema,
  PaymentCompletedSchema,
  EcommerceEventSchemas,
} from './ecommerce.events';
export type {
  OrderPlaced,
  OrderShipped,
  OrderDelivered,
  OrderCancelled,
  PaymentCompleted,
} from './ecommerce.events';

// MRP Schemas
export {
  ProductionOrderCreatedSchema,
  ProductionCompletedSchema,
  InventoryUpdatedSchema,
  StockLowSchema,
  QualityCheckPassedSchema,
  MRPEventSchemas,
} from './mrp.events';
export type {
  ProductionOrderCreated,
  ProductionCompleted,
  InventoryUpdated,
  StockLow,
  QualityCheckPassed,
} from './mrp.events';

// HRM Schemas
export {
  EmployeeOnboardedSchema,
  LeaveRequestedSchema,
  LeaveApprovedSchema,
  PayrollProcessedSchema,
  AttendanceRecordedSchema,
  HRMEventSchemas,
} from './hrm.events';
export type {
  EmployeeOnboarded,
  LeaveRequested,
  LeaveApproved,
  PayrollProcessed,
  AttendanceRecorded,
} from './hrm.events';

/**
 * Unified event schema registry
 * Dùng để lookup schema theo event type
 */
export const AllEventSchemas = {
  ...CRMEventSchemas,
  ...AccountingEventSchemas,
  ...EcommerceEventSchemas,
  ...MRPEventSchemas,
  ...HRMEventSchemas,
} as const;

export type AllEventTypes =
  | keyof typeof CRMEventSchemas
  | keyof typeof AccountingEventSchemas
  | keyof typeof EcommerceEventSchemas
  | keyof typeof MRPEventSchemas
  | keyof typeof HRMEventSchemas;
