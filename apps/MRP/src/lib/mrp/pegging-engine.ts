// Pegging Engine - Demand-Supply traceability
import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";

export interface PeggingResult {
  partId: string;
  partNumber: string;
  demands: DemandPeg[];
  supplies: SupplyPeg[];
  summary: {
    onHand: number;
    totalDemand: number;
    totalSupply: number;
    projected: number;
    shortages: number;
  };
}

export interface DemandPeg {
  demandType: string;
  demandId: string;
  reference: string;
  date: Date;
  quantity: number;
  peggedQty: number;
  peggedFrom: SupplySource[];
  status: "FULLY_PEGGED" | "PARTIALLY_PEGGED" | "UNPEGGED";
}

export interface SupplyPeg {
  supplyType: string;
  supplyId: string;
  reference: string;
  date: Date;
  quantity: number;
  allocatedQty: number;
  allocatedTo: DemandSource[];
  availableQty: number;
}

export interface SupplySource {
  supplyType: string;
  supplyId: string;
  quantity: number;
}

export interface DemandSource {
  demandType: string;
  demandId: string;
  quantity: number;
}

/**
 * Generate pegging for a part
 */
export async function generatePegging(
  partId: string,
  siteId?: string,
  horizon: number = 90,
): Promise<PeggingResult> {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + horizon);

  // Get part info
  const part = await prisma.part.findUnique({
    where: { id: partId },
    include: {
      inventory: true,
    },
  });

  if (!part) throw new Error("Part not found");

  // Calculate on-hand
  const onHand = part.inventory.reduce(
    (sum, inv) => sum + inv.quantity - inv.reservedQty,
    0,
  );

  // Get all demands
  const demands = await collectDemands(partId, siteId, endDate);

  // Get all supplies
  const supplies = await collectSupplies(partId, siteId, endDate);

  // Add on-hand as first supply
  if (onHand > 0) {
    supplies.unshift({
      supplyType: "INVENTORY",
      supplyId: "ON_HAND",
      reference: "On Hand Inventory",
      date: new Date(),
      quantity: onHand,
      allocatedQty: 0,
      allocatedTo: [],
      availableQty: onHand,
    });
  }

  // Perform pegging (FIFO allocation)
  const peggedDemands = performPegging(demands, supplies);

  // Calculate summary
  const totalDemand = demands.reduce((sum, d) => sum + d.quantity, 0);
  const totalSupply = supplies.reduce((sum, s) => sum + s.quantity, 0);
  const shortages = peggedDemands
    .filter((d) => d.status !== "FULLY_PEGGED")
    .reduce((sum, d) => sum + (d.quantity - d.peggedQty), 0);

  return {
    partId,
    partNumber: part.partNumber,
    demands: peggedDemands,
    supplies,
    summary: {
      onHand,
      totalDemand,
      totalSupply,
      projected: onHand + totalSupply - totalDemand,
      shortages,
    },
  };
}

/**
 * Collect all demands for a part
 */
async function collectDemands(
  partId: string,
  siteId: string | undefined,
  endDate: Date,
): Promise<DemandPeg[]> {
  const demands: DemandPeg[] = [];

  // Work Order demands (from BOM)
  const bomLines = await prisma.bomLine.findMany({
    where: { partId },
    include: {
      bom: {
        include: {
          product: {
            include: {
              workOrders: {
                where: {
                  status: { in: ["draft", "released", "in_progress"] },
                  plannedEnd: { lte: endDate },
                },
              },
            },
          },
        },
      },
    },
  });

  for (const bomLine of bomLines) {
    for (const wo of bomLine.bom.product.workOrders) {
      const qty = wo.quantity * Number(bomLine.quantity);
      demands.push({
        demandType: "WORK_ORDER",
        demandId: wo.id,
        reference: `${wo.woNumber} - ${bomLine.bom.product.name}`,
        date: wo.plannedEnd || new Date(),
        quantity: qty,
        peggedQty: 0,
        peggedFrom: [],
        status: "UNPEGGED",
      });
    }
  }

  // Sales Order demands (direct part sales)
  const salesLines = await prisma.salesOrderLine.findMany({
    where: {
      productId: partId,
      order: {
        status: { in: ["confirmed", "processing"] },
        requiredDate: { lte: endDate },
      },
    },
    include: {
      order: true,
    },
  });

  for (const line of salesLines) {
    // SalesOrderLine doesn't have shippedQty
    if (line.quantity > 0) {
      demands.push({
        demandType: "SALES_ORDER",
        demandId: line.orderId,
        reference: `${line.order.orderNumber}`,
        date: line.order.requiredDate || new Date(),
        quantity: line.quantity,
        peggedQty: 0,
        peggedFrom: [],
        status: "UNPEGGED",
      });
    }
  }

  // Sort by date
  demands.sort((a, b) => a.date.getTime() - b.date.getTime());

  return demands;
}

/**
 * Collect all supplies for a part
 */
