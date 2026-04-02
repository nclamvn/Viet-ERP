// src/lib/leave/constants.ts
// Leave Management Constants

import type { LeaveType, RequestStatus } from ".prisma/hrm-ai-client";

// ═══════════════════════════════════════════════════════════════
// Leave Type Configuration
// ═══════════════════════════════════════════════════════════════

export const LEAVE_TYPE_CONFIG: Record<
  LeaveType,
  {
    label: string;
    icon: string;
    color: string;
    bgColor: string;
  }
> = {
  ANNUAL: {
    label: "Phép năm",
    icon: "🏖️",
    color: "text-blue-600",
    bgColor: "bg-blue-100",
  },
  SICK: {
    label: "Nghỉ ốm",
    icon: "🤒",
    color: "text-red-600",
    bgColor: "bg-red-100",
  },
  MATERNITY: {
    label: "Thai sản",
    icon: "🤰",
    color: "text-pink-600",
    bgColor: "bg-pink-100",
  },
  PATERNITY: {
    label: "Nghỉ cha",
    icon: "👨‍🍼",
    color: "text-cyan-600",
    bgColor: "bg-cyan-100",
  },
  PERSONAL: {
    label: "Việc riêng",
    icon: "📋",
    color: "text-gray-600",
    bgColor: "bg-gray-100",
  },
  WEDDING: {
    label: "Nghỉ cưới",
    icon: "💒",
    color: "text-purple-600",
    bgColor: "bg-purple-100",
  },
  BEREAVEMENT: {
    label: "Nghỉ tang",
    icon: "🕯️",
    color: "text-slate-600",
    bgColor: "bg-slate-100",
  },
  UNPAID: {
    label: "Không lương",
    icon: "📝",
    color: "text-orange-600",
    bgColor: "bg-orange-100",
  },
  COMPENSATORY: {
    label: "Nghỉ bù",
    icon: "⏰",
    color: "text-green-600",
    bgColor: "bg-green-100",
  },
  OTHER: {
    label: "Khác",
    icon: "📌",
    color: "text-gray-600",
    bgColor: "bg-gray-100",
  },
};

// ═══════════════════════════════════════════════════════════════
// Request Status Configuration
// ═══════════════════════════════════════════════════════════════

export const REQUEST_STATUS_CONFIG: Record<
  RequestStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    icon: string;
  }
> = {
  DRAFT: {
    label: "Nháp",
    color: "text-gray-600",
    bgColor: "bg-gray-100",
    icon: "⚪",
  },
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
    icon: "🟢",
  },
  REJECTED: {
    label: "Từ chối",
    color: "text-red-600",
    bgColor: "bg-red-100",
    icon: "🔴",
  },
  CANCELLED: {
    label: "Đã hủy",
    color: "text-gray-500",
    bgColor: "bg-gray-100",
    icon: "⚫",
  },
};

// ═══════════════════════════════════════════════════════════════
// Vietnam Leave Defaults (Theo Bộ Luật Lao động)
// ═══════════════════════════════════════════════════════════════

export const VN_LEAVE_DEFAULTS = {
  ANNUAL: {
    daysPerYear: 12,
    maxCarryOver: 5,
    carryOverExpireMonths: 3,
    advanceNoticeDays: 3,
    isPaid: true,
  },
  SICK: {
    daysPerYear: 30,
    maxCarryOver: 0,
    advanceNoticeDays: 0,
    isPaid: true, // Paid by BHXH
  },
  PERSONAL: {
    daysPerYear: 3,
    maxCarryOver: 0,
    advanceNoticeDays: 1,
    isPaid: true,
  },
  WEDDING: {
    daysPerYear: 3,
    maxCarryOver: 0,
    advanceNoticeDays: 3,
    isPaid: true,
  },
  BEREAVEMENT: {
    daysPerYear: 3,
    maxCarryOver: 0,
    advanceNoticeDays: 0,
    isPaid: true,
  },
  MATERNITY: {
    daysPerYear: 180, // 6 months
    maxCarryOver: 0,
    advanceNoticeDays: 30,
    isPaid: true, // Paid by BHXH
  },
  PATERNITY: {
    daysPerYear: 5,
    maxCarryOver: 0,
    advanceNoticeDays: 0,
    isPaid: true,
  },
  UNPAID: {
    daysPerYear: 365,
    maxCarryOver: 0,
    advanceNoticeDays: 7,
    isPaid: false,
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// Half Day Options
// ═══════════════════════════════════════════════════════════════

export const HALF_DAY_OPTIONS = [
  { value: "AM", label: "Buổi sáng" },
  { value: "PM", label: "Buổi chiều" },
] as const;

// ═══════════════════════════════════════════════════════════════
// Leave Type Options for Select
// ═══════════════════════════════════════════════════════════════

export const LEAVE_TYPE_OPTIONS = Object.entries(LEAVE_TYPE_CONFIG).map(
  ([value, config]) => ({
    value: value as LeaveType,
    label: config.label,
    icon: config.icon,
  }),
);

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

export function getLeaveTypeLabel(type: LeaveType): string {
  return LEAVE_TYPE_CONFIG[type]?.label || type;
}

export function getLeaveTypeIcon(type: LeaveType): string {
  return LEAVE_TYPE_CONFIG[type]?.icon || "📌";
}

export function getRequestStatusLabel(status: RequestStatus): string {
  return REQUEST_STATUS_CONFIG[status]?.label || status;
}

export function getRequestStatusColor(status: RequestStatus): string {
  return REQUEST_STATUS_CONFIG[status]?.bgColor || "bg-gray-100";
}
