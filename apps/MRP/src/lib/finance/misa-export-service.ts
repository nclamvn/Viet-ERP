// src/lib/finance/misa-export-service.ts
// R18: Export financial data to MISA accounting software format

import { prisma } from "@/lib/prisma";
import type { JournalStatus } from ".prisma/mrp-client";

// Standard Vietnamese accounting chart of accounts (Thông tư 200/2014/TT-BTC)
const MISA_ACCOUNT_MAP: Record<string, { code: string; nameVi: string }> = {
  // Assets
  "1111": { code: "1111", nameVi: "Tiền mặt VND" },
  "1121": { code: "1121", nameVi: "Tiền gửi ngân hàng VND" },
  "131": { code: "131", nameVi: "Phải thu khách hàng" },
  "152": { code: "152", nameVi: "Nguyên liệu, vật liệu" },
  "153": { code: "153", nameVi: "Công cụ, dụng cụ" },
  "155": { code: "155", nameVi: "Thành phẩm" },
  "156": { code: "156", nameVi: "Hàng hóa" },
  // Liabilities
  "331": { code: "331", nameVi: "Phải trả người bán" },
  "334": { code: "334", nameVi: "Phải trả người lao động" },
  // Revenue & Expenses
  "511": { code: "511", nameVi: "Doanh thu bán hàng" },
  "621": { code: "621", nameVi: "Chi phí nguyên vật liệu trực tiếp" },
  "622": { code: "622", nameVi: "Chi phí nhân công trực tiếp" },
  "627": { code: "627", nameVi: "Chi phí sản xuất chung" },
  "632": { code: "632", nameVi: "Giá vốn hàng bán" },
  "641": { code: "641", nameVi: "Chi phí bán hàng" },
  "642": { code: "642", nameVi: "Chi phí quản lý doanh nghiệp" },
};

interface MISAJournalEntry {
  ngayHachToan: string; // Posting date (dd/MM/yyyy)
  ngayChungTu: string; // Document date
  soChungTu: string; // Document number
  dienGiai: string; // Description
  tkNo: string; // Debit account
  tkCo: string; // Credit account
  soTien: number; // Amount
  doiTuong: string; // Object (customer/supplier code)
  maHang: string; // Item code
  dvt: string; // Unit
  soLuong: number; // Quantity
  donGia: number; // Unit price
}

interface MISAExportResult {
  success: boolean;
  format: "csv" | "xml";
  entries: MISAJournalEntry[];
  totalEntries: number;
  totalDebit: number;
  totalCredit: number;
  period: { from: Date; to: Date };
  errors: string[];
}

/**
 * Export journal entries to MISA-compatible format.
 * Covers the specified date range and maps internal accounts to MISA COA.
 */
export async function exportToMISA(
  fromDate: Date,
  toDate: Date,
  options?: {
    includePosted?: boolean; // Only posted entries (default true)
    includeDraft?: boolean; // Include draft entries
  },
): Promise<MISAExportResult> {
  const errors: string[] = [];
  const statusFilter: JournalStatus[] = [];

  if (options?.includePosted !== false) statusFilter.push("POSTED");
  if (options?.includeDraft) statusFilter.push("DRAFT");

  const journalEntries = await prisma.journalEntry.findMany({
    where: {
      entryDate: { gte: fromDate, lte: toDate },
      status: { in: statusFilter },
    },
    include: {
      lines: {
        include: {
          account: {
            select: { accountNumber: true, name: true },
          },
        },
      },
    },
    orderBy: { entryDate: "asc" },
  });

  const misaEntries: MISAJournalEntry[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const entry of journalEntries) {
    // Group lines into debit/credit pairs
    const debitLines = entry.lines.filter((l) => l.debitAmount > 0);
    const creditLines = entry.lines.filter((l) => l.creditAmount > 0);

    // For each debit-credit pair, create a MISA entry
    for (const debit of debitLines) {
      for (const credit of creditLines) {
        const amount = Math.min(debit.debitAmount, credit.creditAmount);
        if (amount <= 0) continue;

        const debitCode = debit.account.accountNumber;
        const creditCode = credit.account.accountNumber;

        misaEntries.push({
          ngayHachToan: formatDateVN(entry.postingDate),
          ngayChungTu: formatDateVN(entry.entryDate),
          soChungTu: entry.entryNumber,
          dienGiai: entry.description,
          tkNo: mapToMISACode(debitCode),
          tkCo: mapToMISACode(creditCode),
          soTien: amount,
          doiTuong: entry.sourceId || "",
          maHang: "",
          dvt: "",
          soLuong: 0,
          donGia: 0,
        });

        totalDebit += amount;
        totalCredit += amount;
      }
    }
  }

  return {
    success: true,
    format: "csv",
    entries: misaEntries,
    totalEntries: misaEntries.length,
    totalDebit,
    totalCredit,
    period: { from: fromDate, to: toDate },
    errors,
  };
}

/**
 * Export purchase invoices to MISA format (AP vouchers).
 */
