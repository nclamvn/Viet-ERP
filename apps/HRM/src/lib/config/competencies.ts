import type { RatingScale } from ".prisma/hrm-client";

export const RTR_COMPETENCIES = [
  { key: "technical", label: "Năng lực chuyên môn", weight: 0.35 },
  { key: "execution", label: "Hiệu quả thực thi", weight: 0.25 },
  { key: "teamwork", label: "Làm việc nhóm", weight: 0.2 },
  { key: "communication", label: "Giao tiếp", weight: 0.1 },
  { key: "initiative", label: "Chủ động & sáng tạo", weight: 0.1 },
] as const;

export function calculateWeightedScore(scores: Record<string, number>): number {
  const total = RTR_COMPETENCIES.reduce((sum, c) => {
    return sum + (scores[c.key] ?? 0) * c.weight;
  }, 0);
  return Math.round(total * 10) / 10;
}

export function scoreToRating(score: number): RatingScale {
  if (score >= 4.5) return "EXCELLENT";
  if (score >= 3.5) return "GOOD";
  if (score >= 2.5) return "SATISFACTORY";
  if (score >= 1.5) return "NEEDS_IMPROVEMENT";
  return "UNSATISFACTORY";
}

export const RATING_LABELS: Record<
  RatingScale,
  { label: string; short: string; color: string }
> = {
  EXCELLENT: {
    label: "Xuất sắc",
    short: "5",
    color: "bg-emerald-100 text-emerald-700",
  },
  GOOD: { label: "Tốt", short: "4", color: "bg-blue-100 text-blue-700" },
  SATISFACTORY: {
    label: "Đạt yêu cầu",
    short: "3",
    color: "bg-yellow-100 text-yellow-700",
  },
  NEEDS_IMPROVEMENT: {
    label: "Cần cải thiện",
    short: "2",
    color: "bg-orange-100 text-orange-700",
  },
  UNSATISFACTORY: {
    label: "Không đạt",
    short: "1",
    color: "bg-red-100 text-red-700",
  },
};

export const REVIEW_STATUS_LABELS: Record<
  string,
  { label: string; color: string }
> = {
  DRAFT: { label: "Nháp", color: "bg-gray-100 text-gray-700" },
  SELF_PENDING: {
    label: "Chờ tự đánh giá",
    color: "bg-yellow-100 text-yellow-700",
  },
  SELF_DONE: { label: "NV đã đánh giá", color: "bg-blue-100 text-blue-700" },
  MANAGER_PENDING: {
    label: "Chờ Manager",
    color: "bg-orange-100 text-orange-700",
  },
  MANAGER_DONE: {
    label: "Manager đã đánh giá",
    color: "bg-blue-100 text-blue-700",
  },
  HR_REVIEWING: {
    label: "Chờ HR tổng hợp",
    color: "bg-purple-100 text-purple-700",
  },
  COMPLETED: { label: "Hoàn tất", color: "bg-emerald-100 text-emerald-700" },
};

export const CYCLE_LABELS: Record<string, string> = {
  MIDYEAR: "Giữa năm",
  ANNUAL: "Cuối năm",
  PROBATION: "Thử việc",
  ADHOC: "Đột xuất",
};
