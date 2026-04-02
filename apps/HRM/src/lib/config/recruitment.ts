import type { ApplicationStatus } from ".prisma/hrm-client";

export const VALID_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> =
  {
    NEW: ["SCREENING", "REJECTED", "WITHDRAWN"],
    SCREENING: ["INTERVIEW", "REJECTED", "WITHDRAWN"],
    INTERVIEW: ["OFFERED", "REJECTED", "WITHDRAWN"],
    OFFERED: ["ACCEPTED", "REJECTED", "WITHDRAWN"],
    ACCEPTED: [],
    REJECTED: [],
    WITHDRAWN: [],
  };

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  NEW: "Mới",
  SCREENING: "Sàng lọc",
  INTERVIEW: "Phỏng vấn",
  OFFERED: "Đề nghị",
  ACCEPTED: "Chấp nhận",
  REJECTED: "Từ chối",
  WITHDRAWN: "Rút đơn",
};

export function validateStatusTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): string | null {
  if (from === to) return null;
  if (VALID_TRANSITIONS[from].includes(to)) return null;
  if (VALID_TRANSITIONS[from].length === 0)
    return `Ứng viên đã ở trạng thái cuối (${STATUS_LABELS[from]}), không thể thay đổi`;
  return `Không thể chuyển từ "${STATUS_LABELS[from]}" sang "${STATUS_LABELS[to]}" — không đúng quy trình`;
}
