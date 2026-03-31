// ============================================================
// Accounting Module — ERP Integration Layer
// Subscribes to events from MRP, OTB, HRM, TPM
// Auto-generates journal entries from business events
// ============================================================

import { subscribe, publish } from '@vierp/events';
import { EVENT_SUBJECTS } from '@vierp/shared';
import type { GLJournalEntry } from '../gl-engine';
import { validateJournalEntry } from '../gl-engine';
import { generateAPJournalEntry, generateARJournalEntry, calculateInvoice } from '../invoice-engine';

// ==================== Default VAS Account IDs ====================
// These would be resolved from the Chart of Accounts at runtime

const DEFAULT_ACCOUNTS = {
  CASH_VND: '1111',           // TK 111 - Tiền mặt VND
  BANK_VND: '1121',           // TK 112 - Tiền gửi NH VND
  ACCOUNTS_RECEIVABLE: '131', // TK 131 - Phải thu khách hàng
  INPUT_VAT: '1331',          // TK 133 - Thuế GTGT đầu vào
  RAW_MATERIALS: '152',       // TK 152 - Nguyên vật liệu
  WIP: '154',                 // TK 154 - Chi phí SXKD dở dang
  FINISHED_GOODS: '155',      // TK 155 - Thành phẩm
  MERCHANDISE: '156',         // TK 156 - Hàng hóa
  ACCOUNTS_PAYABLE: '331',    // TK 331 - Phải trả người bán
  OUTPUT_VAT: '33311',        // TK 3331 - Thuế GTGT đầu ra
  PAYROLL_PAYABLE: '3341',    // TK 334 - Phải trả NLĐ
  BHXH_PAYABLE: '3383',       // TK 3383 - BHXH
  BHYT_PAYABLE: '3384',       // TK 3384 - BHYT
  BHTN_PAYABLE: '3386',       // TK 3386 - BHTN
  UNION_PAYABLE: '3382',      // TK 3382 - Kinh phí công đoàn
  SALES_REVENUE: '5111',      // TK 511 - Doanh thu bán hàng
  SERVICE_REVENUE: '5113',    // TK 5113 - DT cung cấp dịch vụ
  DIRECT_MATERIAL: '621',     // TK 621 - CP NVL trực tiếp
  DIRECT_LABOR: '622',        // TK 622 - CP nhân công TT
  OVERHEAD: '627',            // TK 627 - CP sản xuất chung
  COGS: '632',                // TK 632 - Giá vốn hàng bán
  SELLING_EXPENSE: '641',     // TK 641 - CP bán hàng
  ADMIN_EXPENSE: '642',       // TK 642 - CP QLDN
};

// ==================== Event Handlers ====================

const CONSUMER_PREFIX = 'accounting';

/**
 * Start all accounting event subscriptions
 */
export async function startAccountingEventHandlers(): Promise<void> {
  console.log('[ACCOUNTING] Starting event handlers...');

  await Promise.all([
    // MRP events
    subscribeToProductionEvents(),
    subscribeToInventoryEvents(),
    // CRM/OTB events
    subscribeToOrderEvents(),
    subscribeToInvoiceEvents(),
    // HRM events
    subscribeToPayrollEvents(),
  ]);

  console.log('[ACCOUNTING] Event handlers ready — listening for business events');
}

// ==================== Production Events (from MRP) ====================

async function subscribeToProductionEvents(): Promise<void> {
  // Production completed → COGS journal entry
  await subscribe(
    EVENT_SUBJECTS.PRODUCTION.COMPLETED,
    `${CONSUMER_PREFIX}-production-completed`,
    async (event) => {
      const data = event.data as Record<string, unknown>;
      console.log(`[ACCOUNTING] Production completed: ${data.workOrderNumber}`);

      // Generate journal: Debit 155 (Finished Goods), Credit 154 (WIP)
      const journalEntry: GLJournalEntry = {
        entryDate: new Date(),
        journalType: 'GENERAL',
        source: 'SYSTEM',
        sourceModule: 'mrp',
        sourceRef: data.workOrderId as string,
        description: `Nhập kho thành phẩm - LSX ${data.workOrderNumber}`,
        lines: [
          {
            accountId: DEFAULT_ACCOUNTS.FINISHED_GOODS,
            description: `Thành phẩm từ LSX ${data.workOrderNumber}`,
            debitAmount: (data.totalCost as number) || 0,
            creditAmount: 0,
            productId: data.productId as string,
          },
          {
            accountId: DEFAULT_ACCOUNTS.WIP,
            description: `Kết chuyển CP SXKD dở dang - LSX ${data.workOrderNumber}`,
            debitAmount: 0,
            creditAmount: (data.totalCost as number) || 0,
          },
        ],
      };

      await postAutoJournal(journalEntry, event.tenantId, event.userId);
    }
  );
}

