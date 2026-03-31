// ============================================================
// @vierp/events - Accounting Event Schemas
// Sự kiện từ module Accounting (Kế toán)
// ============================================================

import { z } from 'zod';

/**
 * InvoiceCreated - Tạo mới hóa đơn
 * Kích hoạt: Tạo hóa đơn từ sales order hoặc manual entry
 * Source: CRM (DealWon) hoặc Ecommerce (OrderPlaced)
 */
export const InvoiceCreatedSchema = z.object({
  invoiceId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  customerId: z.string().min(1),
  customerName: z.string(),
  customerEmail: z.string().email().optional(),
  orderRef: z.string().optional(), // Reference to sales order or e-commerce order
  invoiceDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  currency: z.string().default('VND'),
  totalAmount: z.number().positive(),
  taxAmount: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().optional(),
  lineItems: z.array(z.object({
    lineId: z.string(),
    description: z.string(),
    quantity: z.number().positive(),
    unitPrice: z.number().positive(),
    lineTotal: z.number().positive(),
    taxCode: z.string().optional(),
  })),
  notes: z.string().optional(),
});

export type InvoiceCreated = z.infer<typeof InvoiceCreatedSchema>;

/**
 * InvoiceApproved - Hóa đơn được phê duyệt
 * Kích hoạt: Người dùng phê duyệt hóa đơn
 */
export const InvoiceApprovedSchema = z.object({
  invoiceId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  customerId: z.string().min(1),
  totalAmount: z.number().positive(),
  currency: z.string().default('VND'),
  approvedBy: z.string().min(1),
  approvedDate: z.string().datetime(),
  approvalNotes: z.string().optional(),
});

export type InvoiceApproved = z.infer<typeof InvoiceApprovedSchema>;

/**
 * InvoicePaid - Hóa đơn được thanh toán
 * Kích hoạt: Thanh toán được ghi nhận
 */
export const InvoicePaidSchema = z.object({
  invoiceId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  customerId: z.string().min(1),
  amountPaid: z.number().positive(),
  currency: z.string().default('VND'),
  paymentDate: z.string().datetime(),
  paymentMethod: z.enum(['bank_transfer', 'check', 'cash', 'credit_card', 'other']),
  referenceNumber: z.string().optional(),
  remainingBalance: z.number().nonnegative(),
});

export type InvoicePaid = z.infer<typeof InvoicePaidSchema>;

/**
 * PaymentReceived - Thanh toán được nhận
 * Kích hoạt: Ghi nhận thanh toán từ customer
 * Source: Manual entry hoặc bank integration
 */
export const PaymentReceivedSchema = z.object({
  paymentId: z.string().min(1),
  customerId: z.string().min(1),
  customerName: z.string(),
  amount: z.number().positive(),
  currency: z.string().default('VND'),
  paymentDate: z.string().datetime(),
  paymentMethod: z.enum(['bank_transfer', 'check', 'cash', 'credit_card', 'other']),
  bankAccount: z.string().optional(),
  referenceNumber: z.string().optional(),
  invoiceIds: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type PaymentReceived = z.infer<typeof PaymentReceivedSchema>;

/**
 * JournalEntryPosted - Bút toán được ghi nhập
 * Kích hoạt: Bút toán được tạo và post
 * Source: Accounting module hoặc từ events khác (e.g., Payroll → Expense)
 */
export const JournalEntryPostedSchema = z.object({
  journalEntryId: z.string().min(1),
  journalNumber: z.string().min(1),
  journalDate: z.string().datetime(),
  postDate: z.string().datetime().optional(),
  description: z.string(),
  sourceEvent: z.enum([
    'sales_invoice',
    'purchase_invoice',
    'payment',
    'payroll',
    'inventory',
    'depreciation',
    'accrual',
    'other',
  ]),
  sourceDocumentId: z.string().optional(),
  totalDebit: z.number().positive(),
  totalCredit: z.number().positive(),
  currency: z.string().default('VND'),
  lines: z.array(z.object({
    lineId: z.string(),
    accountCode: z.string(),
    accountName: z.string(),
    description: z.string().optional(),
    debitAmount: z.number().nonnegative(),
    creditAmount: z.number().nonnegative(),
    departmentCode: z.string().optional(),
    costCenterCode: z.string().optional(),
  })).min(2),
  notes: z.string().optional(),
  postedBy: z.string().optional(),
});

export type JournalEntryPosted = z.infer<typeof JournalEntryPostedSchema>;

/**
 * Export all Accounting event schemas
 */
export const AccountingEventSchemas = {
  'accounting.invoice.created': InvoiceCreatedSchema,
  'accounting.invoice.approved': InvoiceApprovedSchema,
  'accounting.invoice.paid': InvoicePaidSchema,
  'accounting.payment.received': PaymentReceivedSchema,
  'accounting.journal.posted': JournalEntryPostedSchema,
} as const;
