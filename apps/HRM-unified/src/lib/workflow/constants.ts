// src/lib/workflow/constants.ts
// Workflow Engine Constants

import type {
  ApproverType,
  WorkflowType,
  ApprovalStatus,
} from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// Workflow Type Configuration
// ═══════════════════════════════════════════════════════════════

export const WORKFLOW_TYPE_CONFIG: Record<
  WorkflowType,
  {
    label: string;
    description: string;
    defaultCode: string;
  }
> = {
  LEAVE_REQUEST: {
    label: "Nghỉ phép",
    description: "Quy trình duyệt đơn xin nghỉ phép",
    defaultCode: "LEAVE_APPROVAL",
  },
  OT_REQUEST: {
    label: "Tăng ca",
    description: "Quy trình duyệt đơn đăng ký tăng ca",
    defaultCode: "OT_APPROVAL",
  },
  PROFILE_UPDATE: {
    label: "Cập nhật hồ sơ",
    description: "Quy trình duyệt thay đổi thông tin cá nhân",
    defaultCode: "PROFILE_APPROVAL",
  },
  RESIGNATION: {
    label: "Nghỉ việc",
    description: "Quy trình duyệt đơn xin nghỉ việc",
    defaultCode: "RESIGNATION_APPROVAL",
  },
  CUSTOM: {
    label: "Tùy chỉnh",
    description: "Quy trình tùy chỉnh",
    defaultCode: "CUSTOM_APPROVAL",
  },
};

// ═══════════════════════════════════════════════════════════════
// Approver Type Configuration
// ═══════════════════════════════════════════════════════════════

export const APPROVER_TYPE_CONFIG: Record<
  ApproverType,
  {
    label: string;
    description: string;
  }
> = {
  DIRECT_MANAGER: {
    label: "Quản lý trực tiếp",
    description: "Người quản lý trực tiếp của nhân viên",
  },
  DEPARTMENT_HEAD: {
    label: "Trưởng phòng",
    description: "Trưởng phòng ban của nhân viên",
  },
  HR_MANAGER: {
    label: "HR Manager",
    description: "Quản lý nhân sự",
  },
  SPECIFIC_USER: {
    label: "Người cụ thể",
    description: "Chỉ định một người dùng cụ thể",
  },
  ROLE_BASED: {
    label: "Theo vai trò",
    description: "Bất kỳ người dùng nào có vai trò cụ thể",
  },
};

// ═══════════════════════════════════════════════════════════════
// Approval Status Configuration
// ═══════════════════════════════════════════════════════════════

export const APPROVAL_STATUS_CONFIG: Record<
  ApprovalStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    icon: string;
  }
> = {
  PENDING: {
    label: "Chờ duyệt",
    color: "text-yellow-600",
    bgColor: "bg-yellow-100",
    icon: "🟡",
  },
  APPROVED: {
    label: "Đã duyệt",
    color: "text-green-600",
    bgColor: "bg-green-100",
    icon: "✅",
  },
  REJECTED: {
    label: "Từ chối",
    color: "text-red-600",
    bgColor: "bg-red-100",
    icon: "❌",
  },
  SKIPPED: {
    label: "Bỏ qua",
    color: "text-gray-500",
    bgColor: "bg-gray-100",
    icon: "⏭️",
  },
};

// ═══════════════════════════════════════════════════════════════
// Condition Operators
// ═══════════════════════════════════════════════════════════════

export const CONDITION_OPERATORS = [
  { value: "=", label: "Bằng" },
  { value: "!=", label: "Khác" },
  { value: ">", label: "Lớn hơn" },
  { value: "<", label: "Nhỏ hơn" },
  { value: ">=", label: "Lớn hơn hoặc bằng" },
  { value: "<=", label: "Nhỏ hơn hoặc bằng" },
  { value: "in", label: "Trong danh sách" },
  { value: "not_in", label: "Không trong danh sách" },
] as const;

// ═══════════════════════════════════════════════════════════════
// Default SLA Hours
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_SLA_HOURS = {
  DIRECT_MANAGER: 48,
  DEPARTMENT_HEAD: 48,
  HR_MANAGER: 24,
  SPECIFIC_USER: 48,
  ROLE_BASED: 48,
} as const;

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

export function getWorkflowTypeLabel(type: WorkflowType): string {
  return WORKFLOW_TYPE_CONFIG[type]?.label || type;
}

export function getApproverTypeLabel(type: ApproverType): string {
  return APPROVER_TYPE_CONFIG[type]?.label || type;
}

export function getApprovalStatusLabel(status: ApprovalStatus): string {
  return APPROVAL_STATUS_CONFIG[status]?.label || status;
}