// ==================== Inventory Events (from MRP/OTB) ====================

async function subscribeToInventoryEvents(): Promise<void> {
  // Low stock → Generate purchase requisition alert
  await subscribe(
    EVENT_SUBJECTS.INVENTORY.UPDATED,
    `${CONSUMER_PREFIX}-inventory-updated`,
    async (event) => {
      // Log for now — future: auto-accrue inventory valuation adjustments
      const data = event.data as Record<string, unknown>;
      console.log(`[ACCOUNTING] Inventory updated: ${data.productCode} qty=${data.quantity}`);
    }
  );
}

// ==================== Order Events (from CRM/OTB) ====================

async function subscribeToOrderEvents(): Promise<void> {
  // Order completed → Revenue recognition + COGS
  await subscribe(
    EVENT_SUBJECTS.ORDER.COMPLETED,
    `${CONSUMER_PREFIX}-order-completed`,
    async (event) => {
      const data = event.data as Record<string, unknown>;
      console.log(`[ACCOUNTING] Order completed: ${data.orderNumber}`);

      const totalAmount = (data.totalAmount as number) || 0;
      const costAmount = (data.totalCost as number) || 0;

      // Revenue recognition: Debit 131, Credit 511 + 33311
      const vatRate = 0.10;
      const revenue = totalAmount / (1 + vatRate);
      const vat = totalAmount - revenue;

      const journalEntry: GLJournalEntry = {
        entryDate: new Date(),
        journalType: 'SALES',
        source: 'SYSTEM',
        sourceModule: data.sourceModule as string || 'crm',
        sourceRef: data.orderId as string,
        description: `Ghi nhận doanh thu - ĐH ${data.orderNumber}`,
        lines: [
          {
            accountId: DEFAULT_ACCOUNTS.ACCOUNTS_RECEIVABLE,
            debitAmount: totalAmount,
            creditAmount: 0,
            customerId: data.customerId as string,
          },
          {
            accountId: DEFAULT_ACCOUNTS.SALES_REVENUE,
            debitAmount: 0,
            creditAmount: revenue,
          },
          {
            accountId: DEFAULT_ACCOUNTS.OUTPUT_VAT,
            debitAmount: 0,
            creditAmount: vat,
          },
        ],
      };

      await postAutoJournal(journalEntry, event.tenantId, event.userId);

      // COGS: Debit 632, Credit 155/156
      if (costAmount > 0) {
        const cogsEntry: GLJournalEntry = {
          entryDate: new Date(),
          journalType: 'GENERAL',
          source: 'SYSTEM',
          sourceModule: data.sourceModule as string || 'crm',
          sourceRef: data.orderId as string,
          description: `Giá vốn hàng bán - ĐH ${data.orderNumber}`,
          lines: [
            {
              accountId: DEFAULT_ACCOUNTS.COGS,
              debitAmount: costAmount,
              creditAmount: 0,
            },
            {
              accountId: DEFAULT_ACCOUNTS.FINISHED_GOODS,
              debitAmount: 0,
              creditAmount: costAmount,
            },
          ],
        };

        await postAutoJournal(cogsEntry, event.tenantId, event.userId);
      }
    }
  );
}

// ==================== Invoice Events (from modules) ====================

async function subscribeToInvoiceEvents(): Promise<void> {
  // Invoice paid → Cash receipt / payment journal
  await subscribe(
    EVENT_SUBJECTS.INVOICE.PAID,
    `${CONSUMER_PREFIX}-invoice-paid`,
    async (event) => {
      const data = event.data as Record<string, unknown>;
      console.log(`[ACCOUNTING] Invoice paid: ${data.invoiceNumber}`);

      const amount = (data.amount as number) || 0;
      const type = (data.invoiceType as string) === 'purchase' ? 'AP' : 'AR';
      const isAP = type === 'AP';

      const journalEntry: GLJournalEntry = {
        entryDate: new Date(),
        journalType: isAP ? 'CASH_PAYMENT' : 'CASH_RECEIPT',
        source: 'SYSTEM',
        sourceModule: 'accounting',
        sourceRef: data.paymentId as string,
        description: isAP
          ? `Thanh toán HĐ ${data.invoiceNumber}`
          : `Thu tiền HĐ ${data.invoiceNumber}`,
        lines: [
          {
            accountId: isAP ? DEFAULT_ACCOUNTS.ACCOUNTS_PAYABLE : DEFAULT_ACCOUNTS.BANK_VND,
            debitAmount: amount,
            creditAmount: 0,
            ...(isAP
              ? { supplierId: data.supplierId as string }
              : { customerId: data.customerId as string }),
          },
          {
            accountId: isAP ? DEFAULT_ACCOUNTS.BANK_VND : DEFAULT_ACCOUNTS.ACCOUNTS_RECEIVABLE,
            debitAmount: 0,
            creditAmount: amount,
            ...(isAP
              ? { supplierId: data.supplierId as string }
              : { customerId: data.customerId as string }),
          },
        ],
      };

      await postAutoJournal(journalEntry, event.tenantId, event.userId);
    }
  );
}

