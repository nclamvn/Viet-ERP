// src/services/bank-payment.service.ts
// Bank Payment Batch Service

import { db } from "@/lib/db";
import type {
  Prisma,
  PayrollStatus,
  BankCode,
} from ".prisma/hrm-unified-client";
import type { PaginatedResponse } from "@/types";
import {
  generateBankFile,
  createPaymentRecords,
  generateBatchNumber,
  groupRecordsByBank,
  type BankFileFormat,
  type GeneratedFile,
  type BankFileOptions,
} from "@/lib/payroll/bank-file-generator";

export interface BankPaymentFilters {
  periodId?: string;
  bankCode?: BankCode;
  status?: PayrollStatus;
  page?: number;
  pageSize?: number;
}

export interface BankPaymentWithRelations {
  id: string;
  tenantId: string;
  periodId: string;
  batchNumber: string;
  bankCode: BankCode;
  bankName: string;
  totalRecords: number;
  totalAmount: Prisma.Decimal;
  fileName: string | null;
  fileUrl: string | null;
  fileFormat: string | null;
  status: PayrollStatus;
  generatedAt: Date | null;
  processedAt: Date | null;
  processedBy: string | null;
  bankReference: string | null;
  successCount: number | null;
  failedCount: number | null;
  bankResponseFile: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  period: {
    id: string;
    name: string;
    year: number;
    month: number;
  };
  processor: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export const bankPaymentService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Find all bank payment batches with filters
   */
  async findAll(
    tenantId: string,
    filters: BankPaymentFilters = {},
  ): Promise<PaginatedResponse<BankPaymentWithRelations>> {
    const { periodId, bankCode, status, page = 1, pageSize = 20 } = filters;

    const where: Prisma.BankPaymentBatchWhereInput = {
      tenantId,
      ...(periodId && { periodId }),
      ...(bankCode && { bankCode }),
      ...(status && { status }),
    };

    const [data, total] = await Promise.all([
      db.bankPaymentBatch.findMany({
        where,
        include: {
          period: {
            select: { id: true, name: true, year: true, month: true },
          },
          processor: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.bankPaymentBatch.count({ where }),
    ]);

    return {
      data: data as unknown as BankPaymentWithRelations[],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  /**
   * Find by ID
   */
  async findById(tenantId: string, id: string) {
    return db.bankPaymentBatch.findFirst({
      where: { id, tenantId },
      include: {
        period: {
          select: { id: true, name: true, year: true, month: true },
        },
        processor: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  },

  /**
   * Get batches for period
   */
  async getByPeriod(tenantId: string, periodId: string) {
    return db.bankPaymentBatch.findMany({
      where: { tenantId, periodId },
      include: {
        processor: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Create new batch
   */
  async create(
    tenantId: string,
    data: {
      periodId: string;
      bankCode: BankCode;
      bankName: string;
      totalRecords: number;
      totalAmount: number;
      fileName?: string;
      fileUrl?: string;
      fileFormat?: string;
      notes?: string;
    },
  ) {
    // Get period for batch number
    const period = await db.payrollPeriod.findFirst({
      where: { id: data.periodId, tenantId },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    // Count existing batches for sequence
    const existingCount = await db.bankPaymentBatch.count({
      where: { tenantId, periodId: data.periodId },
    });

    const batchNumber = generateBatchNumber(
      period.year,
      period.month,
      existingCount + 1,
    );

    return db.bankPaymentBatch.create({
      data: {
        tenantId,
        periodId: data.periodId,
        batchNumber,
        bankCode: data.bankCode,
        bankName: data.bankName,
        totalRecords: data.totalRecords,
        totalAmount: data.totalAmount,
        fileName: data.fileName,
        fileUrl: data.fileUrl,
        fileFormat: data.fileFormat,
        status: "DRAFT",
        generatedAt: new Date(),
        notes: data.notes,
      },
    });
  },

  /**
   * Delete batch
   */
  async delete(tenantId: string, id: string) {
    const batch = await db.bankPaymentBatch.findFirst({
      where: { id, tenantId },
    });

    if (!batch) {
      throw new Error("Đợt thanh toán không tồn tại");
    }

    if (batch.status === "PAID") {
      throw new Error("Không thể xóa đợt thanh toán đã xử lý");
    }

    return db.bankPaymentBatch.delete({
      where: { id },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // File Generation
  // ═══════════════════════════════════════════════════════════════

  /**
   * Generate payment file for period
   */
  async generatePaymentFile(
    tenantId: string,
    periodId: string,
    bankCode: BankFileFormat,
    companyInfo: {
      companyName: string;
      companyAccount: string;
      companyBankCode: string;
    },
  ): Promise<GeneratedFile> {
    // Get period
    const period = await db.payrollPeriod.findFirst({
      where: { id: periodId, tenantId },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    if (period.status !== "APPROVED" && period.status !== "PAID") {
      throw new Error("Kỳ lương chưa được duyệt");
    }

    // Get payrolls with bank info
    const payrolls = await db.payroll.findMany({
      where: {
        tenantId,
        periodId,
        bankAccount: { not: null },
        isPaid: false,
      },
      select: {
        employeeCode: true,
        employeeName: true,
        bankAccount: true,
        bankName: true,
        bankCode: true,
        netSalary: true,
      },
    });

    if (payrolls.length === 0) {
      throw new Error("Không có nhân viên cần thanh toán");
    }

    // Create payment records
    const records = createPaymentRecords(
      payrolls.map((p) => ({
        ...p,
        netSalary: Number(p.netSalary),
      })),
      period.month,
      period.year,
      companyInfo.companyName,
    );

    // Filter by bank if not generic
    let filteredRecords = records;
    if (bankCode !== "GENERIC") {
      filteredRecords = records.filter(
        (r) => r.bankCode === bankCode || r.bankCode === "OTHER",
      );
    }

    if (filteredRecords.length === 0) {
      throw new Error(`Không có nhân viên có tài khoản ${bankCode}`);
    }

    // Generate file
    const options: BankFileOptions = {
      batchNumber: generateBatchNumber(period.year, period.month, 1),
      paymentDate: new Date(),
      periodMonth: period.month,
      periodYear: period.year,
      companyName: companyInfo.companyName,
      companyAccount: companyInfo.companyAccount,
      companyBankCode: companyInfo.companyBankCode,
    };

    const file = generateBankFile(bankCode, filteredRecords, options);

    // Save batch record
    await this.create(tenantId, {
      periodId,
      bankCode: bankCode as BankCode,
      bankName: file.format,
      totalRecords: file.totalRecords,
      totalAmount: file.totalAmount,
      fileName: file.fileName,
      fileFormat: file.format,
    });

    return file;
  },

  /**
   * Generate all bank files for period
   */
  async generateAllBankFiles(
    tenantId: string,
    periodId: string,
    companyInfo: {
      companyName: string;
      companyAccount: string;
      companyBankCode: string;
    },
  ): Promise<GeneratedFile[]> {
    // Get period
    const period = await db.payrollPeriod.findFirst({
      where: { id: periodId, tenantId },
    });

    if (!period) {
      throw new Error("Kỳ lương không tồn tại");
    }

    // Get payrolls with bank info
    const payrolls = await db.payroll.findMany({
      where: {
        tenantId,
        periodId,
        bankAccount: { not: null },
        isPaid: false,
      },
      select: {
        employeeCode: true,
        employeeName: true,
        bankAccount: true,
        bankName: true,
        bankCode: true,
        netSalary: true,
      },
    });

    if (payrolls.length === 0) {
      throw new Error("Không có nhân viên cần thanh toán");
    }

    // Create payment records
    const records = createPaymentRecords(
      payrolls.map((p) => ({
        ...p,
        netSalary: Number(p.netSalary),
      })),
      period.month,
      period.year,
      companyInfo.companyName,
    );

    // Group by bank
    const grouped = groupRecordsByBank(records);
    const files: GeneratedFile[] = [];

    // Generate file for each bank
    let sequence = 1;
    for (const [bankCode, bankRecords] of Array.from(grouped.entries())) {
      const options: BankFileOptions = {
        batchNumber: generateBatchNumber(period.year, period.month, sequence),
        paymentDate: new Date(),
        periodMonth: period.month,
        periodYear: period.year,
        companyName: companyInfo.companyName,
        companyAccount: companyInfo.companyAccount,
        companyBankCode: companyInfo.companyBankCode,
      };

      const format = this.getBankFormat(bankCode);
      const file = generateBankFile(format, bankRecords, options);
      files.push(file);

      // Save batch record
      await this.create(tenantId, {
        periodId,
        bankCode: bankCode as BankCode,
        bankName: file.format,
        totalRecords: file.totalRecords,
        totalAmount: file.totalAmount,
        fileName: file.fileName,
        fileFormat: file.format,
      });

      sequence++;
    }

    return files;
  },

  // ═══════════════════════════════════════════════════════════════
  // Status Management
  // ═══════════════════════════════════════════════════════════════

  /**
   * Mark batch as processed
   */
  async markAsProcessed(
    tenantId: string,
    id: string,
    userId: string,
    bankReference?: string,
  ) {
    const batch = await db.bankPaymentBatch.findFirst({
      where: { id, tenantId },
    });

    if (!batch) {
      throw new Error("Đợt thanh toán không tồn tại");
    }

    return db.bankPaymentBatch.update({
      where: { id },
      data: {
        status: "PAID",
        processedAt: new Date(),
        processedBy: userId,
        bankReference,
        successCount: batch.totalRecords,
        failedCount: 0,
      },
    });
  },

  /**
   * Update bank response
   */
  async updateBankResponse(
    tenantId: string,
    id: string,
    data: {
      bankReference?: string;
      successCount?: number;
      failedCount?: number;
      bankResponseFile?: string;
    },
  ) {
    return db.bankPaymentBatch.update({
      where: { id },
      data,
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get bank format from bank code
   */
  getBankFormat(bankCode: string): BankFileFormat {
    switch (bankCode) {
      case "VCB":
        return "VCB";
      case "TCB":
        return "TCB";
      case "BIDV":
        return "BIDV";
      default:
        return "GENERIC";
    }
  },

  /**
   * Get summary for period
   */
  async getPeriodSummary(tenantId: string, periodId: string) {
    const batches = await db.bankPaymentBatch.findMany({
      where: { tenantId, periodId },
    });

    return {
      totalBatches: batches.length,
      totalRecords: batches.reduce((sum, b) => sum + b.totalRecords, 0),
      totalAmount: batches.reduce((sum, b) => sum + Number(b.totalAmount), 0),
      processed: batches.filter((b) => b.status === "PAID").length,
      pending: batches.filter((b) => b.status !== "PAID").length,
    };
  },
};
