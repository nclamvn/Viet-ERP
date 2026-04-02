import type { OrderStatus } from ".prisma/crm-client";

// ── Valid status transitions ────────────────────────────────────────

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

/** Check if a status transition is valid. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Get available next statuses from a given status. */
export function getAvailableTransitions(status: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[status] ?? [];
}

/** Map status to i18n label key. */
export function getStatusLabelKey(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    PENDING: "orderStatus.pending",
    CONFIRMED: "orderStatus.confirmed",
    IN_PRODUCTION: "orderStatus.inProduction",
    SHIPPED: "orderStatus.shipped",
    DELIVERED: "orderStatus.delivered",
    CANCELLED: "orderStatus.cancelled",
    REFUNDED: "orderStatus.refunded",
  };
  return map[status] ?? status;
}

/** Map status to color hex. */
export function getStatusColor(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    PENDING: "#F59E0B",
    CONFIRMED: "#3B82F6",
    IN_PRODUCTION: "#8B5CF6",
    SHIPPED: "#06B6D4",
    DELIVERED: "#10B981",
    CANCELLED: "#EF4444",
    REFUNDED: "#6B7280",
  };
  return map[status] ?? "#6B7280";
}

/** Timestamp field to set when transitioning to a status. */
export function getTimestampField(status: OrderStatus): string | null {
  const map: Partial<Record<OrderStatus, string>> = {
    CONFIRMED: "confirmedAt",
    SHIPPED: "shippedAt",
    DELIVERED: "deliveredAt",
    CANCELLED: "cancelledAt",
    REFUNDED: "refundedAt",
  };
  return map[status] ?? null;
}
