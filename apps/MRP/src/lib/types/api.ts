// =============================================================================
// VietERP MRP - API TYPES
// Comprehensive TypeScript types to replace 'any'
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";

// =============================================================================
// AUTH TYPES
// =============================================================================

export type UserRole =
  | "admin"
  | "manager"
  | "supervisor"
  | "operator"
  | "viewer";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  department?: string;
  permissions: string[];
}

export interface AuthContext {
  user: AuthUser;
  requestId: string;
}

// =============================================================================
// API ROUTE TYPES
// =============================================================================

export interface RouteContext {
  params: Record<string, string>;
}

export interface AuthenticatedRouteContext extends RouteContext {
  user: AuthUser;
}

export type ApiHandler<TParams = Record<string, string>> = (
  request: NextRequest,
  context: { params: TParams },
) => Promise<NextResponse>;

export type AuthenticatedApiHandler<TParams = Record<string, string>> = (
  request: NextRequest,
  context: { params: TParams; user: AuthUser },
) => Promise<NextResponse>;

// =============================================================================
// QUERY PARAMETER TYPES
// =============================================================================

export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder: "asc" | "desc";
}

export interface SearchParams {
  search?: string;
}

export interface DateRangeParams {
  startDate?: Date;
  endDate?: Date;
}

// =============================================================================
// PRISMA WHERE CLAUSE TYPES
// =============================================================================

export type PartWhereInput = Prisma.PartWhereInput;
export type ProductWhereInput = Prisma.ProductWhereInput;
export type SalesOrderWhereInput = Prisma.SalesOrderWhereInput;
export type WorkOrderWhereInput = Prisma.WorkOrderWhereInput;
export type InventoryWhereInput = Prisma.InventoryWhereInput;
export type NCRWhereInput = Prisma.NCRWhereInput;

// Generic where input for building queries
export interface WhereClause {
  OR?: Array<Record<string, unknown>>;
  AND?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// =============================================================================
// ENTITY TYPES
// =============================================================================

// Part
export interface PartInput {
  partNumber: string;
  name: string;
  description?: string;
  category: string;
  subCategory?: string;
  partType?: string;
  unit?: string;
  ndaaCompliant?: boolean;
  itarControlled?: boolean;
  rohsCompliant?: boolean;
  reachCompliant?: boolean;
  countryOfOrigin?: string;
  hsCode?: string;
  eccn?: string;
  lotControl?: boolean;
  serialControl?: boolean;
  shelfLifeDays?: number;
  inspectionRequired?: boolean;
  minStock?: number;
  maxStock?: number;
  reorderPoint?: number;
  safetyStock?: number;
  leadTimeDays?: number;
  critical?: boolean;
  unitCost?: number;
  standardCost?: number;
  makeOrBuy?: "MAKE" | "BUY" | "BOTH";
  manufacturer?: string;
  manufacturerPn?: string;
  drawingNumber?: string;
  primarySupplierId?: string;
  notes?: string;
  tags?: string[];
}

// Sales Order
export interface SalesOrderLineInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
}

export interface SalesOrderInput {
  customerId: string;
  orderDate?: string;
  requestedDate?: string;
  promisedDate?: string;
  status?: "DRAFT" | "PENDING" | "CONFIRMED";
  priority?: "low" | "normal" | "high" | "urgent";
  currency?: string;
  paymentTerms?: string;
  shippingMethod?: string;
  shippingAddress?: string;
  notes?: string;
  lines: SalesOrderLineInput[];
}

// Work Order
export interface WorkOrderOperationInput {
  seq: number;
  name: string;
  workCenter?: string;
  plannedHours: number;
}

export interface WorkOrderInput {
  productId: string;
  quantity: number;
  startDate?: string;
  dueDate?: string;
  status?: "DRAFT" | "RELEASED";
  priority?: "low" | "normal" | "high" | "urgent";
  workCenter?: string;
  notes?: string;
  operations?: WorkOrderOperationInput[];
}

// NCR
export interface NCRInput {
  type?: "Receiving" | "In-Process" | "Final" | "Customer";
  source?: "supplier" | "production" | "customer";
  partId?: string;
  partNumber?: string;
  partName?: string;
  quantityAffected?: number;
  description: string;
  rootCause?: string;
  disposition?: "Scrap" | "Rework" | "Return" | "Use-as-is";
  costImpact?: number;
  assignedTo?: string;
}

// Inventory Action
export type InventoryAction =
  | "receive"
  | "issue"
  | "reserve"
  | "transfer"
  | "adjust";

export interface InventoryReceiveInput {
  action: "receive";
  partId: string;
  warehouseId: string;
  quantity: number;
  lotNumber?: string;
  serialNumber?: string;
  notes?: string;
}

export interface InventoryIssueInput {
  action: "issue";
  partId: string;
  warehouseId: string;
  quantity: number;
  lotNumber?: string;
  notes?: string;
}

