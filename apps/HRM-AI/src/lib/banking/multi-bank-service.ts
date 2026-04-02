// src/lib/banking/multi-bank-service.ts
// Multi-Bank Payment Service with Smart Bank Detection

import prisma from "@/lib/db";
import { Prisma } from ".prisma/hrm-ai-client";
import { EventEmitter } from "events";
import type {
  IBankAdapter,
  BankCode,
  BatchPaymentRequest,
  BatchPaymentStatus,
  PaymentBatchStatus as PaymentBatchStatusType,
} from "./types";
import { VietcombankProductionAdapter } from "./adapters/vietcombank-production";
import { detectBankCode } from "./config";

// Type for payroll with employee include
type PayrollWithEmployee = Prisma.PayrollGetPayload<{
  include: {
    employee: {
      select: {
        id: true;
        employeeCode: true;
        fullName: true;
        bankAccount: true;
        bankName: true;
      };
    };
  };
}>;

// ═══════════════════════════════════════════════════════════════
// MULTI-BANK PAYMENT SERVICE
// ═══════════════════════════════════════════════════════════════

export class MultiBankPaymentService extends EventEmitter {
  private adapters: Map<string, IBankAdapter> = new Map();

  constructor() {
    super();
    this.initializeAdapters();
  }

  // ─────────────────────────────────────────────────────────────
  // Adapter Management
  // ─────────────────────────────────────────────────────────────

  private initializeAdapters() {
    try {
      // Initialize VCB adapter if configured
      if (process.env.VCB_CLIENT_ID) {
        this.adapters.set("VCB", new VietcombankProductionAdapter());
      }

      // TODO: Initialize other bank adapters when implemented
      // if (process.env.TCB_CLIENT_ID) {
      //   this.adapters.set('TCB', new TechcombankAdapter())
      // }
      // if (process.env.MB_CLIENT_ID) {
      //   this.adapters.set('MB', new MBBankAdapter())
      // }
    } catch (error) {
      console.error("Failed to initialize bank adapters", error);
    }
  }

  getAdapter(bankCode: string): IBankAdapter | undefined {
    return this.adapters.get(bankCode);
  }

  getAvailableBanks(): string[] {
    return Array.from(this.adapters.keys());
  }

  // ─────────────────────────────────────────────────────────────
  // Payment Batch Creation from Payroll
  // ─────────────────────────────────────────────────────────────

  async createPayrollPaymentBatch(
    payrollPeriodId: string,
    options?: {
      preferredBank?: string;
      scheduledDate?: Date;
    },
  ): Promise<string> {
    const payrollPeriod = await prisma.payrollPeriod.findUnique({
      where: { id: payrollPeriodId },
      include: {
        payrolls: {
          where: { status: "APPROVED" },
          include: {
            employee: {
              select: {
                id: true,
                employeeCode: true,
                fullName: true,
                bankAccount: true,
                bankName: true,
              },
            },
          },
        },
      },
    });

    if (!payrollPeriod) {
      throw new Error("Không tìm thấy kỳ lương");
    }

    if (payrollPeriod.payrolls.length === 0) {
      throw new Error("Không có dữ liệu lương để thanh toán");
    }

    // Group employees by their bank
    const employeesByBank = new Map<string, PayrollWithEmployee[]>();

    for (const payroll of payrollPeriod.payrolls as PayrollWithEmployee[]) {
      const bankCode = detectBankCode(payroll.employee.bankName || "");

      if (!employeesByBank.has(bankCode)) {
        employeesByBank.set(bankCode, []);
      }
      employeesByBank.get(bankCode)!.push(payroll);
    }

    // Determine primary bank
    const primaryBank =
      options?.preferredBank || process.env.PRIMARY_BANK_CODE || "VCB";

    // Get bank config
    const bankConfig = await prisma.bankConfiguration.findFirst({
      where: {
        bankCode: primaryBank,
        isActive: true,
      },
    });

    if (!bankConfig) {
      throw new Error(`Không tìm thấy cấu hình ngân hàng ${primaryBank}`);
    }

    // Calculate totals
    const allPayrolls = payrollPeriod.payrolls as PayrollWithEmployee[];
    const totalAmount = allPayrolls.reduce(
      (sum: number, p: PayrollWithEmployee) => sum + Number(p.netSalary),
      0,
    );

    // Generate batch code
    const batchCode = `PAY-${payrollPeriod.year}-${String(payrollPeriod.month).padStart(2, "0")}-${Date.now().toString().slice(-6)}`;

    // Create batch
    const batch = await prisma.paymentBatch.create({
      data: {
        tenantId: payrollPeriod.tenantId,
        bankConfigId: bankConfig.id,
        batchCode,
        batchName: `Thanh toán lương T${payrollPeriod.month}/${payrollPeriod.year}`,
        batchType: "SALARY",
        payrollPeriodId,
        totalTransactions: allPayrolls.length,
        totalAmount,
        status: "DRAFT",
      },
    });

    // Create payment transactions
    await prisma.paymentTransaction.createMany({
      data: allPayrolls.map((payroll: PayrollWithEmployee) => {
        const empBankCode = detectBankCode(payroll.employee.bankName || "");
        return {
          batchId: batch.id,
          employeeId: payroll.employeeId,
          recipientName: payroll.employee.fullName,
          recipientBank: payroll.employee.bankName || "",
          recipientAccount: payroll.employee.bankAccount || "",
          amount: Number(payroll.netSalary),
          currency: "VND",
          description: this.formatPaymentDescription(
            payrollPeriod.month,
            payrollPeriod.year,
            payroll.employee.employeeCode,
          ),
          status: "PENDING",
          isInterbank: empBankCode !== primaryBank,
        };
      }),
    });

    // Store summary by bank
    const bankSummary: Record<string, { count: number; amount: number }> = {};
    employeesByBank.forEach((payrolls, bank) => {
      bankSummary[bank] = {
        count: payrolls.length,
        amount: payrolls.reduce(
          (sum: number, p: PayrollWithEmployee) => sum + Number(p.netSalary),
          0,
        ),
      };
    });

    await prisma.paymentBatch.update({
      where: { id: batch.id },
      data: {
        notes: JSON.stringify({ employeesByBank: bankSummary }),
      },
    });

    return batch.id;
  }

