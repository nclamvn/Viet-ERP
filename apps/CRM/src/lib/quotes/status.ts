import type { QuoteStatus } from ".prisma/crm-client";

interface QuoteLike {
  status: string;
  validUntil?: Date | string | null;
}

export function isQuoteExpired(quote: QuoteLike): boolean {
  if (quote.status !== "SENT") return false;
  if (!quote.validUntil) return false;
  return new Date(quote.validUntil) < new Date();
}

export function daysUntilExpiry(quote: QuoteLike): number | null {
  if (!quote.validUntil) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiry = new Date(quote.validUntil);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#6B7280",
  SENT: "#3B82F6",
  VIEWED: "#8B5CF6",
  ACCEPTED: "#10B981",
  REJECTED: "#EF4444",
  EXPIRED: "#F59E0B",
};

export function getQuoteStatusColor(status: QuoteStatus | string): string {
  return STATUS_COLORS[status] || "#6B7280";
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Nháp",
  SENT: "Đã gửi",
  VIEWED: "Đã xem",
  ACCEPTED: "Chấp nhận",
  REJECTED: "Từ chối",
  EXPIRED: "Hết hạn",
};

export function getQuoteStatusLabel(status: QuoteStatus | string): string {
  return STATUS_LABELS[status] || status;
}
