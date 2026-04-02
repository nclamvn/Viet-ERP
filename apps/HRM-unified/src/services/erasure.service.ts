// src/services/erasure.service.ts
// GDPR Right to Erasure - Data anonymization service (P2-20)

import { db } from "@/lib/db";
import type { ErasureStatus } from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

/** Field groups that can be erased */
export const ERASURE_SCOPE_GROUPS = {
  personal: {
    label: "Thông tin cá nhân",
    fields: [
      "fullName",
      "dateOfBirth",
      "gender",
      "idNumber",
      "idIssueDate",
      "idIssuePlace",
      "avatar",
    ],
  },
  contact: {
    label: "Thông tin liên hệ",
    fields: ["phone", "personalEmail", "permanentAddress", "currentAddress"],
  },
  bank: {
    label: "Thông tin ngân hàng",
    fields: ["bankAccount", "bankName", "bankBranch"],
  },
  tax: {
    label: "Thông tin thuế & BHXH",
    fields: ["taxCode", "socialInsuranceNumber", "socialInsuranceDate"],
  },
} as const;

/** Fields that MUST be retained for legal compliance (Vietnamese labor law) */
const LEGAL_RETENTION_FIELDS = [
  "employeeCode", // Mã nhân viên - cần cho báo cáo thuế
  "hireDate", // Ngày vào làm - cần cho BHXH
  "resignationDate", // Ngày nghỉ việc
  "tenantId", // Liên kết tenant
];

/** Anonymized placeholder values */
const ANONYMIZED_VALUES: Record<string, string | null> = {
  fullName: "[Đã xóa]",
  dateOfBirth: null,
  gender: null,
  idNumber: null,
  idIssueDate: null,
  idIssuePlace: null,
  phone: null,
  personalEmail: null,
  workEmail: null,
  permanentAddress: null,
  currentAddress: null,
  bankAccount: null,
  bankName: null,
  bankBranch: null,
  taxCode: null,
  socialInsuranceNumber: null,
  socialInsuranceDate: null,
  avatar: null,
  notes: null,
};

// ═══════════════════════════════════════════════════════════════
// Service Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new erasure request
 */
export async function createErasureRequest(data: {
  tenantId: string;
  employeeId: string;
  requestedBy: string;
  reason: string;
  legalBasis?: string;
  scopeFields: string[];
}) {
  // Validate employee exists and is resigned/terminated
  const employee = await db.employee.findUnique({
    where: { id: data.employeeId },
  });

  if (!employee) {
    throw new Error("Nhân viên không tồn tại");
  }

  if (!["RESIGNED", "TERMINATED"].includes(employee.status)) {
    throw new Error("Chỉ có thể xóa dữ liệu nhân viên đã nghỉ việc");
  }

  return db.erasureRequest.create({
    data: {
      tenantId: data.tenantId,
      employeeId: data.employeeId,
      requestedBy: data.requestedBy,
      reason: data.reason,
      legalBasis: data.legalBasis,
      scopeFields: data.scopeFields,
      status: "REQUESTED",
    },
  });
}

/**
 * Review and approve/reject an erasure request
 */
export async function reviewErasureRequest(
  requestId: string,
  reviewedBy: string,
  action: "APPROVED" | "REJECTED",
  notes?: string,
) {
  const request = await db.erasureRequest.findUnique({
    where: { id: requestId },
  });

  if (!request) {
    throw new Error("Không tìm thấy yêu cầu xóa");
  }

  if (request.status !== "REQUESTED" && request.status !== "REVIEWING") {
    throw new Error("Yêu cầu đã được xử lý");
  }

  return db.erasureRequest.update({
    where: { id: requestId },
    data: {
      status: action as ErasureStatus,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: notes,
    },
  });
}

/**
 * Execute the data erasure (anonymize PII fields)
 * Only runs on APPROVED requests.
 */
