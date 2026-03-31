// ============================================================
// @vierp/events - Event Flow: CRM → Accounting
// When DealWon → auto-create InvoiceCreated
// ============================================================

import type { DealWon } from '../schemas/crm.events';
import type { InvoiceCreated } from '../schemas/accounting.events';
import type { BaseEvent } from '../types';

/**
 * Map DealWon event to InvoiceCreated payload
 * Chuyển đổi sự kiện DealWon sang InvoiceCreated
 *
 * Logic:
 * - Deal amount → Invoice total
 * - Customer info → Billing info
 * - Products → Invoice line items
 * - Deal description → Invoice notes
 */
export async function mapDealWonToInvoice(
  dealWonEvent: BaseEvent<DealWon>
): Promise<InvoiceCreated> {
  const { payload } = dealWonEvent;

  // Generate invoice number based on deal
  const invoiceNumber = `INV-${dealWonEvent.timestamp.split('-')[0]}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  // Calculate invoice date and due date
  const invoiceDate = new Date();
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + 30); // Net 30

  // Build invoice payload
  const invoicePayload: InvoiceCreated = {
    invoiceId: `inv-${Date.now()}`,
    invoiceNumber,
    customerId: payload.customerId,
    customerName: payload.customerName,
    customerEmail: payload.customerEmail,
    orderRef: payload.dealId,
    invoiceDate: invoiceDate.toISOString(),
    dueDate: dueDate.toISOString(),
    currency: payload.currency,
    totalAmount: payload.amount,
    taxAmount: 0,
    discountAmount: 0,
    lineItems: payload.products?.map((product, index) => ({
      lineId: `line-${index}`,
      description: product.name,
      quantity: product.quantity,
      unitPrice: product.unitPrice,
      lineTotal: product.lineTotal,
      taxCode: 'VAT10',
    })) || [
      {
        lineId: 'line-0',
        description: payload.dealDescription || 'Sales from Deal',
        quantity: 1,
        unitPrice: payload.amount,
        lineTotal: payload.amount,
        taxCode: 'VAT10',
      },
    ],
    notes: payload.dealDescription
      ? `From CRM Deal: ${payload.dealDescription}`
      : 'Generated from CRM Deal Won event',
  };

  return invoicePayload;
}

/**
 * Event flow metadata for CRM → Accounting
 */
export const CRMToAccountingFlow = {
  triggers: ['crm.deal.won'],
  target: 'accounting.invoice.created',
  mapper: mapDealWonToInvoice,
};

/**
 * Validate mapping output
 * Kiểm tra output của mapping
 */
export function validateInvoiceMapping(invoice: InvoiceCreated): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!invoice.invoiceId) {
    errors.push('Missing invoiceId');
  }

  if (!invoice.invoiceNumber) {
    errors.push('Missing invoiceNumber');
  }

  if (!invoice.customerId) {
    errors.push('Missing customerId');
  }

  if (invoice.totalAmount <= 0) {
    errors.push('Total amount must be positive');
  }

  if (invoice.lineItems.length === 0) {
    errors.push('Invoice must have at least one line item');
  }

  // Verify line items sum to total
  const lineTotal = invoice.lineItems.reduce((sum, line) => sum + line.lineTotal, 0);
  const expectedTotal = invoice.totalAmount + (invoice.taxAmount || 0) - (invoice.discountAmount || 0);

  if (Math.abs(lineTotal - expectedTotal) > 0.01) {
    errors.push(
      `Line items total (${lineTotal}) does not match expected amount (${expectedTotal})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
