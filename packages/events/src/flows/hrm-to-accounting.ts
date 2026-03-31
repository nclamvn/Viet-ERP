// ============================================================
// @vierp/events - Event Flow: HRM → Accounting
// When PayrollProcessed → auto-create JournalEntryPosted
// Creates salary expense entries
// ============================================================

import type { PayrollProcessed } from '../schemas/hrm.events';
import type { JournalEntryPosted } from '../schemas/accounting.events';
import type { BaseEvent } from '../types';

/**
 * Chart of Accounts codes (simplified)
 * Bảng tài khoản (đơn giản)
 */
const ChartOfAccounts = {
  SALARY_EXPENSE: '6101', // Salary Expense
  PAYROLL_PAYABLE: '2101', // Payroll Payable
  INCOME_TAX_PAYABLE: '2102', // Income Tax Payable
  SOCIAL_INSURANCE_PAYABLE: '2103', // Social Insurance Payable
  HEALTH_INSURANCE_PAYABLE: '2104', // Health Insurance Payable
  CASH_BANK: '1001', // Cash at Bank
};

const AccountNames = {
  [ChartOfAccounts.SALARY_EXPENSE]: 'Salary Expense',
  [ChartOfAccounts.PAYROLL_PAYABLE]: 'Salaries Payable',
  [ChartOfAccounts.INCOME_TAX_PAYABLE]: 'Income Tax Payable',
  [ChartOfAccounts.SOCIAL_INSURANCE_PAYABLE]: 'Social Insurance Payable',
  [ChartOfAccounts.HEALTH_INSURANCE_PAYABLE]: 'Health Insurance Payable',
  [ChartOfAccounts.CASH_BANK]: 'Cash at Bank',
};

/**
 * Map PayrollProcessed event to JournalEntryPosted
 * Chuyển đổi sự kiện PayrollProcessed sang JournalEntryPosted
 *
 * Creates accounting entries:
 * Dr. Salary Expense → Cr. Salaries Payable (gross salary)
 * Dr. Income Tax Payable → Cr. Salaries Payable (income tax)
 * Dr. Social/Health Insurance → Cr. Salaries Payable (insurance)
 * Dr. Cash at Bank → Cr. Salaries Payable (actual payment)
 */