  // ─────────────────────────────────────────────────────────────
  // Account Validation
  // ─────────────────────────────────────────────────────────────

  async validateBatchAccounts(batchId: string): Promise<{
    valid: number;
    invalid: number;
    errors: Array<{
      employeeId: string;
      employeeName: string;
      accountNumber: string;
      error: string;
    }>;
  }> {
    const batch = await prisma.paymentBatch.findUnique({
      where: { id: batchId },
      include: {
        transactions: {
          include: {
            employee: {
              select: { id: true, fullName: true },
            },
          },
        },
      },
    });

    if (!batch) {
      throw new Error("Không tìm thấy batch thanh toán");
    }

    const result = {
      valid: 0,
      invalid: 0,
      errors: [] as Array<{
        employeeId: string;
        employeeName: string;
        accountNumber: string;
        error: string;
      }>,
    };

    // Validate each account
    for (const payment of batch.transactions) {
      const bankCode = detectBankCode(payment.recipientBank);
      const adapter = this.adapters.get(bankCode);

      if (!adapter) {
        // Check if account number looks valid (basic validation)
        if (!payment.recipientAccount || payment.recipientAccount.length < 8) {
          result.invalid++;
          result.errors.push({
            employeeId: payment.employeeId,
            employeeName: payment.recipientName,
            accountNumber: payment.recipientAccount,
            error: "Số tài khoản không hợp lệ",
          });
        } else {
          result.valid++; // Pass basic validation for unsupported banks
        }
        continue;
      }

      try {
        const validation = await adapter.validateAccount(
          payment.recipientAccount,
          bankCode as BankCode,
        );

        if (validation.valid) {
          // Check name matching
          const nameMatch = this.compareAccountNames(
            validation.accountName || "",
            payment.recipientName,
          );

          if (!nameMatch) {
            result.invalid++;
            result.errors.push({
              employeeId: payment.employeeId,
              employeeName: payment.recipientName,
              accountNumber: payment.recipientAccount,
              error: `Tên tài khoản không khớp. Ngân hàng: "${validation.accountName}"`,
            });

            await prisma.paymentTransaction.update({
              where: { id: payment.id },
              data: {
                status: "PENDING",
                bankResponseMessage: `Name mismatch: ${validation.accountName}`,
              },
            });
          } else {
            result.valid++;
            await prisma.paymentTransaction.update({
              where: { id: payment.id },
              data: {
                status: "PENDING",
                bankResponseMessage: "Validated",
              },
            });
          }
        } else {
          result.invalid++;
          result.errors.push({
            employeeId: payment.employeeId,
            employeeName: payment.recipientName,
            accountNumber: payment.recipientAccount,
            error: validation.errorMessage || "Tài khoản không hợp lệ",
          });

          await prisma.paymentTransaction.update({
            where: { id: payment.id },
            data: {
              status: "PENDING",
              bankResponseMessage: validation.errorMessage,
            },
          });
        }
      } catch (error) {
        result.invalid++;
        result.errors.push({
          employeeId: payment.employeeId,
          employeeName: payment.recipientName,
          accountNumber: payment.recipientAccount,
          error: (error as Error).message,
        });
      }
    }

    // Update batch validation status
    await prisma.paymentBatch.update({
      where: { id: batchId },
      data: {
        notes: JSON.stringify({
          validationSummary: {
            valid: result.valid,
            invalid: result.invalid,
            validatedAt: new Date().toISOString(),
          },
        }),
      },
    });

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // Batch Submission
  // ─────────────────────────────────────────────────────────────

  async submitBatch(batchId: string, approvedBy: string): Promise<void> {
    const batch = await prisma.paymentBatch.findUnique({
      where: { id: batchId },
      include: {
        bankConfig: true,
        transactions: {
          where: {
            status: "PENDING",
          },
        },
      },
    });

    if (!batch) {
      throw new Error("Không tìm thấy batch thanh toán");
    }

    if (batch.status !== "APPROVED") {
      throw new Error("Batch chưa được duyệt");
    }

    const adapter = this.adapters.get(batch.bankConfig.bankCode);
    if (!adapter) {
      throw new Error(
        `Không có adapter cho ngân hàng: ${batch.bankConfig.bankCode}`,
      );
    }

    // Build batch request
    const request: BatchPaymentRequest = {
      batchId: batch.batchCode,
      batchName: batch.batchName,
      sourceAccount: {
        accountNumber: batch.bankConfig.accountNumber,
        accountName: batch.bankConfig.accountName,
        bankCode: batch.bankConfig.bankCode as BankCode,
        branchCode: batch.bankConfig.branchCode || undefined,
      },
      payments: batch.transactions.map((tx) => ({
        transactionId: tx.id,
        amount: Number(tx.amount),
        currency: tx.currency,
        description: tx.description || "",
        sourceAccount: {
          accountNumber: batch.bankConfig.accountNumber,
          accountName: batch.bankConfig.accountName,
          bankCode: batch.bankConfig.bankCode as BankCode,
        },
        destinationAccount: {
          accountNumber: tx.recipientAccount,
          accountName: tx.recipientName,
          bankCode: detectBankCode(tx.recipientBank) as BankCode,
          branchCode: tx.recipientBranch || undefined,
        },
      })),
    };

    // Submit to bank
    const response = await adapter.createBatchPayment(request);

    // Update batch
    await prisma.paymentBatch.update({
      where: { id: batchId },
      data: {
        status: response.success ? "PROCESSING" : "FAILED",
        bankReferenceId: response.bankBatchId,
        processedAt: response.success ? new Date() : null,
        approvedBy,
        bankResponseData: JSON.parse(JSON.stringify(response)),
      },
    });

    // Update transactions
    for (const txResult of response.transactions) {
      await prisma.paymentTransaction.update({
        where: { id: txResult.transactionId },
        data: {
          status:
            txResult.status === "PENDING" ? "PROCESSING" : txResult.status,
          bankTransactionId: txResult.bankTransactionId,
          bankResponseCode: txResult.responseCode,
          bankResponseMessage: txResult.responseMessage,
        },
      });
    }

    if (!response.success) {
      throw new Error(
        `Gửi batch thất bại: ${response.transactions[0]?.responseMessage}`,
      );
    }

    this.emit("batchSubmitted", {
      batchId,
      bankBatchNo: response.bankBatchId,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Batch Status Update
  // ─────────────────────────────────────────────────────────────

  async updateBatchStatus(batchId: string): Promise<BatchPaymentStatus | null> {
    const batch = await prisma.paymentBatch.findUnique({
      where: { id: batchId },
      include: { bankConfig: true },
    });

    if (!batch || !batch.bankReferenceId) {
      throw new Error("Batch không tìm thấy hoặc chưa được gửi");
    }

    const adapter = this.adapters.get(batch.bankConfig.bankCode);
    if (!adapter || !adapter.getBatchStatus) {
      throw new Error(
        `Không có adapter cho ngân hàng: ${batch.bankConfig.bankCode}`,
      );
    }

    const status = await adapter.getBatchStatus(
      batch.batchCode,
      batch.bankReferenceId,
    );

    // Update batch
    const newStatus = this.mapBatchStatus(status.status);
    await prisma.paymentBatch.update({
      where: { id: batchId },
      data: {
        status: newStatus,
        successCount: status.successCount,
        failedCount: status.failedCount,
        completedAt: ["COMPLETED", "FAILED"].includes(newStatus)
          ? new Date()
          : null,
      },
    });

    // Update individual transactions
    for (const tx of status.transactions) {
      await prisma.paymentTransaction.update({
        where: { id: tx.transactionId },
        data: {
          status: tx.status,
          bankTransactionId: tx.bankTransactionId,
          bankResponseCode: tx.responseCode,
          bankResponseMessage: tx.responseMessage,
          processedAt: tx.processedAt,
        },
      });
    }

    // Emit event if completed
    if (["COMPLETED", "PARTIAL", "FAILED"].includes(newStatus)) {
      this.emit("batchCompleted", {
        batchId,
        status: newStatus,
        successCount: status.successCount,
        failedCount: status.failedCount,
      });
    }

    return status;
  }

  // ─────────────────────────────────────────────────────────────
  // Retry Failed Transactions
  // ─────────────────────────────────────────────────────────────

  async retryFailedTransactions(batchId: string): Promise<string> {
    const batch = await prisma.paymentBatch.findUnique({
      where: { id: batchId },
      include: {
        transactions: {
          where: { status: "FAILED" },
        },
        payrollPeriod: true,
        bankConfig: true,
      },
    });

    if (!batch || batch.transactions.length === 0) {
      throw new Error("Không có giao dịch thất bại để thử lại");
    }

    // Create new batch for retries
    const retryBatchCode = `${batch.batchCode}-RETRY-${Date.now().toString().slice(-4)}`;

    const retryBatch = await prisma.paymentBatch.create({
      data: {
        tenantId: batch.tenantId,
        batchCode: retryBatchCode,
        batchName: `Retry: ${batch.batchName}`,
        batchType: "SALARY",
        payrollPeriodId: batch.payrollPeriodId,
        bankConfigId: batch.bankConfigId,
        totalTransactions: batch.transactions.length,
        totalAmount: batch.transactions.reduce(
          (sum, p) => sum + Number(p.amount),
          0,
        ),
        status: "DRAFT",
        notes: JSON.stringify({ parentBatchId: batchId }),
      },
    });

    // Create retry transactions
    await prisma.paymentTransaction.createMany({
      data: batch.transactions.map((tx) => ({
        batchId: retryBatch.id,
        employeeId: tx.employeeId,
        recipientName: tx.recipientName,
        recipientBank: tx.recipientBank,
        recipientAccount: tx.recipientAccount,
        recipientBranch: tx.recipientBranch,
        amount: tx.amount,
        currency: tx.currency,
        description: tx.description,
        status: "PENDING",
      })),
    });

    return retryBatch.id;
  }

  // ─────────────────────────────────────────────────────────────
  // Helper Methods
  // ─────────────────────────────────────────────────────────────

  private compareAccountNames(bankName: string, inputName: string): boolean {
    // Normalize names for comparison
    const normalize = (name: string) =>
      name
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/Đ/g, "D")
        .replace(/[^A-Z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const n1 = normalize(bankName);
    const n2 = normalize(inputName);

    // Exact match
    if (n1 === n2) return true;

    // Check if one contains the other
    if (n1.includes(n2) || n2.includes(n1)) return true;

    // Check word overlap (at least 2 words match)
    const words1 = n1.split(" ");
    const words2 = n2.split(" ");
    const matchingWords = words1.filter((w) => words2.includes(w));

    return matchingWords.length >= 2;
  }

  private formatPaymentDescription(
    month: number,
    year: number,
    employeeCode: string,
  ): string {
    return `LUONG T${String(month).padStart(2, "0")}/${year} ${employeeCode}`;
  }

  private mapBatchStatus(
    status: string,
  ):
    | "DRAFT"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "PROCESSING"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED" {
    const mapping: Record<
      string,
      | "DRAFT"
      | "PENDING_APPROVAL"
      | "APPROVED"
      | "PROCESSING"
      | "COMPLETED"
      | "FAILED"
      | "CANCELLED"
    > = {
      COMPLETED: "COMPLETED",
      PARTIAL: "COMPLETED", // Map PARTIAL to COMPLETED (with notes)
      FAILED: "FAILED",
      PROCESSING: "PROCESSING",
      PENDING: "PROCESSING",
      CANCELLED: "CANCELLED",
    };
    return mapping[status] || "PROCESSING";
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

export const multiBankPaymentService = new MultiBankPaymentService();

// ═══════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════

export function createMultiBankPaymentService(): MultiBankPaymentService {
  return new MultiBankPaymentService();
}
