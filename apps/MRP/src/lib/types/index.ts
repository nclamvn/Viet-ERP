// =============================================================================
// VietERP MRP - COMPREHENSIVE TYPE DEFINITIONS
// Shared types to eliminate 'any' usage across the codebase
// =============================================================================

import { Prisma } from ".prisma/mrp-client";

// =============================================================================
// BASE TYPES
// =============================================================================

export type ID = string;
export type DateString = string;
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONObject
  | JSONArray;
export interface JSONObject {
  [key: string]: JSONValue;
}
export type JSONArray = JSONValue[];

// =============================================================================
// API TYPES
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
  timestamp?: string;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface FilterParams {
  [key: string]: string | number | boolean | string[] | undefined;
}

// =============================================================================
// USER & AUTH TYPES
// =============================================================================

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tenantId: string;
  image?: string | null;
  emailVerified?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER" | "GUEST";

export interface Session {
  user: User;
  expires: string;
  accessToken?: string;
}

export interface AuthContext {
  session: Session | null;
  user: User | null;
  tenantId: string;
  userId: string;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isManager: boolean;
}

// =============================================================================
// ENTITY TYPES
// =============================================================================

export interface Part {
  id: string;
  partNumber: string;
  name: string;
  description?: string | null;
  category: string;
  subCategory?: string | null;
  unit: string;
  unitCost: number;
  status: PartStatus;
  makeOrBuy: MakeOrBuy;
  critical: boolean;
  minStock: number;
  reorderPoint: number;
  safetyStock: number;
  leadTimeDays: number;
  primarySupplierId?: string | null;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PartStatus =
  | "DEVELOPMENT"
  | "PROTOTYPE"
  | "ACTIVE"
  | "PHASE_OUT"
  | "OBSOLETE"
  | "EOL";
export type MakeOrBuy = "MAKE" | "BUY" | "BOTH";

export interface Inventory {
  id: string;
  partId: string;
  warehouseId: string;
  quantity: number;
  reservedQty: number;
  availableQty: number;
  lotNumber?: string | null;
  location?: string | null;
  lastCountDate?: Date | null;
  tenantId: string;
  part?: Part;
  warehouse?: Warehouse;
}

import type { WarehouseType } from "@/types";
export type { WarehouseType };

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: WarehouseType;
  address?: string | null;
  isActive: boolean;
  tenantId: string;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  country?: string | null;
  currency: string;
  paymentTerms?: string | null;
  creditLimit?: number | null;
  isActive: boolean;
  tenantId: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  country?: string | null;
  currency: string;
  paymentTerms?: string | null;
  leadTimeDays: number;
  rating?: number | null;
  isActive: boolean;
  isApproved: boolean;
  tenantId: string;
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  status: SalesOrderStatus;
  priority: Priority;
  orderDate: Date;
  requestedDate?: Date | null;
  promisedDate?: Date | null;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  notes?: string | null;
  tenantId: string;
  customer?: Customer;
  lines?: SalesOrderLine[];
}

export type SalesOrderStatus =
  | "DRAFT"
  | "PENDING"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "SHIPPED"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED";

export type Priority = "low" | "normal" | "high" | "urgent";

export interface SalesOrderLine {
  id: string;
  salesOrderId: string;
  partId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  part?: Part;
}

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  productId: string;
  status: WorkOrderStatus;
  priority: Priority;
  quantity: number;
  completedQty: number;
  scrapQty: number;
  startDate?: Date | null;
  dueDate?: Date | null;
  completedDate?: Date | null;
  workCenter?: string | null;
  notes?: string | null;
  tenantId: string;
  product?: Part;
  operations?: WorkOrderOperation[];
}

export type WorkOrderStatus =
  | "DRAFT"
  | "RELEASED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "COMPLETED"
  | "CLOSED"
  | "CANCELLED";

export interface WorkOrderOperation {
  id: string;
  workOrderId: string;
  sequence: number;
  name: string;
  workCenter?: string | null;
  plannedHours: number;
  actualHours: number;
  status: OperationStatus;
}

export type OperationStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "SKIPPED";

export interface BOMLine {
  id: string;
  productId: string;
  partId: string;
  quantity: number;
  unit: string;
  sequence: number;
  critical: boolean;
  scrapPercent: number;
  notes?: string | null;
  tenantId: string;
  product?: Part;
  part?: Part;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  orderDate: Date;
  expectedDate?: Date | null;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  notes?: string | null;
  tenantId: string;
  supplier?: Supplier;
  lines?: PurchaseOrderLine[];
}

