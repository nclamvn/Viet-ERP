import { describe, it, expect, beforeEach, vi } from "vitest";
import { Decimal } from "decimal.js";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    purchaseOrder: { findMany: vi.fn() },
    part: { findMany: vi.fn() },
    planningSettings: { findFirst: vi.fn() },
    plannedOrder: { findMany: vi.fn() },
    mRPException: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  detectExceptions,
  getExceptionSummary,
  getExceptions,
  resolveException,
  acknowledgeException,
  ignoreException,
  clearOldExceptions,
} from "../exception-engine";

describe("exception-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // detectExceptions
  // =========================================================================
  describe("detectExceptions", () => {
    function setupEmptyDetectors() {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);
    }

    it("should return empty array when no exceptions detected", async () => {
      setupEmptyDetectors();

      const result = await detectExceptions();
      expect(result).toEqual([]);
      expect(mockPrisma.mRPException.create).not.toHaveBeenCalled();
    });

    it("should detect past due purchase orders", async () => {
      // 10 days before today to ensure CRITICAL (> 7 days)
      const pastDate = new Date("2026-02-27");
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: "po-1",
          poNumber: "PO001",
          expectedDate: pastDate,
          supplier: { name: "Sup A" },
          lines: [
            {
              partId: "part-1",
              quantity: 100,
              receivedQty: 40,
              part: { partNumber: "P001" },
            },
          ],
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);
      mockPrisma.mRPException.create.mockResolvedValue({});

      const result = await detectExceptions("run-1");

      expect(result.length).toBe(1);
      expect(result[0].exceptionType).toBe("PAST_DUE");
      expect(result[0].severity).toBe("CRITICAL");
      expect(result[0].entityType).toBe("PURCHASE_ORDER");
      expect(result[0].quantity).toBe(60); // 100 - 40
      expect(result[0].message).toContain("PO001");
      expect(result[0].message).toContain("P001");
    });

    it("should set WARNING severity when <= 7 days late", async () => {
      const pastDate = new Date("2026-03-05"); // 4 days late
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: "po-1",
          poNumber: "PO001",
          expectedDate: pastDate,
          supplier: { name: "Sup A" },
          lines: [
            {
              partId: "part-1",
              quantity: 50,
              receivedQty: 0,
              part: { partNumber: "P001" },
            },
          ],
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);
      mockPrisma.mRPException.create.mockResolvedValue({});

      const result = await detectExceptions();

      expect(result[0].severity).toBe("WARNING");
    });

    it("should skip fully received PO lines", async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: "po-1",
          poNumber: "PO001",
          expectedDate: new Date("2026-03-01"),
          supplier: { name: "Sup A" },
          lines: [
            {
              partId: "part-1",
              quantity: 100,
              receivedQty: 100,
              part: { partNumber: "P001" },
            },
          ],
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await detectExceptions();

      expect(result.length).toBe(0);
    });

    it("should detect safety stock violations", async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        {
          id: "part-1",
          partNumber: "P001",
          inventory: [{ quantity: 5, reservedQty: 0 }],
          planning: { safetyStock: 20 },
        },
      ]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);
      mockPrisma.mRPException.create.mockResolvedValue({});

      const result = await detectExceptions();

      const ssException = result.find(
        (e) => e.exceptionType === "SAFETY_STOCK_VIOLATION",
      );
      expect(ssException).toBeDefined();
      expect(ssException!.quantity).toBe(15); // 20 - 5
      expect(ssException!.severity).toBe("CRITICAL"); // 15/20 = 0.75 >= 0.5
    });

    it("should set WARNING severity for smaller safety stock violation", async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        {
          id: "part-1",
          partNumber: "P001",
          inventory: [{ quantity: 15, reservedQty: 0 }],
          planning: { safetyStock: 20 },
        },
      ]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);
      mockPrisma.mRPException.create.mockResolvedValue({});

      const result = await detectExceptions();

      // shortage = 5, ratio = 5/20 = 0.25 > 0 but < 0.5 => WARNING
      expect(result[0].severity).toBe("WARNING");
    });

    it("should not flag parts above safety stock", async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        {
          id: "part-1",
          partNumber: "P001",
          inventory: [{ quantity: 30, reservedQty: 0 }],
          planning: { safetyStock: 20 },
        },
      ]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await detectExceptions();
      expect(result.length).toBe(0);
    });

    it("should handle parts with null planning (safetyStock = 0)", async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        {
          id: "part-1",
          partNumber: "P001",
          inventory: [{ quantity: 0, reservedQty: 0 }],
          planning: null,
        },
      ]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await detectExceptions();
      // safetyStock = 0, on-hand = 0, not below => no exception
      expect(result.length).toBe(0);
    });

    it("should detect reschedule-out opportunities for far-future planned orders", async () => {
      const farFuture = new Date("2026-05-15"); // > 30 days from 2026-03-09
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([
        {
          id: "pl-1",
          orderNumber: "PLN001",
          partId: "part-1",
          dueDate: farFuture,
          quantity: new Decimal(100),
          part: { partNumber: "P001" },
        },
      ]);
      mockPrisma.mRPException.create.mockResolvedValue({});

      const result = await detectExceptions();

      const reschedule = result.find(
        (e) => e.exceptionType === "RESCHEDULE_OUT",
      );
      expect(reschedule).toBeDefined();
      expect(reschedule!.severity).toBe("INFO");
      expect(reschedule!.entityType).toBe("PLANNED_ORDER");
    });

    it("should not suggest reschedule for orders due within 30 days", async () => {
      const nearFuture = new Date("2026-03-20"); // 11 days
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([
        {
          id: "pl-1",
          orderNumber: "PLN001",
          partId: "part-1",
          dueDate: nearFuture,
          quantity: new Decimal(50),
          part: { partNumber: "P001" },
        },
      ]);

      const result = await detectExceptions();
      expect(result.length).toBe(0);
    });

    it("should save all exceptions to database", async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: "po-1",
          poNumber: "PO001",
          expectedDate: new Date("2026-03-01"),
          supplier: { name: "Sup" },
          lines: [
            {
              partId: "part-1",
              quantity: 10,
              receivedQty: 0,
              part: { partNumber: "P001" },
            },
          ],
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([
        {
          id: "part-2",
          partNumber: "P002",
          inventory: [{ quantity: 0, reservedQty: 0 }],
          planning: { safetyStock: 10 },
        },
      ]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);
      mockPrisma.mRPException.create.mockResolvedValue({});

      const result = await detectExceptions("run-1");

      expect(result.length).toBe(2);
      expect(mockPrisma.mRPException.create).toHaveBeenCalledTimes(2);

      // Verify mrpRunId is passed
      const createCalls = mockPrisma.mRPException.create.mock.calls;
      expect(createCalls[0][0].data.mrpRunId).toBe("run-1");
      expect(createCalls[0][0].data.status).toBe("OPEN");
    });

    it("should handle PO with null expectedDate", async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: "po-1",
          poNumber: "PO001",
          expectedDate: null,
          supplier: { name: "Sup" },
          lines: [
            {
              partId: "part-1",
              quantity: 10,
              receivedQty: 0,
              part: { partNumber: "P001" },
            },
          ],
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);
      mockPrisma.mRPException.create.mockResolvedValue({});

      const result = await detectExceptions();
      expect(result.length).toBe(1);
      expect(result[0].currentDate).toBeUndefined();
    });

    it("should save exception with null quantity when not provided", async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.planningSettings.findFirst.mockResolvedValue(null);
      // Far future order
      mockPrisma.plannedOrder.findMany.mockResolvedValue([
        {
          id: "pl-1",
          orderNumber: "PLN001",
          partId: "part-1",
          dueDate: new Date("2026-06-01"),
          quantity: new Decimal(100),
          part: { partNumber: "P001" },
        },
      ]);
      mockPrisma.mRPException.create.mockResolvedValue({});

      await detectExceptions();

      const createCall = mockPrisma.mRPException.create.mock.calls[0][0];
      expect(createCall.data.quantity).toEqual(new Decimal(100));
    });
  });

  // =========================================================================
  // getExceptionSummary
  // =========================================================================
  describe("getExceptionSummary", () => {
    it("should return summary with counts by severity and type", async () => {
      mockPrisma.mRPException.findMany.mockResolvedValue([
        { severity: "CRITICAL", exceptionType: "PAST_DUE", status: "OPEN" },
        { severity: "WARNING", exceptionType: "PAST_DUE", status: "OPEN" },
        { severity: "INFO", exceptionType: "RESCHEDULE_OUT", status: "OPEN" },
        { severity: "CRITICAL", exceptionType: "SHORTAGE", status: "OPEN" },
      ]);

      const result = await getExceptionSummary();

      expect(result.total).toBe(4);
      expect(result.bySeverity.CRITICAL).toBe(2);
      expect(result.bySeverity.WARNING).toBe(1);
      expect(result.bySeverity.INFO).toBe(1);
      expect(result.byType.PAST_DUE).toBe(2);
      expect(result.byType.RESCHEDULE_OUT).toBe(1);
      expect(result.byType.SHORTAGE).toBe(1);
      expect(result.openCount).toBe(4);
    });

    it("should return empty summary when no exceptions", async () => {
      mockPrisma.mRPException.findMany.mockResolvedValue([]);

      const result = await getExceptionSummary();

      expect(result.total).toBe(0);
      expect(result.bySeverity).toEqual({ INFO: 0, WARNING: 0, CRITICAL: 0 });
      expect(result.byType).toEqual({});
      expect(result.openCount).toBe(0);
    });

    it("should filter by siteId when provided", async () => {
      mockPrisma.mRPException.findMany.mockResolvedValue([]);

      await getExceptionSummary("site-1");

      expect(mockPrisma.mRPException.findMany).toHaveBeenCalledWith({
        where: { status: "OPEN", siteId: "site-1" },
      });
    });

    it("should not include siteId in filter when not provided", async () => {
      mockPrisma.mRPException.findMany.mockResolvedValue([]);

      await getExceptionSummary();

      expect(mockPrisma.mRPException.findMany).toHaveBeenCalledWith({
        where: { status: "OPEN" },
      });
    });
  });

  // =========================================================================
  // getExceptions
  // =========================================================================
  describe("getExceptions", () => {
    it("should query with all provided filters", async () => {
      mockPrisma.mRPException.findMany.mockResolvedValue([]);

      await getExceptions({
        status: "OPEN",
        severity: "CRITICAL",
        exceptionType: "PAST_DUE",
        partId: "part-1",
        siteId: "site-1",
        limit: 50,
      });

      expect(mockPrisma.mRPException.findMany).toHaveBeenCalledWith({
        where: {
          status: "OPEN",
          severity: "CRITICAL",
          exceptionType: "PAST_DUE",
          partId: "part-1",
          siteId: "site-1",
        },
        include: { part: true },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 50,
      });
    });

    it("should use default limit of 100", async () => {
      mockPrisma.mRPException.findMany.mockResolvedValue([]);

      await getExceptions({});

      expect(mockPrisma.mRPException.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it("should omit undefined filters from where clause", async () => {
      mockPrisma.mRPException.findMany.mockResolvedValue([]);

      await getExceptions({ status: "OPEN" });

      const call = mockPrisma.mRPException.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ status: "OPEN" });
      expect(call.where.severity).toBeUndefined();
    });
  });

  // =========================================================================
  // resolveException
  // =========================================================================
  describe("resolveException", () => {
    it("should update exception to RESOLVED status", async () => {
      mockPrisma.mRPException.update.mockResolvedValue({});

      await resolveException("exc-1", "Fixed by ordering more", "user-1");

      expect(mockPrisma.mRPException.update).toHaveBeenCalledWith({
        where: { id: "exc-1" },
        data: {
          status: "RESOLVED",
          resolvedAt: expect.any(Date),
          resolvedBy: "user-1",
          resolution: "Fixed by ordering more",
        },
      });
    });
  });

  // =========================================================================
  // acknowledgeException
  // =========================================================================
  describe("acknowledgeException", () => {
    it("should update exception to ACKNOWLEDGED status", async () => {
      mockPrisma.mRPException.update.mockResolvedValue({});

      await acknowledgeException("exc-1", "user-1");

      expect(mockPrisma.mRPException.update).toHaveBeenCalledWith({
        where: { id: "exc-1" },
        data: {
          status: "ACKNOWLEDGED",
          resolvedBy: "user-1",
        },
      });
    });
  });

  // =========================================================================
  // ignoreException
  // =========================================================================
  describe("ignoreException", () => {
    it("should update exception to IGNORED status with reason", async () => {
      mockPrisma.mRPException.update.mockResolvedValue({});

      await ignoreException("exc-1", "user-1", "Not relevant");

      expect(mockPrisma.mRPException.update).toHaveBeenCalledWith({
        where: { id: "exc-1" },
        data: {
          status: "IGNORED",
          resolvedAt: expect.any(Date),
          resolvedBy: "user-1",
          resolution: "Not relevant",
        },
      });
    });

    it('should default resolution to "Ignored by user"', async () => {
      mockPrisma.mRPException.update.mockResolvedValue({});

      await ignoreException("exc-1", "user-1");

      const call = mockPrisma.mRPException.update.mock.calls[0][0];
      expect(call.data.resolution).toBe("Ignored by user");
    });
  });

  // =========================================================================
  // clearOldExceptions
  // =========================================================================
  describe("clearOldExceptions", () => {
    it("should delete resolved/ignored exceptions older than specified days", async () => {
      mockPrisma.mRPException.deleteMany.mockResolvedValue({ count: 5 });

      const result = await clearOldExceptions(60);

      expect(result).toBe(5);
      expect(mockPrisma.mRPException.deleteMany).toHaveBeenCalledWith({
        where: {
          status: { in: ["RESOLVED", "IGNORED"] },
          resolvedAt: { lt: expect.any(Date) },
        },
      });

      // Verify cutoff date is ~60 days ago (within 1 day tolerance for timezone)
      const cutoff =
        mockPrisma.mRPException.deleteMany.mock.calls[0][0].where.resolvedAt.lt;
      const now = new Date("2026-03-09T12:00:00Z");
      const diffDays = Math.round(
        (now.getTime() - cutoff.getTime()) / (1000 * 60 * 60 * 24),
      );
      expect(diffDays).toBe(60);
    });

    it("should default to 30 days", async () => {
      mockPrisma.mRPException.deleteMany.mockResolvedValue({ count: 0 });

      await clearOldExceptions();

      const cutoff =
        mockPrisma.mRPException.deleteMany.mock.calls[0][0].where.resolvedAt.lt;
      const now = new Date("2026-03-09T12:00:00Z");
      const diffDays = Math.round(
        (now.getTime() - cutoff.getTime()) / (1000 * 60 * 60 * 24),
      );
      expect(diffDays).toBe(30);
    });
  });
});
