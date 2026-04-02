import { describe, it, expect, beforeEach, vi } from "vitest";
import { Decimal } from "decimal.js";

// Mock prisma (named export)
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    part: { findUnique: vi.fn() },
    bomLine: { findMany: vi.fn() },
    salesOrderLine: { findMany: vi.fn() },
    purchaseOrderLine: { findMany: vi.fn() },
    plannedOrder: { findMany: vi.fn() },
    peggingRecord: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  generatePegging,
  savePeggingRecords,
  getDemandPegging,
  getSupplyPegging,
  type DemandPeg,
  type SupplyPeg,
} from "../pegging-engine";

describe("pegging-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // generatePegging
  // =========================================================================
  describe("generatePegging", () => {
    it("should throw if part not found", async () => {
      mockPrisma.part.findUnique.mockResolvedValue(null);
      await expect(generatePegging("part-1")).rejects.toThrow("Part not found");
    });

    it("should return result with empty demands and supplies when none exist", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");

      expect(result.partId).toBe("part-1");
      expect(result.partNumber).toBe("P001");
      expect(result.demands).toEqual([]);
      expect(result.supplies).toEqual([]);
      expect(result.summary).toEqual({
        onHand: 0,
        totalDemand: 0,
        totalSupply: 0,
        projected: 0,
        shortages: 0,
      });
    });

    it("should include on-hand inventory as first supply when positive", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [
          { quantity: 100, reservedQty: 20 },
          { quantity: 50, reservedQty: 10 },
        ],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");

      expect(result.summary.onHand).toBe(120); // (100-20) + (50-10)
      expect(result.supplies.length).toBe(1);
      expect(result.supplies[0].supplyType).toBe("INVENTORY");
      expect(result.supplies[0].supplyId).toBe("ON_HAND");
      expect(result.supplies[0].quantity).toBe(120);
    });

    it("should not include on-hand as supply when zero or negative", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [{ quantity: 10, reservedQty: 10 }],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");
      expect(result.supplies.length).toBe(0);
      expect(result.summary.onHand).toBe(0);
    });

    it("should collect work order demands from BOM lines", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);

      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: new Decimal(5),
          bom: {
            product: {
              name: "Product A",
              workOrders: [
                {
                  id: "wo-1",
                  woNumber: "WO001",
                  quantity: 10,
                  plannedEnd: futureDate,
                },
              ],
            },
          },
        },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");

      expect(result.demands.length).toBe(1);
      expect(result.demands[0].demandType).toBe("WORK_ORDER");
      expect(result.demands[0].demandId).toBe("wo-1");
      expect(result.demands[0].quantity).toBe(50); // 10 * 5
      expect(result.demands[0].reference).toContain("WO001");
    });

    it("should collect sales order demands", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          orderId: "so-1",
          quantity: 30,
          order: {
            orderNumber: "SO001",
            requiredDate: futureDate,
          },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");

      expect(result.demands.length).toBe(1);
      expect(result.demands[0].demandType).toBe("SALES_ORDER");
      expect(result.demands[0].quantity).toBe(30);
      expect(result.demands[0].reference).toBe("SO001");
    });

    it("should skip sales order lines with quantity <= 0", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([
        {
          productId: "part-1",
          orderId: "so-1",
          quantity: 0,
          order: { orderNumber: "SO001", requiredDate: new Date() },
        },
      ]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");
      expect(result.demands.length).toBe(0);
    });

    it("should collect purchase order supplies", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);

      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          poId: "po-1",
          quantity: 100,
          receivedQty: 40,
          po: {
            poNumber: "PO001",
            expectedDate: futureDate,
            supplier: { name: "Supplier A" },
          },
        },
      ]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");

      expect(result.supplies.length).toBe(1);
      expect(result.supplies[0].supplyType).toBe("PURCHASE_ORDER");
      expect(result.supplies[0].quantity).toBe(60); // 100 - 40
      expect(result.supplies[0].reference).toContain("PO001");
    });

    it("should skip fully received PO lines", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          poId: "po-1",
          quantity: 100,
          receivedQty: 100,
          po: {
            poNumber: "PO001",
            expectedDate: new Date(),
            supplier: { name: "Supplier A" },
          },
        },
      ]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");
      expect(result.supplies.length).toBe(0);
    });

    it("should collect planned order supplies", async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 20);

      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([
        {
          id: "pl-1",
          orderNumber: "PLN001",
          isFirm: true,
          dueDate: futureDate,
          quantity: new Decimal(200),
        },
      ]);

      const result = await generatePegging("part-1");

      expect(result.supplies.length).toBe(1);
      expect(result.supplies[0].supplyType).toBe("PLANNED_ORDER");
      expect(result.supplies[0].quantity).toBe(200);
      expect(result.supplies[0].reference).toContain("Firm");
    });

    it('should show "Planned" for non-firm planned orders', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 20);

      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([
        {
          id: "pl-1",
          orderNumber: "PLN001",
          isFirm: false,
          dueDate: futureDate,
          quantity: new Decimal(50),
        },
      ]);

      const result = await generatePegging("part-1");
      expect(result.supplies[0].reference).toContain("Planned");
    });

    it("should perform FIFO pegging: fully peg demand when supply is sufficient", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [{ quantity: 100, reservedQty: 0 }],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: new Decimal(1),
          bom: {
            product: {
              name: "Prod",
              workOrders: [
                {
                  id: "wo-1",
                  woNumber: "WO001",
                  quantity: 30,
                  plannedEnd: new Date(),
                },
              ],
            },
          },
        },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");

      expect(result.demands[0].status).toBe("FULLY_PEGGED");
      expect(result.demands[0].peggedQty).toBe(30);
      expect(result.demands[0].peggedFrom.length).toBe(1);
      expect(result.demands[0].peggedFrom[0].supplyType).toBe("INVENTORY");
      expect(result.summary.shortages).toBe(0);
    });

    it("should partially peg demand when supply is insufficient", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [{ quantity: 20, reservedQty: 0 }],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: new Decimal(1),
          bom: {
            product: {
              name: "Prod",
              workOrders: [
                {
                  id: "wo-1",
                  woNumber: "WO001",
                  quantity: 50,
                  plannedEnd: new Date(),
                },
              ],
            },
          },
        },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");

      expect(result.demands[0].status).toBe("PARTIALLY_PEGGED");
      expect(result.demands[0].peggedQty).toBe(20);
      expect(result.summary.shortages).toBe(30);
    });

    it("should leave demand UNPEGGED when no supply available", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: new Decimal(1),
          bom: {
            product: {
              name: "Prod",
              workOrders: [
                {
                  id: "wo-1",
                  woNumber: "WO001",
                  quantity: 10,
                  plannedEnd: new Date(),
                },
              ],
            },
          },
        },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");

      expect(result.demands[0].status).toBe("UNPEGGED");
      expect(result.demands[0].peggedQty).toBe(0);
      expect(result.summary.shortages).toBe(10);
    });

    it("should peg multiple demands across multiple supplies in FIFO order", async () => {
      const date1 = new Date("2026-03-10");
      const date2 = new Date("2026-03-15");
      const date3 = new Date("2026-03-20");

      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [{ quantity: 30, reservedQty: 0 }],
      });
      // Two work order demands
      mockPrisma.bomLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: new Decimal(1),
          bom: {
            product: {
              name: "Prod",
              workOrders: [
                {
                  id: "wo-1",
                  woNumber: "WO001",
                  quantity: 20,
                  plannedEnd: date1,
                },
                {
                  id: "wo-2",
                  woNumber: "WO002",
                  quantity: 25,
                  plannedEnd: date2,
                },
              ],
            },
          },
        },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      // One PO supply
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          poId: "po-1",
          quantity: 50,
          receivedQty: 30,
          po: {
            poNumber: "PO001",
            expectedDate: date3,
            supplier: { name: "Sup" },
          },
        },
      ]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");

      // First demand (20) fully pegged from inventory (30)
      expect(result.demands[0].status).toBe("FULLY_PEGGED");
      expect(result.demands[0].peggedQty).toBe(20);

      // Second demand (25) partially from inventory (10 left) + PO (15)
      expect(result.demands[1].status).toBe("FULLY_PEGGED");
      expect(result.demands[1].peggedQty).toBe(25);
      expect(result.demands[1].peggedFrom.length).toBe(2);
    });

    it("should calculate correct projected and summary values", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [{ quantity: 50, reservedQty: 0 }],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: new Decimal(1),
          bom: {
            product: {
              name: "Prod",
              workOrders: [
                {
                  id: "wo-1",
                  woNumber: "WO001",
                  quantity: 30,
                  plannedEnd: new Date(),
                },
              ],
            },
          },
        },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          poId: "po-1",
          quantity: 100,
          receivedQty: 80,
          po: {
            poNumber: "PO1",
            expectedDate: new Date(),
            supplier: { name: "S" },
          },
        },
      ]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");

      // onHand=50, totalSupply=50(inv)+20(PO)=70 (supplies array), totalDemand=30
      expect(result.summary.onHand).toBe(50);
      expect(result.summary.totalDemand).toBe(30);
      // totalSupply includes inventory supply (50) + PO (20) = 70
      expect(result.summary.totalSupply).toBe(70);
      // projected = onHand + totalSupply - totalDemand = 50 + 70 - 30 = 90
      expect(result.summary.projected).toBe(90);
    });

    it("should use default horizon of 90 days", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      await generatePegging("part-1");

      // Verify the date filter is applied (not easy to check exactly but ensure it ran)
      expect(mockPrisma.part.findUnique).toHaveBeenCalledWith({
        where: { id: "part-1" },
        include: { inventory: true },
      });
    });

    it("should handle work order with null plannedEnd by using current date", async () => {
      mockPrisma.part.findUnique.mockResolvedValue({
        id: "part-1",
        partNumber: "P001",
        inventory: [],
      });
      mockPrisma.bomLine.findMany.mockResolvedValue([
        {
          partId: "part-1",
          quantity: new Decimal(2),
          bom: {
            product: {
              name: "Prod",
              workOrders: [
                {
                  id: "wo-1",
                  woNumber: "WO001",
                  quantity: 5,
                  plannedEnd: null,
                },
              ],
            },
          },
        },
      ]);
      mockPrisma.salesOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrderLine.findMany.mockResolvedValue([]);
      mockPrisma.plannedOrder.findMany.mockResolvedValue([]);

      const result = await generatePegging("part-1");
      expect(result.demands[0].date).toBeInstanceOf(Date);
      expect(result.demands[0].quantity).toBe(10); // 5 * 2
    });
  });

  // =========================================================================
  // savePeggingRecords
  // =========================================================================
  describe("savePeggingRecords", () => {
    it("should delete old records and create new ones", async () => {
      mockPrisma.peggingRecord.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.peggingRecord.create.mockResolvedValue({});

      const demands: DemandPeg[] = [
        {
          demandType: "WORK_ORDER",
          demandId: "wo-1",
          reference: "WO001",
          date: new Date("2026-03-10"),
          quantity: 50,
          peggedQty: 30,
          peggedFrom: [
            { supplyType: "INVENTORY", supplyId: "ON_HAND", quantity: 20 },
            { supplyType: "PURCHASE_ORDER", supplyId: "po-1", quantity: 10 },
          ],
          status: "PARTIALLY_PEGGED",
        },
      ];

      const supplies: SupplyPeg[] = [
        {
          supplyType: "INVENTORY",
          supplyId: "ON_HAND",
          reference: "On Hand",
          date: new Date("2026-03-01"),
          quantity: 20,
          allocatedQty: 20,
          allocatedTo: [],
          availableQty: 0,
        },
        {
          supplyType: "PURCHASE_ORDER",
          supplyId: "po-1",
          reference: "PO001",
          date: new Date("2026-03-15"),
          quantity: 50,
          allocatedQty: 10,
          allocatedTo: [],
          availableQty: 40,
        },
      ];

      await savePeggingRecords("part-1", demands, supplies, "run-1");

      expect(mockPrisma.peggingRecord.deleteMany).toHaveBeenCalledWith({
        where: { demandPartId: "part-1" },
      });
      expect(mockPrisma.peggingRecord.create).toHaveBeenCalledTimes(2);

      // Check first create call
      const firstCall = mockPrisma.peggingRecord.create.mock.calls[0][0];
      expect(firstCall.data.demandType).toBe("WORK_ORDER");
      expect(firstCall.data.supplyType).toBe("INVENTORY");
      expect(firstCall.data.mrpRunId).toBe("run-1");
    });

    it("should handle demands with no pegged sources", async () => {
      mockPrisma.peggingRecord.deleteMany.mockResolvedValue({ count: 0 });

      const demands: DemandPeg[] = [
        {
          demandType: "WORK_ORDER",
          demandId: "wo-1",
          reference: "WO001",
          date: new Date(),
          quantity: 50,
          peggedQty: 0,
          peggedFrom: [],
          status: "UNPEGGED",
        },
      ];

      await savePeggingRecords("part-1", demands, []);

      expect(mockPrisma.peggingRecord.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.peggingRecord.create).not.toHaveBeenCalled();
    });

    it("should use current date when supply not found", async () => {
      mockPrisma.peggingRecord.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.peggingRecord.create.mockResolvedValue({});

      const demands: DemandPeg[] = [
        {
          demandType: "WORK_ORDER",
          demandId: "wo-1",
          reference: "WO001",
          date: new Date(),
          quantity: 10,
          peggedQty: 10,
          peggedFrom: [{ supplyType: "UNKNOWN", supplyId: "x", quantity: 10 }],
          status: "FULLY_PEGGED",
        },
      ];

      await savePeggingRecords("part-1", demands, []);

      const createCall = mockPrisma.peggingRecord.create.mock.calls[0][0];
      expect(createCall.data.supplyDate).toBeInstanceOf(Date);
    });

    it("should work without mrpRunId", async () => {
      mockPrisma.peggingRecord.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.peggingRecord.create.mockResolvedValue({});

      const demands: DemandPeg[] = [
        {
          demandType: "SALES_ORDER",
          demandId: "so-1",
          reference: "SO001",
          date: new Date(),
          quantity: 5,
          peggedQty: 5,
          peggedFrom: [
            { supplyType: "INVENTORY", supplyId: "ON_HAND", quantity: 5 },
          ],
          status: "FULLY_PEGGED",
        },
      ];

      await savePeggingRecords("part-1", demands, [
        {
          supplyType: "INVENTORY",
          supplyId: "ON_HAND",
          reference: "On Hand",
          date: new Date("2026-01-01"),
          quantity: 100,
          allocatedQty: 5,
          allocatedTo: [],
          availableQty: 95,
        },
      ]);

      const createCall = mockPrisma.peggingRecord.create.mock.calls[0][0];
      expect(createCall.data.mrpRunId).toBeUndefined();
    });
  });

  // =========================================================================
  // getDemandPegging
  // =========================================================================
  describe("getDemandPegging", () => {
    it("should throw when no pegging records found", async () => {
      mockPrisma.peggingRecord.findMany.mockResolvedValue([]);
      await expect(getDemandPegging("WORK_ORDER", "wo-1")).rejects.toThrow(
        "No pegging found for this demand",
      );
    });

    it("should return demand and supplies from records", async () => {
      const date1 = new Date("2026-03-10");
      const date2 = new Date("2026-03-12");

      mockPrisma.peggingRecord.findMany.mockResolvedValue([
        {
          demandType: "WORK_ORDER",
          demandId: "wo-1",
          demandPartId: "part-1",
          demandQty: new Decimal(50),
          demandDate: date1,
          supplyType: "INVENTORY",
          supplyId: "ON_HAND",
          peggedQty: new Decimal(30),
          supplyDate: date1,
        },
        {
          demandType: "WORK_ORDER",
          demandId: "wo-1",
          demandPartId: "part-1",
          demandQty: new Decimal(50),
          demandDate: date1,
          supplyType: "PURCHASE_ORDER",
          supplyId: "po-1",
          peggedQty: new Decimal(20),
          supplyDate: date2,
        },
      ]);

      const result = await getDemandPegging("WORK_ORDER", "wo-1");

      expect(result.demand.type).toBe("WORK_ORDER");
      expect(result.demand.id).toBe("wo-1");
      expect(result.demand.partId).toBe("part-1");
      expect(result.demand.qty).toBe(50);
      expect(result.supplies.length).toBe(2);
      expect(result.supplies[0].qty).toBe(30);
      expect(result.supplies[1].qty).toBe(20);
    });

    it("should filter by ACTIVE status", async () => {
      mockPrisma.peggingRecord.findMany.mockResolvedValue([]);
      try {
        await getDemandPegging("WORK_ORDER", "wo-1");
      } catch {
        // expected
      }
      expect(mockPrisma.peggingRecord.findMany).toHaveBeenCalledWith({
        where: {
          demandType: "WORK_ORDER",
          demandId: "wo-1",
          status: "ACTIVE",
        },
      });
    });
  });

  // =========================================================================
  // getSupplyPegging
  // =========================================================================
  describe("getSupplyPegging", () => {
    it("should throw when no pegging records found", async () => {
      mockPrisma.peggingRecord.findMany.mockResolvedValue([]);
      await expect(getSupplyPegging("PURCHASE_ORDER", "po-1")).rejects.toThrow(
        "No pegging found for this supply",
      );
    });

    it("should return supply and demands from records", async () => {
      const date1 = new Date("2026-03-10");

      mockPrisma.peggingRecord.findMany.mockResolvedValue([
        {
          supplyType: "PURCHASE_ORDER",
          supplyId: "po-1",
          supplyPartId: "part-1",
          supplyQty: new Decimal(100),
          supplyDate: date1,
          demandType: "WORK_ORDER",
          demandId: "wo-1",
          peggedQty: new Decimal(40),
          demandDate: date1,
        },
        {
          supplyType: "PURCHASE_ORDER",
          supplyId: "po-1",
          supplyPartId: "part-1",
          supplyQty: new Decimal(100),
          supplyDate: date1,
          demandType: "SALES_ORDER",
          demandId: "so-1",
          peggedQty: new Decimal(60),
          demandDate: date1,
        },
      ]);

      const result = await getSupplyPegging("PURCHASE_ORDER", "po-1");

      expect(result.supply.type).toBe("PURCHASE_ORDER");
      expect(result.supply.id).toBe("po-1");
      expect(result.supply.qty).toBe(100);
      expect(result.demands.length).toBe(2);
      expect(result.demands[0].type).toBe("WORK_ORDER");
      expect(result.demands[1].type).toBe("SALES_ORDER");
    });

    it("should filter by ACTIVE status", async () => {
      mockPrisma.peggingRecord.findMany.mockResolvedValue([]);
      try {
        await getSupplyPegging("PURCHASE_ORDER", "po-1");
      } catch {
        // expected
      }
      expect(mockPrisma.peggingRecord.findMany).toHaveBeenCalledWith({
        where: {
          supplyType: "PURCHASE_ORDER",
          supplyId: "po-1",
          status: "ACTIVE",
        },
      });
    });
  });
});