export type PurchaseOrderStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "SENT"
  | "CONFIRMED"
  | "PARTIAL"
  | "RECEIVED"
  | "CLOSED"
  | "CANCELLED";

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  partId: string;
  quantity: number;
  receivedQty: number;
  unitPrice: number;
  total: number;
  part?: Part;
}

// =============================================================================
// MRP TYPES
// =============================================================================

export interface MRPRun {
  id: string;
  runDate: Date;
  status: MRPRunStatus;
  parameters: MRPParameters;
  tenantId: string;
  createdBy: string;
  suggestions?: MRPSuggestion[];
}

export type MRPRunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface MRPParameters {
  startDate: string;
  endDate: string;
  planningHorizon: number;
  includeDemand: boolean;
  includeSupply: boolean;
  includeWIP: boolean;
  includeForecasts: boolean;
}

export interface MRPSuggestion {
  id: string;
  mrpRunId: string;
  partId: string;
  suggestionType: MRPSuggestionType;
  quantity: number;
  dueDate: Date;
  priority: Priority;
  reason: string;
  status: MRPSuggestionStatus;
  part?: Part;
}

export type MRPSuggestionType =
  | "PURCHASE"
  | "MANUFACTURE"
  | "RESCHEDULE_IN"
  | "RESCHEDULE_OUT"
  | "CANCEL"
  | "EXPEDITE";

export type MRPSuggestionStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "PROCESSED";

// =============================================================================
// QUALITY TYPES
// =============================================================================

export interface NCR {
  id: string;
  ncrNumber: string;
  type: NCRType;
  source: NCRSource;
  status: NCRStatus;
  severity: NCRSeverity;
  partId?: string | null;
  quantityAffected: number;
  description: string;
  rootCause?: string | null;
  disposition?: NCRDisposition | null;
  costImpact?: number | null;
  assignedTo?: string | null;
  tenantId: string;
  part?: Part;
}

export type NCRType = "Receiving" | "In-Process" | "Final" | "Customer";
export type NCRSource = "supplier" | "production" | "customer";
export type NCRStatus = "open" | "in_progress" | "pending_review" | "closed";
export type NCRSeverity = "minor" | "major" | "critical";
export type NCRDisposition = "Scrap" | "Rework" | "Return" | "Use-as-is";

export interface QualityMeasurement {
  id: string;
  partId: string;
  characteristic: string;
  nominalValue: number;
  upperLimit: number;
  lowerLimit: number;
  measuredValue: number;
  isPass: boolean;
  measuredAt: Date;
  measuredBy: string;
  tenantId: string;
}

// =============================================================================
// DASHBOARD & ANALYTICS TYPES
// =============================================================================

export interface DashboardKPIs {
  inventory: {
    totalValue: number;
    lowStockCount: number;
    criticalCount: number;
    turnoverRate: number;
  };
  sales: {
    totalOrders: number;
    pendingOrders: number;
    totalRevenue: number;
    avgOrderValue: number;
  };
  production: {
    totalWorkOrders: number;
    inProgressCount: number;
    completedToday: number;
    oeePercent: number;
  };
  quality: {
    openNCRs: number;
    defectRate: number;
    firstPassYield: number;
    customerComplaints: number;
  };
}

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string;
  fill?: boolean;
}

export interface TimeSeriesData {
  date: string;
  value: number;
  label?: string;
}

// =============================================================================
// FORM & UI TYPES
// =============================================================================

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface TableColumn<T = unknown> {
  key: keyof T | string;
  header: string;
  sortable?: boolean;
  width?: string | number;
  align?: "left" | "center" | "right";
  render?: (value: unknown, row: T) => React.ReactNode;
}

export interface TableState {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder: "asc" | "desc";
  search: string;
  filters: Record<string, unknown>;
}

export interface FormField {
  name: string;
  label: string;
  type:
    | "text"
    | "number"
    | "email"
    | "password"
    | "select"
    | "textarea"
    | "checkbox"
    | "date";
  required?: boolean;
  placeholder?: string;
  options?: SelectOption[];
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

// =============================================================================
// EVENT & NOTIFICATION TYPES
// =============================================================================

export interface AppEvent {
  id: string;
  type: EventType;
  entityType: string;
  entityId: string;
  action: string;
  data?: JSONObject;
  userId: string;
  tenantId: string;
  timestamp: Date;
}

export type EventType =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "STATUS_CHANGE"
  | "ALERT"
  | "SYSTEM";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  link?: string;
  userId: string;
  createdAt: Date;
}

export type NotificationType =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "alert";

// =============================================================================
// EXPORT
// =============================================================================

export type { Prisma };
