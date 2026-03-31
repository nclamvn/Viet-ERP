// ============================================================
// @vierp/events - Event Flow: Ecommerce → MRP
// OrderPlaced: Check inventory → ProductionOrderCreated if stock low
// ProductionCompleted → InventoryUpdated
// ============================================================

import type { OrderPlaced } from '../schemas/ecommerce.events';
import type { ProductionOrderCreated, InventoryUpdated } from '../schemas/mrp.events';
import type { BaseEvent } from '../types';

/**
 * Check if we need to create production order for ordered items
 * Kiểm tra xem có cần tạo lệnh sản xuất hay không
 *
 * Logic:
 * - For each line item in order
 * - Check current stock level
 * - If stock < minimum + ordered qty → trigger production order
 */
export async function checkInventoryAndCreateProductionOrder(
  orderPlacedEvent: BaseEvent<OrderPlaced>
): Promise<ProductionOrderCreated[]> {
  const { payload } = orderPlacedEvent;

  const productionOrders: ProductionOrderCreated[] = [];

  // This would normally query inventory service
  // For now, we create production orders for items that need replenishment
  for (const lineItem of payload.lineItems) {
    // Simulate inventory check
    const estimatedStockLevel = Math.random() * 100;
    const minimumStock = 50;
    const requiredQuantity = lineItem.quantity;

    if (estimatedStockLevel < minimumStock + requiredQuantity) {
      const productionOrder: ProductionOrderCreated = {
        productionOrderId: `po-${Date.now()}-${lineItem.productId}`,
        productionOrderNumber: `PO-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
        productId: lineItem.productId,
        productName: lineItem.productName,
        sku: lineItem.sku,
        quantity: Math.ceil(requiredQuantity * 1.1), // 10% buffer
        plannedStartDate: new Date().toISOString(),
        plannedEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        sourceOrder: 'ecommerce_order',
        sourceOrderId: payload.orderId,
        priority: 'high',
        notes: `Production triggered by ecommerce order ${payload.orderNumber}`,
      };

      productionOrders.push(productionOrder);
    }
  }

  return productionOrders;
}

/**
 * Map ProductionCompleted to InventoryUpdated
 * Chuyển đổi ProductionCompleted sang InventoryUpdated
 *
 * When production completes:
 * - Add produced quantity to warehouse stock
 * - Update stock valuation
 * - Trigger inventory events
 */
export async function mapProductionCompletedToInventory(
  productionCompletedEvent: BaseEvent<any>
): Promise<InventoryUpdated> {
  const { payload } = productionCompletedEvent;

  // This would normally query product and warehouse details
  const inventoryUpdate: InventoryUpdated = {
    inventoryId: `inv-${Date.now()}`,
    productId: payload.productId,
    productName: '', // Would be fetched from master data
    sku: '',
    warehouseId: 'MAIN_WAREHOUSE',
    warehouseName: 'Main Warehouse',
    previousQuantity: 0, // Would be queried
    newQuantity: payload.producedQuantity,
    quantityChanged: payload.producedQuantity,
    updateType: 'production_complete',
    referenceDocumentId: payload.productionOrderId,
    updateDate: payload.completedDate,
    notes: `Production order ${payload.productionOrderNumber} completed`,
  };

  return inventoryUpdate;
}

/**
 * Event flow metadata for Ecommerce → MRP
 */
export const EcommerceToMRPFlows = [
  {
    triggers: ['ecommerce.order.placed'],
    target: 'mrp.production_order.created',
    mapper: checkInventoryAndCreateProductionOrder,
  },
  {
    triggers: ['mrp.production.completed'],
    target: 'mrp.inventory.updated',
    mapper: mapProductionCompletedToInventory,
  },
];

/**
 * Validate production order
 */
export function validateProductionOrder(order: ProductionOrderCreated): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!order.productionOrderId) {
    errors.push('Missing productionOrderId');
  }

  if (!order.productId) {
    errors.push('Missing productId');
  }

  if (order.quantity <= 0) {
    errors.push('Quantity must be positive');
  }

  const startDate = new Date(order.plannedStartDate);
  const endDate = new Date(order.plannedEndDate);

  if (endDate <= startDate) {
    errors.push('Planned end date must be after start date');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate inventory update
 */
export function validateInventoryUpdate(inventory: InventoryUpdated): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!inventory.productId) {
    errors.push('Missing productId');
  }

  if (!inventory.warehouseId) {
    errors.push('Missing warehouseId');
  }

  if (inventory.newQuantity < 0) {
    errors.push('New quantity cannot be negative');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