export interface InventoryReserveInput {
  action: "reserve";
  partId: string;
  warehouseId: string;
  quantity: number;
  notes?: string;
}

export interface InventoryTransferInput {
  action: "transfer";
  partId: string;
  warehouseId: string;
  toWarehouseId: string;
  quantity: number;
  lotNumber?: string;
  notes?: string;
}

export interface InventoryAdjustInput {
  action: "adjust";
  partId: string;
  warehouseId: string;
  quantity: number;
  lotNumber?: string;
  notes?: string;
}

export type InventoryActionInput =
  | InventoryReceiveInput
  | InventoryIssueInput
  | InventoryReserveInput
  | InventoryTransferInput
  | InventoryAdjustInput;

// BOM Line
export interface BOMLineInput {
  productId: string;
  partId: string;
  quantity: number;
  unit?: string;
  module?: string;
  critical?: boolean;
  notes?: string;
  findNumber?: number;
  referenceDesignator?: string;
  scrapPercent?: number;
  operationSeq?: number;
  revision?: string;
  effectivityDate?: string;
  alternateGroup?: string;
  isPrimary?: boolean;
  bomType?:
    | "ENGINEERING"
    | "MANUFACTURING"
    | "CONFIGURABLE"
    | "PLANNING"
    | "SERVICE";
  subAssembly?: boolean;
  phantom?: boolean;
  sequence?: number;
  positionX?: number;
  positionY?: number;
  positionZ?: number;
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: unknown;
}

// =============================================================================
// DASHBOARD TYPES
// =============================================================================

export interface DashboardKPIs {
  inventory: {
    totalParts: number;
    lowStockParts: number;
    outOfStockParts: number;
    totalValue: number;
  };
  sales: {
    totalOrders: number;
    pendingOrders: number;
    monthlyRevenue: number;
    revenueTrend: number;
  };
  production: {
    activeWorkOrders: number;
    completedMTD: number;
  };
  quality: {
    openNCRs: number;
  };
}

export interface RecentOrder {
  id: string;
  soNumber: string;
  customer: string;
  customerCode: string;
  amount: number;
  status: string;
  date: Date;
  itemCount: number;
}

export interface RecentWorkOrder {
  id: string;
  woNumber: string;
  product: string;
  sku: string;
  quantity: number;
  completed: number;
  status: string;
  dueDate: Date | null;
}

export interface DashboardData {
  kpis: DashboardKPIs;
  recentOrders: RecentOrder[];
  recentWorkOrders: RecentWorkOrder[];
  inventoryByCategory: Array<{ category: string; count: number }>;
}

// =============================================================================
// ANALYTICS TYPES
// =============================================================================

export type AnalyticsTab =
  | "overview"
  | "inventory"
  | "sales"
  | "production"
  | "quality";

export interface AnalyticsParams {
  tab: AnalyticsTab;
  period: number;
  startDate?: string;
  endDate?: string;
}

export interface OverviewAnalytics {
  kpis: {
    totalRevenue: number;
    totalOrders: number;
    completedWorkOrders: number;
    inventoryValue: number;
    avgOrderValue: number;
  };
  recentOrders: Array<{
    id: string;
    soNumber: string;
    customer: string;
    amount: number;
    status: string;
    date: Date;
  }>;
  recentWorkOrders: Array<{
    id: string;
    woNumber: string;
    product: string;
    sku: string;
    quantity: number;
    status: string;
  }>;
  alerts: {
    lowStock: number;
    overdueOrders: number;
    openNCRs: number;
  };
}

// =============================================================================
// HOOK TYPES
// =============================================================================

export interface UseDataOptions {
  refreshInterval?: number;
  revalidateOnFocus?: boolean;
}

export interface MutationResult<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Nullable<T> = T | null;

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Function types
export type AsyncFunction<
  TArgs extends unknown[] = unknown[],
  TReturn = unknown,
> = (...args: TArgs) => Promise<TReturn>;

export type Debounced<T extends (...args: Parameters<T>) => ReturnType<T>> = (
  ...args: Parameters<T>
) => void;

export type Throttled<T extends (...args: Parameters<T>) => ReturnType<T>> = (
  ...args: Parameters<T>
) => ReturnType<T> | undefined;

// =============================================================================
// LOGGER TYPES
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  userId?: string;
  requestId?: string;
}

export interface AuditLogEntry {
  action: string;
  resource: string;
  resourceId: string;
  userId: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  timestamp: Date;
}

// =============================================================================
// VALIDATION TYPES
// =============================================================================

export type ValidationResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: string;
    };

export interface FieldError {
  field: string;
  message: string;
}

// =============================================================================
// SANITIZATION TYPES
// =============================================================================

export type Primitive = string | number | boolean | null | undefined;

export type SanitizableValue =
  | Primitive
  | Date
  | Array<SanitizableValue>
  | { [key: string]: SanitizableValue };
