// ============================================================
// @vierp/events - MRP Event Schemas
// Sự kiện từ module MRP (Lập kế hoạch sản xuất)
// ============================================================

import { z } from 'zod';

/**
 * ProductionOrderCreated - Lệnh sản xuất được tạo
 * Kích hoạt: MRP hệ thống tạo lệnh hoặc manual entry
 * Source: Ecommerce (OrderPlaced) nếu stock thấp
 */
export const ProductionOrderCreatedSchema = z.object({
  productionOrderId: z.string().min(1),
  productionOrderNumber: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string(),
  sku: z.string().optional(),
  quantity: z.number().positive().int(),
  plannedStartDate: z.string().datetime(),
  plannedEndDate: z.string().datetime(),
  sourceOrder: z.enum(['sales_order', 'ecommerce_order', 'forecast', 'replenishment']),
  sourceOrderId: z.string().optional(),
  routingId: z.string().optional(),
  bomVersion: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  costCenter: z.string().optional(),
  notes: z.string().optional(),
  billOfMaterials: z.array(z.object({
    materialId: z.string(),
    materialName: z.string(),
    quantity: z.number().positive(),
    unit: z.string(),
    wastagePercent: z.number().nonnegative().optional(),
  })).optional(),
});

export type ProductionOrderCreated = z.infer<typeof ProductionOrderCreatedSchema>;

/**
 * ProductionCompleted - Lệnh sản xuất hoàn tất
 * Kích hoạt: Sản xuất xác nhận hoàn tất lệnh
 * Flow: Trigger InventoryUpdated event
 */
export const ProductionCompletedSchema = z.object({
  productionOrderId: z.string().min(1),
  productionOrderNumber: z.string().min(1),
  productId: z.string().min(1),
  plannedQuantity: z.number().positive().int(),
  producedQuantity: z.number().positive().int(),
  scrapQuantity: z.number().nonnegative().int().default(0),
  completedDate: z.string().datetime(),
  actualStartDate: z.string().datetime().optional(),
  actualEndDate: z.string().datetime().optional(),
  downtime: z.number().nonnegative().optional(), // minutes
  qualityStatus: z.enum(['passed', 'failed', 'pending_inspection']).default('pending_inspection'),
  costActual: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export type ProductionCompleted = z.infer<typeof ProductionCompletedSchema>;

/**
 * InventoryUpdated - Tồn kho được cập nhật
 * Kích hoạt: Production completed, Sales, Adjustment
 * Broadcast: Notify accounting, ecommerce, crm
 */
export const InventoryUpdatedSchema = z.object({
  inventoryId: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string(),
  sku: z.string().optional(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  previousQuantity: z.number().int(),
  newQuantity: z.number().int(),
  quantityChanged: z.number().int(), // Positive for increase, negative for decrease
  updateType: z.enum([
    'production_complete',
    'sales_order',
    'purchase_order',
    'adjustment',
    'transfer',
    'count',
    'return',
  ]),
  referenceDocumentId: z.string().optional(),
  updateDate: z.string().datetime(),
  costPerUnit: z.number().nonnegative().optional(),
  totalValue: z.number().optional(),
  notes: z.string().optional(),
});

export type InventoryUpdated = z.infer<typeof InventoryUpdatedSchema>;

/**
 * StockLow - Tồn kho chạm ngưỡng tối thiểu
 * Kích hoạt: Hệ thống kiểm tra định kỳ
 * Flow: Alert → MRP → ProductionOrderCreated (auto-trigger hoặc manual)
 */
export const StockLowSchema = z.object({
  alertId: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string(),
  sku: z.string().optional(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  currentStock: z.number().int(),
  minimumStock: z.number().int(),
  reorderPoint: z.number().int(),
  reorderQuantity: z.number().positive().int().optional(),
  leadTimeDays: z.number().nonnegative().optional(),
  alertDate: z.string().datetime(),
  forecasted30DayUsage: z.number().positive().optional(),
  supplierSuggested: z.string().optional(),
});

export type StockLow = z.infer<typeof StockLowSchema>;

/**
 * QualityCheckPassed - Kiểm chất lượng sản phẩm đạt yêu cầu
 * Kích hoạt: QC xác nhận sản phẩm đạt chất lượng
 */
export const QualityCheckPassedSchema = z.object({
  qualityCheckId: z.string().min(1),
  productionOrderId: z.string().min(1),
  batchId: z.string().optional(),
  productId: z.string().min(1),
  productName: z.string(),
  quantityInspected: z.number().positive().int(),
  quantityApproved: z.number().positive().int(),
  defectiveQuantity: z.number().nonnegative().int(),
  defectRate: z.number().min(0).max(100).optional(),
  inspectionDate: z.string().datetime(),
  inspectorId: z.string().optional(),
  inspectorName: z.string().optional(),
  standards: z.array(z.object({
    standardName: z.string(),
    specification: z.string(),
    result: z.enum(['pass', 'fail']),
  })).optional(),
  certificateNumber: z.string().optional(),
  notes: z.string().optional(),
});

export type QualityCheckPassed = z.infer<typeof QualityCheckPassedSchema>;

/**
 * Export all MRP event schemas
 */
export const MRPEventSchemas = {
  'mrp.production_order.created': ProductionOrderCreatedSchema,
  'mrp.production.completed': ProductionCompletedSchema,
  'mrp.inventory.updated': InventoryUpdatedSchema,
  'mrp.stock.low': StockLowSchema,
  'mrp.quality_check.passed': QualityCheckPassedSchema,
} as const;