export async function exportPurchaseInvoicesToMISA(
  fromDate: Date,
  toDate: Date,
): Promise<MISAJournalEntry[]> {
  const invoices = await prisma.purchaseInvoice.findMany({
    where: {
      invoiceDate: { gte: fromDate, lte: toDate },
      status: { not: "VOID" },
    },
    include: {
      supplier: { select: { code: true, name: true } },
      lines: {
        include: {
          part: { select: { partNumber: true, unit: true } },
        },
      },
    },
    orderBy: { invoiceDate: "asc" },
  });

  const entries: MISAJournalEntry[] = [];

  for (const inv of invoices) {
    for (const line of inv.lines) {
      entries.push({
        ngayHachToan: formatDateVN(inv.invoiceDate),
        ngayChungTu: formatDateVN(inv.invoiceDate),
        soChungTu: inv.invoiceNumber,
        dienGiai: `Mua hàng - ${inv.supplier.name} - ${line.description}`,
        tkNo: mapToMISACode("152"), // Raw materials
        tkCo: mapToMISACode("331"), // Accounts payable
        soTien: line.quantity * line.unitPrice,
        doiTuong: inv.supplier.code,
        maHang: line.part?.partNumber || "",
        dvt: line.part?.unit || "pcs",
        soLuong: line.quantity,
        donGia: line.unitPrice,
      });
    }

    // Tax entry if applicable
    if (inv.taxAmount > 0) {
      entries.push({
        ngayHachToan: formatDateVN(inv.invoiceDate),
        ngayChungTu: formatDateVN(inv.invoiceDate),
        soChungTu: inv.invoiceNumber,
        dienGiai: `VAT - ${inv.supplier.name}`,
        tkNo: "1331", // VAT receivable
        tkCo: mapToMISACode("331"),
        soTien: inv.taxAmount,
        doiTuong: inv.supplier.code,
        maHang: "",
        dvt: "",
        soLuong: 0,
        donGia: 0,
      });
    }
  }

  return entries;
}

/**
 * Export sales invoices to MISA format (AR vouchers).
 */
export async function exportSalesInvoicesToMISA(
  fromDate: Date,
  toDate: Date,
): Promise<MISAJournalEntry[]> {
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      invoiceDate: { gte: fromDate, lte: toDate },
      status: { not: "VOID" },
    },
    include: {
      customer: { select: { code: true, name: true } },
      lines: {
        include: {
          product: { select: { sku: true } },
        },
      },
    },
    orderBy: { invoiceDate: "asc" },
  });

  const entries: MISAJournalEntry[] = [];

  for (const inv of invoices) {
    for (const line of inv.lines) {
      // Revenue entry
      entries.push({
        ngayHachToan: formatDateVN(inv.invoiceDate),
        ngayChungTu: formatDateVN(inv.invoiceDate),
        soChungTu: inv.invoiceNumber,
        dienGiai: `Bán hàng - ${inv.customer.name} - ${line.description}`,
        tkNo: mapToMISACode("131"), // Accounts receivable
        tkCo: mapToMISACode("511"), // Revenue
        soTien: line.quantity * line.unitPrice,
        doiTuong: inv.customer.code,
        maHang: line.product?.sku || "",
        dvt: line.uom || "EA",
        soLuong: line.quantity,
        donGia: line.unitPrice,
      });
    }

    // Tax entry
    if (inv.taxAmount > 0) {
      entries.push({
        ngayHachToan: formatDateVN(inv.invoiceDate),
        ngayChungTu: formatDateVN(inv.invoiceDate),
        soChungTu: inv.invoiceNumber,
        dienGiai: `VAT - ${inv.customer.name}`,
        tkNo: mapToMISACode("131"),
        tkCo: "33311", // VAT payable
        soTien: inv.taxAmount,
        doiTuong: inv.customer.code,
        maHang: "",
        dvt: "",
        soLuong: 0,
        donGia: 0,
      });
    }
  }

  return entries;
}

/**
 * Generate MISA-compatible CSV content from journal entries.
 */
export function generateMISACSV(entries: MISAJournalEntry[]): string {
  const header = [
    "Ngày hạch toán",
    "Ngày chứng từ",
    "Số chứng từ",
    "Diễn giải",
    "TK Nợ",
    "TK Có",
    "Số tiền",
    "Đối tượng",
    "Mã hàng",
    "ĐVT",
    "Số lượng",
    "Đơn giá",
  ].join(",");

  const rows = entries.map((e) =>
    [
      e.ngayHachToan,
      e.ngayChungTu,
      `"${e.soChungTu}"`,
      `"${e.dienGiai.replace(/"/g, '""')}"`,
      e.tkNo,
      e.tkCo,
      e.soTien.toFixed(2),
      `"${e.doiTuong}"`,
      `"${e.maHang}"`,
      `"${e.dvt}"`,
      e.soLuong || "",
      e.donGia || "",
    ].join(","),
  );

  return [header, ...rows].join("\n");
}

// ---- Helpers ----

function formatDateVN(date: Date): string {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function mapToMISACode(internalCode: string): string {
  return MISA_ACCOUNT_MAP[internalCode]?.code || internalCode;
}