export async function mapPayrollToJournalEntry(
  payrollEvent: BaseEvent<PayrollProcessed>
): Promise<JournalEntryPosted> {
  const { payload } = payrollEvent;

  const journalDate = new Date();
  const journalNumber = `JE-PAY-${payload.payrollNumber}`;

  // Build journal lines
  const journalLines = [];

  // Group by department for cost center allocation
  const byDepartment: Record<string, { gross: number; tax: number; contributions: number }> = {};

  for (const emp of payload.employees) {
    const dept = emp.department || 'GENERAL';
    if (!byDepartment[dept]) {
      byDepartment[dept] = { gross: 0, tax: 0, contributions: 0 };
    }
    byDepartment[dept].gross += emp.grossSalary;
    byDepartment[dept].tax += emp.incomeTax;
    byDepartment[dept].contributions +=
      emp.socialInsurance + emp.healthInsurance + emp.unemploymentInsurance;
  }

  // Create lines for each department
  let lineCounter = 0;

  for (const [dept, amounts] of Object.entries(byDepartment)) {
    // Debit: Salary Expense
    journalLines.push({
      lineId: `line-${++lineCounter}`,
      accountCode: ChartOfAccounts.SALARY_EXPENSE,
      accountName: AccountNames[ChartOfAccounts.SALARY_EXPENSE],
      description: `Salary for ${payload.payrollPeriod.startDate.split('T')[0]} - Department: ${dept}`,
      debitAmount: amounts.gross,
      creditAmount: 0,
      departmentCode: dept,
      costCenterCode: dept,
    });
  }

  // Credit: Salaries Payable (total net salary)
  journalLines.push({
    lineId: `line-${++lineCounter}`,
    accountCode: ChartOfAccounts.PAYROLL_PAYABLE,
    accountName: AccountNames[ChartOfAccounts.PAYROLL_PAYABLE],
    description: `Net salaries payable for payroll ${payload.payrollNumber}`,
    debitAmount: 0,
    creditAmount: payload.totalNetSalary,
  });

  // Income Tax Payable
  if (payload.totalIncomeTax > 0) {
    journalLines.push({
      lineId: `line-${++lineCounter}`,
      accountCode: ChartOfAccounts.INCOME_TAX_PAYABLE,
      accountName: AccountNames[ChartOfAccounts.INCOME_TAX_PAYABLE],
      description: `Income tax withheld for payroll ${payload.payrollNumber}`,
      debitAmount: 0,
      creditAmount: payload.totalIncomeTax,
    });
  }

  // Social/Health Insurance Payable
  if (payload.totalSocialContributions > 0) {
    journalLines.push({
      lineId: `line-${++lineCounter}`,
      accountCode: ChartOfAccounts.SOCIAL_INSURANCE_PAYABLE,
      accountName: AccountNames[ChartOfAccounts.SOCIAL_INSURANCE_PAYABLE],
      description: `Social insurance contributions for payroll ${payload.payrollNumber}`,
      debitAmount: 0,
      creditAmount: payload.totalSocialContributions,
    });
  }

  // Build journal entry
  const totalDebit = payload.totalGrossSalary;
  const totalCredit = payload.totalNetSalary + payload.totalIncomeTax + payload.totalSocialContributions;

  const journalEntry: JournalEntryPosted = {
    journalEntryId: `je-${Date.now()}`,
    journalNumber,
    journalDate: journalDate.toISOString(),
    postDate: payload.paymentDate || journalDate.toISOString(),
    description: `Payroll Journal Entry - ${payload.payrollNumber}`,
    sourceEvent: 'payroll',
    sourceDocumentId: payload.payrollId,
    totalDebit,
    totalCredit,
    currency: payload.currency,
    lines: journalLines,
    notes: `Auto-generated from payroll processing. Total employees: ${payload.employees.length}`,
    postedBy: payload.approvedBy || 'system',
  };

  return journalEntry;
}

/**
 * Event flow metadata for HRM → Accounting
 */
export const HRMToAccountingFlow = {
  triggers: ['hrm.payroll.processed'],
  target: 'accounting.journal.posted',
  mapper: mapPayrollToJournalEntry,
};

/**
 * Validate journal entry from payroll
 */
export function validatePayrollJournal(entry: JournalEntryPosted): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!entry.journalEntryId) {
    errors.push('Missing journalEntryId');
  }

  if (!entry.journalNumber) {
    errors.push('Missing journalNumber');
  }

  if (entry.lines.length < 2) {
    errors.push('Journal entry must have at least 2 lines');
  }

  // Check that debits equal credits
  const totalDebit = entry.lines.reduce((sum, line) => sum + line.debitAmount, 0);
  const totalCredit = entry.lines.reduce((sum, line) => sum + line.creditAmount, 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    errors.push(
      `Debits (${totalDebit.toFixed(2)}) do not equal credits (${totalCredit.toFixed(2)})`
    );
  }

  // Verify no account has both debit and credit
  for (const line of entry.lines) {
    if (line.debitAmount > 0 && line.creditAmount > 0) {
      errors.push(`Line ${line.lineId}: Account cannot have both debit and credit`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get account reconciliation info
 * Thông tin đối soát tài khoản
 */
export function getAccountReconciliation(entry: JournalEntryPosted): {
  accountCode: string;
  debitTotal: number;
  creditTotal: number;
} | null {
  const byAccount: Record<string, { debit: number; credit: number }> = {};

  for (const line of entry.lines) {
    if (!byAccount[line.accountCode]) {
      byAccount[line.accountCode] = { debit: 0, credit: 0 };
    }
    byAccount[line.accountCode].debit += line.debitAmount;
    byAccount[line.accountCode].credit += line.creditAmount;
  }

  // Find unbalanced accounts
  for (const [accountCode, amounts] of Object.entries(byAccount)) {
    if (amounts.debit !== amounts.credit) {
      return {
        accountCode,
        debitTotal: amounts.debit,
        creditTotal: amounts.credit,
      };
    }
  }

  return null;
}
