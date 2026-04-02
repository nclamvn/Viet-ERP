import { describe, it, expect } from "vitest";
import {
  ORDER_TRANSITIONS,
  canTransition,
  getAvailableTransitions,
  getStatusLabelKey,
  getStatusColor,
  getTimestampField,
} from "../state-machine";
import type { OrderStatus } from ".prisma/crm-client";

const ALL_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
];

describe("Order State Machine", () => {
  describe("ORDER_TRANSITIONS", () => {
    it("defines transitions for every status", () => {
      for (const status of ALL_STATUSES) {
        expect(ORDER_TRANSITIONS).toHaveProperty(status);
        expect(Array.isArray(ORDER_TRANSITIONS[status])).toBe(true);
      }
    });

    it("CANCELLED and REFUNDED are terminal states", () => {
      expect(ORDER_TRANSITIONS.CANCELLED).toEqual([]);
      expect(ORDER_TRANSITIONS.REFUNDED).toEqual([]);
    });

    it("DELIVERED can only transition to REFUNDED", () => {
      expect(ORDER_TRANSITIONS.DELIVERED).toEqual(["REFUNDED"]);
    });
  });

  describe("canTransition()", () => {
    it("allows valid forward transitions", () => {
      expect(canTransition("PENDING", "CONFIRMED")).toBe(true);
      expect(canTransition("CONFIRMED", "IN_PRODUCTION")).toBe(true);
      expect(canTransition("IN_PRODUCTION", "SHIPPED")).toBe(true);
      expect(canTransition("SHIPPED", "DELIVERED")).toBe(true);
      expect(canTransition("DELIVERED", "REFUNDED")).toBe(true);
    });

    it("allows cancellation from non-terminal states", () => {
      expect(canTransition("PENDING", "CANCELLED")).toBe(true);
      expect(canTransition("CONFIRMED", "CANCELLED")).toBe(true);
      expect(canTransition("IN_PRODUCTION", "CANCELLED")).toBe(true);
      expect(canTransition("SHIPPED", "CANCELLED")).toBe(true);
    });

    it("blocks reverse transitions", () => {
      expect(canTransition("CONFIRMED", "PENDING")).toBe(false);
      expect(canTransition("SHIPPED", "IN_PRODUCTION")).toBe(false);
      expect(canTransition("DELIVERED", "SHIPPED")).toBe(false);
    });

    it("blocks transitions from terminal states", () => {
      expect(canTransition("CANCELLED", "PENDING")).toBe(false);
      expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
      expect(canTransition("REFUNDED", "DELIVERED")).toBe(false);
      expect(canTransition("REFUNDED", "PENDING")).toBe(false);
    });

    it("blocks skip-level transitions", () => {
      expect(canTransition("PENDING", "IN_PRODUCTION")).toBe(false);
      expect(canTransition("PENDING", "SHIPPED")).toBe(false);
      expect(canTransition("PENDING", "DELIVERED")).toBe(false);
      expect(canTransition("CONFIRMED", "DELIVERED")).toBe(false);
    });

    it("blocks self-transitions", () => {
      for (const status of ALL_STATUSES) {
        expect(canTransition(status, status)).toBe(false);
      }
    });

    it("blocks cancellation from DELIVERED", () => {
      expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
    });
  });

  describe("getAvailableTransitions()", () => {
    it("returns correct transitions for PENDING", () => {
      expect(getAvailableTransitions("PENDING")).toEqual([
        "CONFIRMED",
        "CANCELLED",
      ]);
    });

    it("returns empty array for terminal states", () => {
      expect(getAvailableTransitions("CANCELLED")).toEqual([]);
      expect(getAvailableTransitions("REFUNDED")).toEqual([]);
    });

    it("returns non-empty for non-terminal states", () => {
      expect(getAvailableTransitions("CONFIRMED").length).toBeGreaterThan(0);
      expect(getAvailableTransitions("IN_PRODUCTION").length).toBeGreaterThan(
        0,
      );
      expect(getAvailableTransitions("SHIPPED").length).toBeGreaterThan(0);
    });
  });

  describe("getStatusLabelKey()", () => {
    it("returns i18n key for every status", () => {
      for (const status of ALL_STATUSES) {
        const key = getStatusLabelKey(status);
        expect(key).toMatch(/^orderStatus\./);
      }
    });

    it("returns specific label keys", () => {
      expect(getStatusLabelKey("PENDING")).toBe("orderStatus.pending");
      expect(getStatusLabelKey("DELIVERED")).toBe("orderStatus.delivered");
      expect(getStatusLabelKey("CANCELLED")).toBe("orderStatus.cancelled");
    });
  });

  describe("getStatusColor()", () => {
    it("returns a hex color for every status", () => {
      for (const status of ALL_STATUSES) {
        const color = getStatusColor(status);
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    });

    it("uses distinct colors per status", () => {
      const colors = ALL_STATUSES.map(getStatusColor);
      const unique = new Set(colors);
      expect(unique.size).toBe(ALL_STATUSES.length);
    });
  });

  describe("getTimestampField()", () => {
    it("returns field name for statuses with timestamps", () => {
      expect(getTimestampField("CONFIRMED")).toBe("confirmedAt");
      expect(getTimestampField("SHIPPED")).toBe("shippedAt");
      expect(getTimestampField("DELIVERED")).toBe("deliveredAt");
      expect(getTimestampField("CANCELLED")).toBe("cancelledAt");
      expect(getTimestampField("REFUNDED")).toBe("refundedAt");
    });

    it("returns null for statuses without timestamps", () => {
      expect(getTimestampField("PENDING")).toBeNull();
      expect(getTimestampField("IN_PRODUCTION")).toBeNull();
    });
  });
});
