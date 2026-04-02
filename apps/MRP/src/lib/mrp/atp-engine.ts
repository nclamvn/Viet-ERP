// ATP/CTP Engine - Available to Promise / Capable to Promise
import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";

export interface ATPResult {
  partId: string;
  partNumber: string;
  requestedQty: number;
  requestedDate: Date;
  atpQty: number;
  atpDate: Date | null;
  ctpQty: number;
  ctpDate: Date | null;
  grid: ATPBucket[];
  ctpDetails?: CTPDetails;
}

export interface ATPBucket {
  periodStart: Date;
  periodEnd: Date;
  beginningQty: number;
  supplyQty: number;
  demandQty: number;
  atpQty: number;
  cumulativeATP: number;
}

export interface CTPDetails {
  canProduce: boolean;
  startDate: Date;
  completionDate: Date;
  productionQty: number;
  capacityAvailable: boolean;
  componentsAvailable: ComponentAvailability[];
  totalProductionHours: number;
}

export interface ComponentAvailability {
  partId: string;
  partNumber: string;
  required: number;
  available: number;
  shortage: number;
  availableDate: Date | null;
}

/**
 * Calculate ATP (Available to Promise)
 */
export async function calculateATP(
  partId: string,
  requestedQty: number,
  requestedDate: Date,
  siteId?: string,
  horizon: number = 90,
): Promise<ATPResult> {
  const part = await prisma.part.findUnique({
    where: { id: partId },
    include: {
      inventory: true,
    },
  });

  if (!part) throw new Error("Part not found");

  // Calculate on-hand (available = total - reserved)
  const onHand = part.inventory.reduce(
    (sum, inv) => sum + inv.quantity - inv.reservedQty,
    0,
  );

  // Build ATP grid
  const grid = await buildATPGrid(partId, siteId, horizon, onHand);

  // Find ATP quantity and date
  let atpQty = 0;
  let atpDate: Date | null = null;

  // First check if we can fulfill from current inventory
  if (onHand >= requestedQty) {
    atpQty = requestedQty;
    atpDate = new Date();
  } else {
    // Look through buckets to find when we can fulfill
    for (const bucket of grid) {
      if (bucket.cumulativeATP >= requestedQty && !atpDate) {
        atpQty = requestedQty;
        atpDate = bucket.periodStart;
        break;
      }
    }
  }

  // If ATP not sufficient, calculate CTP
  let ctpQty = 0;
  let ctpDate: Date | null = null;
  let ctpDetails: CTPDetails | undefined;

  if (atpQty < requestedQty) {
    ctpDetails = await calculateCTP(
      partId,
      requestedQty - atpQty,
      requestedDate,
      siteId,
    );
    if (ctpDetails.canProduce) {
      ctpQty = ctpDetails.productionQty;
      ctpDate = ctpDetails.completionDate;
    }
  }

  return {
    partId,
    partNumber: part.partNumber,
    requestedQty,
    requestedDate,
    atpQty,
    atpDate,
    ctpQty,
    ctpDate,
    grid,
    ctpDetails,
  };
}

/**
 * Build ATP grid by time buckets
 */
async function buildATPGrid(
  partId: string,
  siteId: string | undefined,
  horizon: number,
  startingQty: number,
): Promise<ATPBucket[]> {
  const grid: ATPBucket[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + horizon);

  // Get all supplies
  const supplies = await getSupplies(partId, endDate);

  // Get all demands
  const demands = await getDemands(partId, endDate);

  // Build weekly buckets
  const currentDate = new Date(today);
  let cumulativeATP = startingQty;

  for (let week = 0; week < Math.ceil(horizon / 7); week++) {
    const periodStart = new Date(currentDate);
    const periodEnd = new Date(currentDate);
    periodEnd.setDate(periodEnd.getDate() + 6);

    // Sum supply in this period
    const periodSupply = supplies
      .filter((s) => s.date >= periodStart && s.date <= periodEnd)
      .reduce((sum, s) => sum + s.quantity, 0);

    // Sum demand in this period
    const periodDemand = demands
      .filter((d) => d.date >= periodStart && d.date <= periodEnd)
      .reduce((sum, d) => sum + d.quantity, 0);

    const beginningQty = cumulativeATP;
    const atpQty = beginningQty + periodSupply - periodDemand;
    cumulativeATP = Math.max(0, atpQty);

    grid.push({
      periodStart,
      periodEnd,
      beginningQty,
      supplyQty: periodSupply,
      demandQty: periodDemand,
      atpQty,
      cumulativeATP,
    });

    currentDate.setDate(currentDate.getDate() + 7);
  }

  return grid;
}

/**
 * Get supplies for ATP calculation
 */
