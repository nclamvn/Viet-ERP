// ============================================================
// @vierp/events - Ecommerce Event Schemas
// Sự kiện từ module Ecommerce (Thương mại điện tử)
// ============================================================

import { z } from 'zod';

/**
 * OrderPlaced - Đơn hàng được tạo
 * Kích hoạt: Customer hoàn tất checkout
 * Flow: Check inventory → MRP (nếu stock thấp)
 */
export const OrderPlacedSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  customerId: z.string().min(1),
  customerName: z.string(),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional(),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    province: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
  billingAddress: z.object({
    street: z.string(),
    city: z.string(),
    province: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }).optional(),
  orderDate: z.string().datetime(),
  currency: z.string().default('VND'),
  subtotal: z.number().positive(),
  shippingCost: z.number().nonnegative(),
  taxAmount: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().optional(),
  totalAmount: z.number().positive(),
  lineItems: z.array(z.object({
    lineId: z.string(),
    productId: z.string(),
    productName: z.string(),
    sku: z.string().optional(),
    quantity: z.number().positive().int(),
    unitPrice: z.number().positive(),
    lineTotal: z.number().positive(),
  })),
  paymentMethod: z.enum(['credit_card', 'bank_transfer', 'wallet', 'cash_on_delivery', 'other']),
  shippingMethod: z.string(),
  notes: z.string().optional(),
});

export type OrderPlaced = z.infer<typeof OrderPlacedSchema>;

/**
 * OrderShipped - Đơn hàng được gửi đi
 * Kích hoạt: Admin xác nhận gửi hàng
 */
export const OrderShippedSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  customerId: z.string().min(1),
  shippedDate: z.string().datetime(),
  trackingNumber: z.string().optional(),
  carrier: z.string().optional(),
  estimatedDelivery: z.string().datetime().optional(),
  shippingCost: z.number().nonnegative(),
  lineItems: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive().int(),
  })).optional(),
});

export type OrderShipped = z.infer<typeof OrderShippedSchema>;

/**
 * OrderDelivered - Đơn hàng được giao
 * Kích hoạt: Hệ thống tracking xác nhận delivery hoặc manual confirmation
 */
export const OrderDeliveredSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  customerId: z.string().min(1),
  deliveredDate: z.string().datetime(),
  trackingNumber: z.string().optional(),
  recipientName: z.string().optional(),
  deliveryNotes: z.string().optional(),
});

export type OrderDelivered = z.infer<typeof OrderDeliveredSchema>;

/**
 * OrderCancelled - Đơn hàng bị hủy
 * Kích hoạt: Customer hoặc admin hủy đơn
 */
export const OrderCancelledSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  customerId: z.string().min(1),
  cancelledDate: z.string().datetime(),
  reason: z.string(),
  refundAmount: z.number().positive(),
  refundStatus: z.enum(['pending', 'processed', 'failed']).optional(),
  lineItems: z.array(z.object({
    productId: z.string(),
    quantity: z.number().positive().int(),
  })).optional(),
});

export type OrderCancelled = z.infer<typeof OrderCancelledSchema>;

/**
 * PaymentCompleted - Thanh toán đơn hàng hoàn tất
 * Kích hoạt: Payment gateway xác nhận thành công
 */
export const PaymentCompletedSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  customerId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().default('VND'),
  paymentDate: z.string().datetime(),
  paymentMethod: z.enum(['credit_card', 'bank_transfer', 'wallet', 'cash_on_delivery', 'other']),
  transactionId: z.string().optional(),
  paymentGateway: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type PaymentCompleted = z.infer<typeof PaymentCompletedSchema>;

/**
 * Export all Ecommerce event schemas
 */
export const EcommerceEventSchemas = {
  'ecommerce.order.placed': OrderPlacedSchema,
  'ecommerce.order.shipped': OrderShippedSchema,
  'ecommerce.order.delivered': OrderDeliveredSchema,
  'ecommerce.order.cancelled': OrderCancelledSchema,
  'ecommerce.payment.completed': PaymentCompletedSchema,
} as const;