async function collectSupplies(
  partId: string,
  siteId: string | undefined,
  endDate: Date,
): Promise<SupplyPeg[]> {
  const supplies: SupplyPeg[] = [];

  // Purchase Orders
  const poLines = await prisma.purchaseOrderLine.findMany({
    where: {
      partId,
      po: {
        status: { in: ["approved", "sent", "partial"] },
        expectedDate: { lte: endDate },
      },
    },
    include: {
      po: { include: { supplier: true } },
    },
  });

  for (const line of poLines) {
    const openQty = line.quantity - line.receivedQty;
    if (openQty > 0) {
      supplies.push({
        supplyType: "PURCHASE_ORDER",
        supplyId: line.poId,
        reference: `${line.po.poNumber} - ${line.po.supplier.name}`,
        date: line.po.expectedDate || new Date(),
        quantity: openQty,
        allocatedQty: 0,
        allocatedTo: [],
        availableQty: openQty,
      });
    }
  }

  // Planned Orders
  const plannedOrders = await prisma.plannedOrder.findMany({
    where: {
      partId,
      status: { in: ["PLANNED", "FIRM"] },
      dueDate: { lte: endDate },
    },
  });

  for (const po of plannedOrders) {
    supplies.push({
      supplyType: "PLANNED_ORDER",
      supplyId: po.id,
      reference: `${po.orderNumber} (${po.isFirm ? "Firm" : "Planned"})`,
      date: po.dueDate,
      quantity: Number(po.quantity),
      allocatedQty: 0,
      allocatedTo: [],
      availableQty: Number(po.quantity),
    });
  }

  // Sort by date
  supplies.sort((a, b) => a.date.getTime() - b.date.getTime());

  return supplies;
}

/**
 * Perform FIFO pegging
 */
function performPegging(
  demands: DemandPeg[],
  supplies: SupplyPeg[],
): DemandPeg[] {
  for (const demand of demands) {
    let remainingDemand = demand.quantity;

    for (const supply of supplies) {
      if (remainingDemand <= 0) break;
      if (supply.availableQty <= 0) continue;

      // Calculate allocation
      const allocate = Math.min(remainingDemand, supply.availableQty);

      // Update demand
      demand.peggedQty += allocate;
      demand.peggedFrom.push({
        supplyType: supply.supplyType,
        supplyId: supply.supplyId,
        quantity: allocate,
      });

      // Update supply
      supply.allocatedQty += allocate;
      supply.availableQty -= allocate;
      supply.allocatedTo.push({
        demandType: demand.demandType,
        demandId: demand.demandId,
        quantity: allocate,
      });

      remainingDemand -= allocate;
    }

    // Set status
    if (demand.peggedQty >= demand.quantity) {
      demand.status = "FULLY_PEGGED";
    } else if (demand.peggedQty > 0) {
      demand.status = "PARTIALLY_PEGGED";
    }
  }

  return demands;
}

/**
 * Save pegging records to database
 */
export async function savePeggingRecords(
  partId: string,
  demands: DemandPeg[],
  supplies: SupplyPeg[],
  mrpRunId?: string,
): Promise<void> {
  // Delete old pegging for this part
  await prisma.peggingRecord.deleteMany({
    where: { demandPartId: partId },
  });

  // Create new pegging records
  for (const demand of demands) {
    for (const source of demand.peggedFrom) {
      const supply = supplies.find(
        (s) =>
          s.supplyId === source.supplyId && s.supplyType === source.supplyType,
      );

      await prisma.peggingRecord.create({
        data: {
          demandType: demand.demandType,
          demandId: demand.demandId,
          demandPartId: partId,
          demandQty: new Decimal(demand.quantity),
          demandDate: demand.date,
          supplyType: source.supplyType,
          supplyId: source.supplyId,
          supplyPartId: partId,
          supplyQty: new Decimal(source.quantity),
          supplyDate: supply?.date || new Date(),
          peggedQty: new Decimal(source.quantity),
          mrpRunId,
        },
      });
    }
  }
}

/**
 * Get pegging chain for a demand
 */
export async function getDemandPegging(
  demandType: string,
  demandId: string,
): Promise<{
  demand: { type: string; id: string; partId: string; qty: number; date: Date };
  supplies: Array<{ type: string; id: string; qty: number; date: Date }>;
}> {
  const records = await prisma.peggingRecord.findMany({
    where: {
      demandType,
      demandId,
      status: "ACTIVE",
    },
  });

  if (records.length === 0) {
    throw new Error("No pegging found for this demand");
  }

  return {
    demand: {
      type: records[0].demandType,
      id: records[0].demandId,
      partId: records[0].demandPartId,
      qty: Number(records[0].demandQty),
      date: records[0].demandDate,
    },
    supplies: records.map((r) => ({
      type: r.supplyType,
      id: r.supplyId,
      qty: Number(r.peggedQty),
      date: r.supplyDate,
    })),
  };
}

/**
 * Get pegging chain for a supply
 */
export async function getSupplyPegging(
  supplyType: string,
  supplyId: string,
): Promise<{
  supply: { type: string; id: string; partId: string; qty: number; date: Date };
  demands: Array<{ type: string; id: string; qty: number; date: Date }>;
}> {
  const records = await prisma.peggingRecord.findMany({
    where: {
      supplyType,
      supplyId,
      status: "ACTIVE",
    },
  });

  if (records.length === 0) {
    throw new Error("No pegging found for this supply");
  }

  return {
    supply: {
      type: records[0].supplyType,
      id: records[0].supplyId,
      partId: records[0].supplyPartId,
      qty: Number(records[0].supplyQty),
      date: records[0].supplyDate,
    },
    demands: records.map((r) => ({
      type: r.demandType,
      id: r.demandId,
      qty: Number(r.peggedQty),
      date: r.demandDate,
    })),
  };
}
