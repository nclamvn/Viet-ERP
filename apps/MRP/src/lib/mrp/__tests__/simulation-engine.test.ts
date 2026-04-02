/**
 * Simulation Engine - Unit Tests
 * Tests for createSimulation, runSimulation, compareSimulations,
 * getSimulation, deleteSimulation, and internal virtual state functions
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock prisma using vi.hoisted
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    simulation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    simulationResult: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    inventory: {
      findMany: vi.fn(),
    },
    salesOrderLine: {
      findMany: vi.fn(),
    },
    purchaseOrderLine: {
      findMany: vi.fn(),
    },
    part: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock Decimal as a proper constructor class
vi.mock("decimal.js", () => ({
  Decimal: class Decimal {
    value: number;
    constructor(val: number) {
      this.value = val;
    }
  },
}));

import {
  createSimulation,
  runSimulation,
  compareSimulations,
  getSimulation,
  deleteSimulation,
  type SimulationParams,
} from "../simulation-engine";

describe("Simulation Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // createSimulation
  // ===========================================================================
  describe("createSimulation", () => {
    it("should create a simulation and return its id", async () => {
      mockPrisma.simulation.create.mockResolvedValue({ id: "sim-1" });

      const params: SimulationParams = {
        name: "Test Simulation",
        description: "A test",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      const id = await createSimulation(params, "user-1");

      expect(id).toBe("sim-1");
      expect(mockPrisma.simulation.create).toHaveBeenCalledWith({
        data: {
          name: "Test Simulation",
          description: "A test",
          simulationType: "MRP",
          parameters: params,
          status: "DRAFT",
          createdBy: "user-1",
        },
      });
    });

    it("should create simulation without optional description", async () => {
      mockPrisma.simulation.create.mockResolvedValue({ id: "sim-2" });

      const params: SimulationParams = {
        name: "No Description",
        simulationType: "CAPACITY",
        dateRange: { start: new Date(), end: new Date() },
      };

      const id = await createSimulation(params, "user-1");

      expect(id).toBe("sim-2");
      expect(mockPrisma.simulation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: undefined,
            simulationType: "CAPACITY",
          }),
        }),
      );
    });

    it("should support all simulation types", async () => {
      const types = [
        "MRP",
        "CAPACITY",
        "DEMAND",
        "SUPPLY",
        "COMBINED",
      ] as const;

      for (const simType of types) {
        mockPrisma.simulation.create.mockResolvedValue({
          id: `sim-${simType}`,
        });

        const params: SimulationParams = {
          name: `Test ${simType}`,
          simulationType: simType,
          dateRange: { start: new Date(), end: new Date() },
        };

        const id = await createSimulation(params, "user-1");
        expect(id).toBe(`sim-${simType}`);
      }
    });
  });

  // ===========================================================================
  // runSimulation
  // ===========================================================================
  describe("runSimulation", () => {
    function setupVirtualStateMocks() {
      mockPrisma.inventory.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});
    }

    it("should throw error when simulation not found", async () => {
      mockPrisma.simulation.findUnique.mockResolvedValue(null);

      await expect(runSimulation("nonexistent")).rejects.toThrow(
        "Simulation not found",
      );
    });

    it("should run simulation with no changes and return empty results", async () => {
      const simParams: SimulationParams = {
        name: "Test",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});
      setupVirtualStateMocks();

      const result = await runSimulation("sim-1");

      expect(result.plannedOrders).toEqual([]);
      expect(result.shortages).toEqual([]);
      expect(result.capacityIssues).toEqual([]);
      expect(result.summary.totalPlannedOrders).toBe(0);
      expect(result.summary.totalSpend).toBe(0);
      expect(result.summary.shortageCount).toBe(0);

      // Should update status to RUNNING then COMPLETED
      expect(mockPrisma.simulation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "RUNNING" }),
        }),
      );
      expect(mockPrisma.simulation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );
    });

    it("should apply demand changes with PERCENT type", async () => {
      const simParams: SimulationParams = {
        name: "Demand Increase",
        simulationType: "DEMAND",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
        demandChanges: [
          { changeType: "PERCENT", changeValue: 50 }, // Increase all demand by 50%
        ],
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      // Inventory with 10 units
      mockPrisma.inventory.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: 10,
          reservedQty: 0,
          part: { id: "part-1" },
        },
      ]);

      // Sales order demanding 10 units => after 50% increase = 15
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 10,
          order: {
            orderNumber: "SO-001",
            requiredDate: new Date(2026, 3, 1),
            status: "confirmed",
          },
          product: { id: "part-1" },
        },
      ]);

      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        {
          id: "part-1",
          partSuppliers: [{ isPreferred: true, leadTimeDays: 7 }],
        },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // 10 * 1.5 = 15, on hand = 10 => shortage of 5
      expect(result.shortages).toHaveLength(1);
      expect(result.shortages[0].shortageQty).toBe(5);
      expect(result.plannedOrders).toHaveLength(1);
      expect(result.plannedOrders[0].quantity).toBe(5);
      expect(result.summary.shortageCount).toBe(1);
    });

    it("should apply demand changes with ABSOLUTE type", async () => {
      const simParams: SimulationParams = {
        name: "Demand Absolute",
        simulationType: "DEMAND",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
        demandChanges: [
          { changeType: "ABSOLUTE", changeValue: 5 }, // Add 5 to all demand
        ],
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([
        { partId: "part-1", quantity: 10, reservedQty: 0 },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 8,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // 8 + 5 = 13, on hand = 10 => shortage of 3
      expect(result.shortages).toHaveLength(1);
      expect(result.shortages[0].shortageQty).toBe(3);
    });

    it("should apply demand changes to specific part only", async () => {
      const simParams: SimulationParams = {
        name: "Specific Part Demand",
        simulationType: "DEMAND",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
        demandChanges: [
          { partId: "part-1", changeType: "PERCENT", changeValue: 100 },
        ],
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([
        { partId: "part-1", quantity: 10, reservedQty: 0 },
        { partId: "part-2", quantity: 5, reservedQty: 0 },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 5,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
        {
          productId: "part-2",
          quantity: 3,
          order: { orderNumber: "SO-002", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
        { id: "part-2", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // part-1: 5 * 2 = 10, on hand = 10 => no shortage
      // part-2: 3, on hand = 5 => no shortage (not affected by change)
      expect(result.shortages).toHaveLength(0);
    });

    it("should apply supply changes with DELAY_DAYS", async () => {
      const simParams: SimulationParams = {
        name: "Supply Delay",
        simulationType: "SUPPLY",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
        supplyChanges: [{ changeType: "DELAY_DAYS", changeValue: 30 }],
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([
        { partId: "part-1", quantity: 0, reservedQty: 0 },
      ]);
      // Demand of 10 due March 15
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 10,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 2, 15) },
        },
      ]);
      // Supply of 10 expected March 10 => with 30 day delay, arrives April 9
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: 10,
          receivedQty: 0,
          po: { poNumber: "PO-001", expectedDate: new Date(2026, 2, 10) },
          part: { id: "part-1" },
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([
        {
          id: "part-1",
          partSuppliers: [{ isPreferred: true, leadTimeDays: 7 }],
        },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // Supply delayed past demand date => shortage
      expect(result.shortages).toHaveLength(1);
      expect(result.shortages[0].shortageQty).toBe(10);
    });

    it("should apply supply changes with REDUCE_PERCENT", async () => {
      const simParams: SimulationParams = {
        name: "Supply Reduce",
        simulationType: "SUPPLY",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
        supplyChanges: [{ changeType: "REDUCE_PERCENT", changeValue: 50 }],
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([
        { partId: "part-1", quantity: 0, reservedQty: 0 },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 10,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      // Supply of 10 arrives before demand
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: 10,
          receivedQty: 0,
          po: { poNumber: "PO-001", expectedDate: new Date(2026, 2, 1) },
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // Supply reduced to 5 (50% of 10), demand = 10 => shortage of 5
      expect(result.shortages).toHaveLength(1);
      expect(result.shortages[0].shortageQty).toBe(5);
    });

    it("should apply supply changes with CANCEL", async () => {
      const simParams: SimulationParams = {
        name: "Supply Cancel",
        simulationType: "SUPPLY",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
        supplyChanges: [{ changeType: "CANCEL", changeValue: 0 }],
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([
        { partId: "part-1", quantity: 0, reservedQty: 0 },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 10,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: 10,
          receivedQty: 0,
          po: { poNumber: "PO-001", expectedDate: new Date(2026, 2, 1) },
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // Supply cancelled => shortage of 10
      expect(result.shortages).toHaveLength(1);
      expect(result.shortages[0].shortageQty).toBe(10);
    });

    it("should handle inventory with reservedQty", async () => {
      const simParams: SimulationParams = {
        name: "Reserved Qty",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      // 20 in stock, 15 reserved => 5 available
      mockPrisma.inventory.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: 20,
          reservedQty: 15,
          part: { id: "part-1" },
        },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 8,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // Available = 20 - 15 = 5, demand = 8 => shortage of 3
      expect(result.shortages).toHaveLength(1);
      expect(result.shortages[0].shortageQty).toBe(3);
    });

    it("should aggregate inventory for same partId across multiple records", async () => {
      const simParams: SimulationParams = {
        name: "Multi Inventory",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      // Two inventory records for same part: 5-0 + 10-2 = 13 available
      mockPrisma.inventory.findMany.mockResolvedValue([
        { partId: "part-1", quantity: 5, reservedQty: 0 },
        { partId: "part-1", quantity: 10, reservedQty: 2 },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 10,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // Available = 13, demand = 10 => no shortage
      expect(result.shortages).toHaveLength(0);
    });

    it("should handle PO lines with partial receipt (open quantity)", async () => {
      const simParams: SimulationParams = {
        name: "Partial Receipt",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([
        { partId: "part-1", quantity: 0, reservedQty: 0 },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 8,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 15) },
        },
      ]);
      // PO for 10, already received 7 => open qty = 3
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: 10,
          receivedQty: 7,
          po: { poNumber: "PO-001", expectedDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // open supply = 3, demand = 8 => shortage of 5
      expect(result.shortages).toHaveLength(1);
      expect(result.shortages[0].shortageQty).toBe(5);
    });

    it("should skip PO lines with zero open quantity", async () => {
      const simParams: SimulationParams = {
        name: "Fully Received",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([
        { partId: "part-1", quantity: 5, reservedQty: 0 },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 3,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      // Fully received PO line
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: 10,
          receivedQty: 10,
          po: { poNumber: "PO-001", expectedDate: new Date(2026, 2, 1) },
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // 5 on hand >= 3 demand => no shortage
      expect(result.shortages).toHaveLength(0);
    });

    it("should use preferred supplier lead time", async () => {
      const simParams: SimulationParams = {
        name: "Lead Time",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 5,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 15) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        {
          id: "part-1",
          partSuppliers: [
            { isPreferred: false, leadTimeDays: 30 },
            { isPreferred: true, leadTimeDays: 10 },
          ],
        },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      expect(result.plannedOrders).toHaveLength(1);
      // Due date = demand date - 10 days lead time
      const expectedDueDate = new Date(2026, 3, 15);
      expectedDueDate.setDate(expectedDueDate.getDate() - 10);
      expect(result.plannedOrders[0].dueDate.toISOString().split("T")[0]).toBe(
        expectedDueDate.toISOString().split("T")[0],
      );
    });

    it("should use default 14-day lead time when no preferred supplier", async () => {
      const simParams: SimulationParams = {
        name: "Default Lead Time",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 5,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 15) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      expect(result.plannedOrders).toHaveLength(1);
      const expectedDueDate = new Date(2026, 3, 15);
      expectedDueDate.setDate(expectedDueDate.getDate() - 14);
      expect(result.plannedOrders[0].dueDate.toISOString().split("T")[0]).toBe(
        expectedDueDate.toISOString().split("T")[0],
      );
    });

    it("should calculate estimated cost as quantity * 10", async () => {
      const simParams: SimulationParams = {
        name: "Cost Check",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 7,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      expect(result.plannedOrders[0].estimatedCost).toBe(70); // 7 * 10
      expect(result.summary.totalSpend).toBe(70);
    });

    it("should set status to FAILED when internal error occurs", async () => {
      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: {
          name: "Failing",
          simulationType: "MRP",
          dateRange: { start: new Date(), end: new Date() },
        },
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      // Make inventory query fail to trigger error
      mockPrisma.inventory.findMany.mockRejectedValue(new Error("DB error"));

      await expect(runSimulation("sim-1")).rejects.toThrow("DB error");

      expect(mockPrisma.simulation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
    });

    it("should save planned orders and shortages as simulation results", async () => {
      const simParams: SimulationParams = {
        name: "Save Results",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 5,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      await runSimulation("sim-1");

      // Should delete existing results first
      expect(mockPrisma.simulationResult.deleteMany).toHaveBeenCalledWith({
        where: { simulationId: "sim-1" },
      });

      // Should create PLANNED_ORDER and SHORTAGE results
      expect(mockPrisma.simulationResult.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.simulationResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            simulationId: "sim-1",
            resultType: "PLANNED_ORDER",
          }),
        }),
      );
      expect(mockPrisma.simulationResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            simulationId: "sim-1",
            resultType: "SHORTAGE",
          }),
        }),
      );
    });

    it("should handle sales order line with zero quantity (skip)", async () => {
      const simParams: SimulationParams = {
        name: "Zero Qty",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 0, // Zero quantity - should be skipped
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      expect(result.shortages).toHaveLength(0);
    });

    it("should handle null requiredDate on sales order (defaults to now)", async () => {
      const simParams: SimulationParams = {
        name: "Null Date",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 11, 31) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 5,
          order: { orderNumber: "SO-001", requiredDate: null },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      expect(result.shortages).toHaveLength(1);
      // Should have used current date as fallback
      expect(result.shortages[0].shortageDate).toBeInstanceOf(Date);
    });

    it("should handle supply arriving before demand fulfills it", async () => {
      const simParams: SimulationParams = {
        name: "Supply Before Demand",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([
        { partId: "part-1", quantity: 0, reservedQty: 0 },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 10,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 15) },
        },
      ]);
      // Supply arrives before demand date
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: 15,
          receivedQty: 0,
          po: { poNumber: "PO-001", expectedDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // Supply of 15 arrives before demand of 10 => no shortage
      expect(result.shortages).toHaveLength(0);
    });

    it("should handle multiple demands sorted by date", async () => {
      const simParams: SimulationParams = {
        name: "Multiple Demands",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([
        { partId: "part-1", quantity: 5, reservedQty: 0 },
      ]);
      // Two demands for same part
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 3,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
        {
          productId: "part-1",
          quantity: 4,
          order: { orderNumber: "SO-002", requiredDate: new Date(2026, 3, 15) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // On hand=5, first demand=3 => 2 remaining, second demand=4 => shortage of 2
      expect(result.shortages).toHaveLength(1);
      expect(result.shortages[0].shortageQty).toBe(2);
      expect(result.shortages[0].affectedOrders).toContain("SO-002");
    });

    it("should handle no demandChanges or supplyChanges gracefully", async () => {
      const simParams: SimulationParams = {
        name: "No Changes",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
        demandChanges: [],
        supplyChanges: [],
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.part.findMany.mockResolvedValue([]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      expect(result.plannedOrders).toHaveLength(0);
      expect(result.shortages).toHaveLength(0);
    });

    it("should handle supply changes targeting specific partId", async () => {
      const simParams: SimulationParams = {
        name: "Specific Supply Change",
        simulationType: "SUPPLY",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 5, 30) },
        supplyChanges: [
          { partId: "part-1", changeType: "CANCEL", changeValue: 0 },
        ],
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 5,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 3, 1) },
        },
        {
          productId: "part-2",
          quantity: 3,
          order: { orderNumber: "SO-002", requiredDate: new Date(2026, 3, 1) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: 10,
          receivedQty: 0,
          po: { poNumber: "PO-001", expectedDate: new Date(2026, 2, 1) },
        },
        {
          partId: "part-2",
          quantity: 10,
          receivedQty: 0,
          po: { poNumber: "PO-002", expectedDate: new Date(2026, 2, 1) },
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
        { id: "part-2", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // part-1: supply cancelled, demand=5 => shortage of 5
      // part-2: supply of 10 available, demand=3 => no shortage
      expect(result.shortages).toHaveLength(1);
      expect(result.shortages[0].partId).toBe("part-1");
    });

    it("should handle null expectedDate on PO (defaults to now)", async () => {
      const simParams: SimulationParams = {
        name: "Null PO Date",
        simulationType: "MRP",
        dateRange: { start: new Date(2026, 0, 1), end: new Date(2026, 11, 31) },
      };

      mockPrisma.simulation.findUnique.mockResolvedValue({
        id: "sim-1",
        parameters: simParams,
      });
      mockPrisma.simulation.update.mockResolvedValue({});

      mockPrisma.inventory.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          quantity: 5,
          order: { orderNumber: "SO-001", requiredDate: new Date(2026, 11, 1) },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: 10,
          receivedQty: 0,
          po: { poNumber: "PO-001", expectedDate: null },
        },
      ]);
      mockPrisma.part.findMany.mockResolvedValue([
        { id: "part-1", partSuppliers: [] },
      ]);
      mockPrisma.simulationResult.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.simulationResult.create.mockResolvedValue({});

      const result = await runSimulation("sim-1");

      // Supply with null date defaults to now, arrives before demand Dec 1 => no shortage
      expect(result.shortages).toHaveLength(0);
    });
  });

  // ===========================================================================
  // compareSimulations
  // ===========================================================================
  describe("compareSimulations", () => {
    it("should compare multiple simulations and return variances", async () => {
      mockPrisma.simulation.findMany.mockResolvedValue([
        {
          id: "sim-1",
          name: "Baseline",
          resultsSummary: {
            totalPlannedOrders: 10,
            totalSpend: 5000,
            shortageCount: 2,
          },
        },
        {
          id: "sim-2",
          name: "Demand +20%",
          resultsSummary: {
            totalPlannedOrders: 15,
            totalSpend: 7500,
            shortageCount: 5,
          },
        },
      ]);

      const result = await compareSimulations(["sim-1", "sim-2"]);

      expect(result.simulations).toHaveLength(2);
      expect(result.variances.plannedOrders).toEqual([10, 15]);
      expect(result.variances.totalSpend).toEqual([5000, 7500]);
      expect(result.variances.shortages).toEqual([2, 5]);
    });

    it("should handle simulations with null resultsSummary", async () => {
      mockPrisma.simulation.findMany.mockResolvedValue([
        {
          id: "sim-1",
          name: "No Results",
          resultsSummary: null,
        },
      ]);

      const result = await compareSimulations(["sim-1"]);

      expect(result.simulations[0].summary).toEqual({});
      expect(result.variances.plannedOrders).toEqual([0]);
      expect(result.variances.totalSpend).toEqual([0]);
      expect(result.variances.shortages).toEqual([0]);
    });

    it("should handle empty simulation list", async () => {
      mockPrisma.simulation.findMany.mockResolvedValue([]);

      const result = await compareSimulations([]);

      expect(result.simulations).toHaveLength(0);
      expect(result.variances.plannedOrders).toEqual([]);
    });
  });

  // ===========================================================================
  // getSimulation
  // ===========================================================================
  describe("getSimulation", () => {
    it("should return simulation with results", async () => {
      const mockSim = {
        id: "sim-1",
        name: "Test",
        results: [{ id: "r1", resultType: "PLANNED_ORDER" }],
      };
      mockPrisma.simulation.findUnique.mockResolvedValue(mockSim);

      const result = await getSimulation("sim-1");

      expect(result).toEqual(mockSim);
      expect(mockPrisma.simulation.findUnique).toHaveBeenCalledWith({
        where: { id: "sim-1" },
        include: {
          results: {
            orderBy: { periodStart: "asc" },
          },
        },
      });
    });

    it("should return null for nonexistent simulation", async () => {
      mockPrisma.simulation.findUnique.mockResolvedValue(null);

      const result = await getSimulation("nonexistent");

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // deleteSimulation
  // ===========================================================================
  describe("deleteSimulation", () => {
    it("should delete simulation by id", async () => {
      mockPrisma.simulation.delete.mockResolvedValue({});

      await deleteSimulation("sim-1");

      expect(mockPrisma.simulation.delete).toHaveBeenCalledWith({
        where: { id: "sim-1" },
      });
    });

    it("should propagate error if delete fails", async () => {
      mockPrisma.simulation.delete.mockRejectedValue(new Error("Not found"));

      await expect(deleteSimulation("nonexistent")).rejects.toThrow(
        "Not found",
      );
    });
  });
});