async function getSupplies(
  partId: string,
  endDate: Date,
): Promise<Array<{ date: Date; quantity: number; type: string }>> {
  const supplies: Array<{ date: Date; quantity: number; type: string }> = [];

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
      po: true,
    },
  });

  for (const line of poLines) {
    const openQty = line.quantity - line.receivedQty;
    if (openQty > 0 && line.po.expectedDate) {
      supplies.push({
        date: line.po.expectedDate,
        quantity: openQty,
        type: "PO",
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
      date: po.dueDate,
      quantity: Number(po.quantity),
      type: "PLANNED",
    });
  }

  return supplies.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Get demands for ATP calculation
 */
async function getDemands(
  partId: string,
  endDate: Date,
): Promise<Array<{ date: Date; quantity: number; type: string }>> {
  const demands: Array<{ date: Date; quantity: number; type: string }> = [];

  // Sales Orders
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
    // Subtract already shipped quantity from demand
    const remainingDemand = line.quantity - (line.shippedQty || 0);
    if (remainingDemand > 0 && line.order.requiredDate) {
      demands.push({
        date: line.order.requiredDate,
        quantity: remainingDemand,
        type: "SO",
      });
    }
  }

  // Work Order demands (from BOM)
  // Find BOMs that use this part as a component
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
      if (wo.plannedEnd) {
        demands.push({
          date: wo.plannedEnd,
          quantity: wo.quantity * Number(bomLine.quantity),
          type: "WO",
        });
      }
    }
  }

  return demands.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Calculate CTP (Capable to Promise) - can we make it?
 * Note: requestedDate and siteId are reserved for future use
 */
async function calculateCTP(
  partId: string,
  quantity: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  requestedDate: Date,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  siteId?: string,
): Promise<CTPDetails> {
  // Get part with BOM
  const part = await prisma.part.findUnique({
    where: { id: partId },
  });

  if (!part) {
    return {
      canProduce: false,
      startDate: new Date(),
      completionDate: new Date(),
      productionQty: 0,
      capacityAvailable: false,
      componentsAvailable: [],
      totalProductionHours: 0,
    };
  }

  // Get BOM for this part (if it's a product) via BomHeader
  const bomHeader = await prisma.bomHeader.findFirst({
    where: { productId: partId, status: "active" },
    include: {
      bomLines: {
        include: {
          part: {
            include: {
              inventory: true,
            },
          },
        },
      },
    },
  });

  const bomLines = bomHeader?.bomLines || [];

  // Check component availability
  const componentsAvailable: ComponentAvailability[] = [];
  let allComponentsAvailable = true;
  const latestComponentDate = new Date();

  for (const bomLine of bomLines) {
    const required = quantity * Number(bomLine.quantity);
    const available = bomLine.part.inventory.reduce(
      (sum, inv) => sum + inv.quantity - inv.reservedQty,
      0,
    );
    const shortage = Math.max(0, required - available);

    componentsAvailable.push({
      partId: bomLine.partId,
      partNumber: bomLine.part.partNumber,
      required,
      available,
      shortage,
      availableDate: shortage > 0 ? null : new Date(),
    });

    if (shortage > 0) {
      allComponentsAvailable = false;
    }
  }

  // Estimate production time using product data if available
  const product = await prisma.product.findFirst({
    where: { OR: [{ id: partId }, { sku: part.partNumber }] },
    select: { assemblyHours: true, testingHours: true },
  });
  const assemblyHours = product?.assemblyHours || 0;
  const testingHours = product?.testingHours || 0;
  const estimatedHoursPerUnit = assemblyHours + testingHours || 1; // Fallback to 1hr if no data
  const totalProductionHours = quantity * estimatedHoursPerUnit;
  const productionDays = Math.ceil(totalProductionHours / 8); // 8-hour days

  // Calculate dates
  const startDate = allComponentsAvailable ? new Date() : latestComponentDate;
  const completionDate = new Date(startDate);
  completionDate.setDate(completionDate.getDate() + productionDays);

  // Simple capacity check - assume capacity is available if production < 30 days
  const capacityAvailable = productionDays <= 30;

  return {
    canProduce: allComponentsAvailable && capacityAvailable,
    startDate,
    completionDate,
    productionQty: quantity,
    capacityAvailable,
    componentsAvailable,
    totalProductionHours,
  };
}

/**
 * Check ATP for multiple items (batch check)
 */
export async function checkBatchATP(
  items: Array<{ partId: string; quantity: number; requiredDate: Date }>,
): Promise<
  Array<{
    partId: string;
    available: boolean;
    atpDate: Date | null;
    shortage: number;
  }>
> {
  const results = [];

  for (const item of items) {
    const atp = await calculateATP(
      item.partId,
      item.quantity,
      item.requiredDate,
    );

    results.push({
      partId: item.partId,
      available: atp.atpQty >= item.quantity,
      atpDate: atp.atpDate,
      shortage: Math.max(0, item.quantity - atp.atpQty - atp.ctpQty),
    });
  }

  return results;
}

/**
 * Update ATP records in database (for reporting)
 */
export async function updateATPRecords(
  partId: string,
  grid: ATPBucket[],
  siteId?: string,
): Promise<void> {
  // Delete existing records
  await prisma.aTPRecord.deleteMany({
    where: {
      partId,
      siteId: siteId || null,
    },
  });

  // Create new records
  for (const bucket of grid) {
    await prisma.aTPRecord.create({
      data: {
        partId,
        siteId,
        bucketDate: bucket.periodStart,
        bucketType: "WEEKLY",
        beginningQty: new Decimal(bucket.beginningQty),
        supplyQty: new Decimal(bucket.supplyQty),
        demandQty: new Decimal(bucket.demandQty),
        atpQty: new Decimal(bucket.atpQty),
        cumulativeATP: new Decimal(bucket.cumulativeATP),
      },
    });
  }
}