// ==================== Payroll Events (from HRM) ====================

async function subscribeToPayrollEvents(): Promise<void> {
  // Payroll completed → Salary journal entries
  await subscribe(
    'erp.employee.payroll_completed',
    `${CONSUMER_PREFIX}-payroll-completed`,
    async (event) => {
      const data = event.data as Record<string, unknown>;
      console.log(`[ACCOUNTING] Payroll completed: period=${data.period}`);

      const grossSalary = (data.totalGrossSalary as number) || 0;
      const insuranceEmployee = (data.totalInsuranceEmployee as number) || 0;
      const pitAmount = (data.totalPIT as number) || 0;
      const netSalary = (data.totalNetSalary as number) || 0;
      const insuranceEmployer = (data.totalInsuranceEmployer as number) || 0;

      // Journal 1: Salary expense
      // Debit: 622/627/641/642 (by department type)
      // Credit: 334 (Payroll payable)
      const salaryEntry: GLJournalEntry = {
        entryDate: new Date(),
        journalType: 'PAYROLL',
        source: 'SYSTEM',
        sourceModule: 'hrm',
        sourceRef: data.payrollId as string,
        description: `Chi phí lương kỳ ${data.period}`,
        lines: [
          {
            accountId: DEFAULT_ACCOUNTS.ADMIN_EXPENSE, // Simplified — should split by dept
            description: 'Chi phí lương',
            debitAmount: grossSalary,
            creditAmount: 0,
          },
          {
            accountId: DEFAULT_ACCOUNTS.PAYROLL_PAYABLE,
            description: 'Lương phải trả NLĐ',
            debitAmount: 0,
            creditAmount: grossSalary,
          },
        ],
      };

      await postAutoJournal(salaryEntry, event.tenantId, event.userId);

      // Journal 2: Insurance deductions from employee
      if (insuranceEmployee > 0) {
        const insuranceDeductEntry: GLJournalEntry = {
          entryDate: new Date(),
          journalType: 'PAYROLL',
          source: 'SYSTEM',
          sourceModule: 'hrm',
          description: `Trích BHXH, BHYT, BHTN phần NLĐ - Kỳ ${data.period}`,
          lines: [
            {
              accountId: DEFAULT_ACCOUNTS.PAYROLL_PAYABLE,
              description: 'Trừ BH phần NLĐ',
              debitAmount: insuranceEmployee,
              creditAmount: 0,
            },
            {
              accountId: DEFAULT_ACCOUNTS.BHXH_PAYABLE,
              debitAmount: 0,
              creditAmount: insuranceEmployee * 0.76, // ~8% of 10.5%
            },
            {
              accountId: DEFAULT_ACCOUNTS.BHYT_PAYABLE,
              debitAmount: 0,
              creditAmount: insuranceEmployee * 0.143, // ~1.5% of 10.5%
            },
            {
              accountId: DEFAULT_ACCOUNTS.BHTN_PAYABLE,
              debitAmount: 0,
              creditAmount: insuranceEmployee * 0.095, // ~1% of 10.5%
            },
          ],
        };

        await postAutoJournal(insuranceDeductEntry, event.tenantId, event.userId);
      }
    }
  );
}

// ==================== Helper ====================

/**
 * Validate and queue a journal entry for posting
 * In production, this would write to the DB and optionally auto-post
 */
async function postAutoJournal(
  entry: GLJournalEntry,
  tenantId: string,
  userId: string
): Promise<void> {
  const validation = validateJournalEntry(entry);

  if (!validation.valid) {
    console.error(`[ACCOUNTING] Invalid auto-journal: ${validation.errors.join(', ')}`);
    return;
  }

  // Publish event that journal is ready for posting
  try {
    await publish(EVENT_SUBJECTS.ACCOUNTING.JOURNAL_POSTED, {
      ...entry,
      tenantId,
      userId,
      autoGenerated: true,
      status: 'PENDING', // Auto-journals go to PENDING for review
    }, { tenantId, userId, source: 'accounting' });

    console.log(`[ACCOUNTING] Auto-journal queued: ${entry.description}`);
  } catch (error) {
    console.error(`[ACCOUNTING] Failed to publish journal:`, error);
  }
}

export { DEFAULT_ACCOUNTS };