export async function executeErasure(requestId: string, executedBy: string) {
  const request = await db.erasureRequest.findUnique({
    where: { id: requestId },
    include: {
      employee: {
        include: {
          dependents: true,
        },
      },
    },
  });

  if (!request) {
    throw new Error("Không tìm thấy yêu cầu xóa");
  }

  if (request.status !== "APPROVED") {
    throw new Error("Yêu cầu chưa được duyệt");
  }

  // Mark as processing
  await db.erasureRequest.update({
    where: { id: requestId },
    data: { status: "PROCESSING" },
  });

  const scopeFields = request.scopeFields as string[];
  const erasureLog: Record<string, { field: string; action: string }[]> = {};

  try {
    // 1. Anonymize employee fields
    const employeeUpdates: Record<string, unknown> = {};
    const employeeLog: { field: string; action: string }[] = [];

    for (const group of scopeFields) {
      const groupDef =
        ERASURE_SCOPE_GROUPS[group as keyof typeof ERASURE_SCOPE_GROUPS];
      if (!groupDef) continue;

      for (const field of groupDef.fields) {
        if (LEGAL_RETENTION_FIELDS.includes(field)) {
          employeeLog.push({ field, action: "retained_legal" });
          continue;
        }

        if (field in ANONYMIZED_VALUES) {
          employeeUpdates[field] = ANONYMIZED_VALUES[field];
          employeeLog.push({ field, action: "anonymized" });
        }
      }
    }

    if (Object.keys(employeeUpdates).length > 0) {
      await db.employee.update({
        where: { id: request.employeeId },
        data: employeeUpdates as any,
      });
    }
    erasureLog["employee"] = employeeLog;

    // 2. Anonymize dependents
    if (scopeFields.includes("personal")) {
      const dependentCount = await db.dependent.count({
        where: { employeeId: request.employeeId },
      });

      if (dependentCount > 0) {
        await db.dependent.updateMany({
          where: { employeeId: request.employeeId },
          data: {
            fullName: "[Đã xóa]",
            idNumber: null,
          },
        });
        erasureLog["dependents"] = [
          { field: "fullName", action: "anonymized" },
          { field: "idNumber", action: "anonymized" },
        ];
      }
    }

    // 3. Anonymize payroll snapshots (keep amounts for tax compliance)
    if (scopeFields.includes("bank")) {
      await db.payroll.updateMany({
        where: { employeeId: request.employeeId },
        data: {
          bankAccount: null,
          bankName: null,
          bankCode: null,
          employeeName: "[Đã xóa]",
        },
      });
      erasureLog["payroll"] = [
        { field: "bankAccount", action: "anonymized" },
        { field: "employeeName", action: "anonymized" },
      ];
    }

    // 4. Anonymize change history
    await db.employeeChangeHistory.updateMany({
      where: { employeeId: request.employeeId },
      data: {
        oldValue: "[Đã xóa]",
        newValue: "[Đã xóa]",
      },
    });
    erasureLog["changeHistory"] = [{ field: "*", action: "anonymized" }];

    // 5. Record retention exceptions
    const retentionExceptions = LEGAL_RETENTION_FIELDS.map((field) => ({
      field,
      reason: "Bắt buộc lưu giữ theo pháp luật lao động Việt Nam",
    }));

    // 6. Mark as completed
    await db.erasureRequest.update({
      where: { id: requestId },
      data: {
        status: "COMPLETED",
        executedAt: new Date(),
        executedBy,
        erasureLog: erasureLog,
        retentionExceptions: retentionExceptions,
      },
    });

    // 7. Create audit log
    await db.auditLog.create({
      data: {
        tenantId: request.tenantId,
        userId: executedBy,
        action: "DELETE",
        entityType: "ERASURE_REQUEST",
        entityId: requestId,
        entityName: `Xóa dữ liệu nhân viên ${request.employee.employeeCode}`,
        newData: erasureLog,
      },
    });

    return { success: true, erasureLog, retentionExceptions };
  } catch (error) {
    // Revert status on failure
    await db.erasureRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED" },
    });
    throw error;
  }
}

/**
 * Get erasure request with details
 */
export async function getErasureRequest(requestId: string) {
  return db.erasureRequest.findUnique({
    where: { id: requestId },
    include: {
      employee: {
        select: {
          employeeCode: true,
          fullName: true,
          status: true,
          resignationDate: true,
        },
      },
    },
  });
}

/**
 * List erasure requests for a tenant
 */
export async function listErasureRequests(
  tenantId: string,
  options?: { status?: ErasureStatus; page?: number; pageSize?: number },
) {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 20;

  const where = {
    tenantId,
    ...(options?.status && { status: options.status }),
  };

  const [items, total] = await Promise.all([
    db.erasureRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            employeeCode: true,
            fullName: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.erasureRequest.count({ where }),
  ]);

  return { items, total, page, pageSize };
}
