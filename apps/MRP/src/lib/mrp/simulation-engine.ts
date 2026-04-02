// Simulation Engine - What-If Scenario Planning
import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { Prisma } from ".prisma/mrp-client";

export interface SimulationParams {
  name: string;
  description?: string;
  simulationType: "MRP" | "CAPACITY" | "DEMAND" | "SUPPLY" | "COMBINED";
  demandChanges?: DemandChange[];
  supplyChanges?: SupplyChange[];
  leadTimeChanges?: LeadTimeChange[];
  capacityChanges?: CapacityChange[];
  dateRange: { start: Date; end: Date };
}

export interface DemandChange {
  partId?: string;
  category?: string;
  changeType: "PERCENT" | "ABSOLUTE";
  changeValue: number;
}

export interface SupplyChange {
  partId?: string;
  supplierId?: string;
  changeType: "DELAY_DAYS" | "REDUCE_PERCENT" | "CANCEL";
  changeValue: number;
}

export interface LeadTimeChange {
  partId?: string;
  supplierId?: string;
  changeType: "PERCENT" | "ABSOLUTE";
  changeValue: number;
}

export interface CapacityChange {
  workCenterId?: string;
  changeType: "PERCENT" | "ABSOLUTE";
  changeValue: number;
}

export interface SimulationResults {
  plannedOrders: PlannedOrderResult[];
  shortages: ShortageResult[];
  capacityIssues: CapacityIssue[];
  summary: {
    totalPlannedOrders: number;
    totalSpend: number;
    avgCapacityUtilization: number;
    shortageCount: number;
    lateOrders: number;
  };
}

export interface PlannedOrderResult {
  partId: string;
  partNumber: string;
  orderType: string;
  quantity: number;
  dueDate: Date;
  estimatedCost: number;
}

export interface ShortageResult {
  partId: string;
  partNumber: string;
  shortageQty: number;
  shortageDate: Date;
  affectedOrders: string[];
}

export interface CapacityIssue {
  workCenterId: string;
  workCenterName: string;
  periodStart: Date;
  requiredHours: number;
  availableHours: number;
  overloadPercent: number;
}

/**
 * Create a new simulation
 */
export async function createSimulation(
  params: SimulationParams,
  userId: string,
): Promise<string> {
  const simulation = await prisma.simulation.create({
    data: {
      name: params.name,
      description: params.description,
      simulationType: params.simulationType,
      parameters: params as unknown as Prisma.InputJsonValue,
      status: "DRAFT",
      createdBy: userId,
    },
  });

  return simulation.id;
}

/**
 * Run a what-if simulation
 */
export async function runSimulation(
  simulationId: string,
): Promise<SimulationResults> {
  const simulation = await prisma.simulation.findUnique({
    where: { id: simulationId },
  });

  if (!simulation) throw new Error("Simulation not found");

  // Update status
  await prisma.simulation.update({
    where: { id: simulationId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    const params = simulation.parameters as unknown as SimulationParams;

    // Create a virtual copy of current state
    const virtualState = await createVirtualState(params.dateRange);

    // Apply changes
    if (params.demandChanges && params.demandChanges.length > 0) {
      applyDemandChanges(virtualState, params.demandChanges);
    }
    if (params.supplyChanges && params.supplyChanges.length > 0) {
      applySupplyChanges(virtualState, params.supplyChanges);
    }

    // Run MRP on virtual state
    const results = runVirtualMRP(virtualState, params.dateRange);

    // Save results
    await saveSimulationResults(simulationId, results);

    // Update status
    await prisma.simulation.update({
      where: { id: simulationId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        resultsSummary: results.summary as unknown as Prisma.InputJsonValue,
      },
    });

    return results;
  } catch (error) {
    await prisma.simulation.update({
      where: { id: simulationId },
      data: { status: "FAILED" },
    });
    throw error;
  }
}

interface VirtualState {
  demands: VirtualDemand[];
  supplies: VirtualSupply[];
  inventory: Map<string, number>;
  leadTimes: Map<string, number>;
}

interface VirtualDemand {
  partId: string;
  quantity: number;
  date: Date;
  type: string;
  reference: string;
}

interface VirtualSupply {
  partId: string;
  quantity: number;
  date: Date;
  type: string;
  reference: string;
  cancelled?: boolean;
}

/**
 * Create virtual state from current data
 */
async function createVirtualState(dateRange: {
  start: Date;
  end: Date;
}): Promise<VirtualState> {
  const demands: VirtualDemand[] = [];
  const supplies: VirtualSupply[] = [];
  const inventory = new Map<string, number>();
  const leadTimes = new Map<string, number>();

  // Load inventory
  const inventoryRecords = await prisma.inventory.findMany({
    include: { part: true },
  });

  for (const inv of inventoryRecords) {
    const current = inventory.get(inv.partId) || 0;
    inventory.set(inv.partId, current + inv.quantity - inv.reservedQty);
  }

  // Load demands (Sales Orders)
  const salesLines = await prisma.salesOrderLine.findMany({
    where: {
      order: {
        status: { in: ["confirmed", "processing"] },
        requiredDate: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
    },
    include: {
      order: true,
      product: true,
    },
  });

  for (const line of salesLines) {
    // SalesOrderLine doesn't have shippedQty
    if (line.quantity > 0) {
      demands.push({
        partId: line.productId,
        quantity: line.quantity,
        date: line.order.requiredDate || new Date(),
        type: "SALES_ORDER",
        reference: line.order.orderNumber,
      });
    }
  }

  // Load supplies (Purchase Orders)
  const poLines = await prisma.purchaseOrderLine.findMany({
    where: {
      po: {
        status: { in: ["approved", "sent", "partial"] },
        expectedDate: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
    },
    include: {
      po: true,
      part: true,
    },
  });

  for (const line of poLines) {
    const openQty = line.quantity - line.receivedQty;
    if (openQty > 0) {
      supplies.push({
        partId: line.partId,
        quantity: openQty,
        date: line.po.expectedDate || new Date(),
        type: "PURCHASE_ORDER",
        reference: line.po.poNumber,
      });
    }
  }

  // Load lead times
  const parts = await prisma.part.findMany({
    include: {
      partSuppliers: true,
    },
  });

  for (const part of parts) {
    const preferredSupplier = part.partSuppliers.find((ps) => ps.isPreferred);
    const leadTime = preferredSupplier?.leadTimeDays || 14; // Default 14 days
    leadTimes.set(part.id, leadTime);
  }

  return { demands, supplies, inventory, leadTimes };
}

/**
 * Apply demand changes to virtual state
 */
function applyDemandChanges(
  state: VirtualState,
  changes: DemandChange[],
): void {
  for (const change of changes) {
    for (const demand of state.demands) {
      // Apply to specific part or all
      if (change.partId && demand.partId !== change.partId) continue;

      if (change.changeType === "PERCENT") {
        demand.quantity = demand.quantity * (1 + change.changeValue / 100);
      } else {
        demand.quantity = demand.quantity + change.changeValue;
      }
    }
  }
}

/**
 * Apply supply changes to virtual state
 */
function applySupplyChanges(
  state: VirtualState,
  changes: SupplyChange[],
): void {
  for (const change of changes) {
    for (const supply of state.supplies) {
      if (change.partId && supply.partId !== change.partId) continue;

      switch (change.changeType) {
        case "DELAY_DAYS":
          const newDate = new Date(supply.date);
          newDate.setDate(newDate.getDate() + change.changeValue);
          supply.date = newDate;
          break;
        case "REDUCE_PERCENT":
          supply.quantity = supply.quantity * (1 - change.changeValue / 100);
          break;
        case "CANCEL":
          supply.cancelled = true;
          break;
      }
    }
  }
}

/**
 * Run MRP on virtual state
 * Note: dateRange is reserved for future filtering
 */
function runVirtualMRP(
  state: VirtualState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  dateRange: { start: Date; end: Date },
): SimulationResults {
  const plannedOrders: PlannedOrderResult[] = [];
  const shortages: ShortageResult[] = [];
  const capacityIssues: CapacityIssue[] = [];

  // Group demands and supplies by part
  const partDemands = new Map<string, VirtualDemand[]>();
  const partSupplies = new Map<string, VirtualSupply[]>();

  for (const demand of state.demands) {
    const existing = partDemands.get(demand.partId) || [];
    existing.push(demand);
    partDemands.set(demand.partId, existing);
  }

  for (const supply of state.supplies) {
    if (!supply.cancelled) {
      const existing = partSupplies.get(supply.partId) || [];
      existing.push(supply);
      partSupplies.set(supply.partId, existing);
    }
  }

  // Calculate net requirements for each part
  let totalSpend = 0;
  let shortageCount = 0;

  for (const [partId, demands] of Array.from(partDemands.entries())) {
    const onHand = state.inventory.get(partId) || 0;
    const supplies = partSupplies.get(partId) || [];
    const leadTime = state.leadTimes.get(partId) || 14;

    // Sort by date
    demands.sort((a, b) => a.date.getTime() - b.date.getTime());
    supplies.sort((a, b) => a.date.getTime() - b.date.getTime());

    let available = onHand;
    let supplyIdx = 0;

    for (const demand of demands) {
      // Add supplies that arrive before this demand
      while (
        supplyIdx < supplies.length &&
        supplies[supplyIdx].date <= demand.date
      ) {
        available += supplies[supplyIdx].quantity;
        supplyIdx++;
      }

      // Check if we can fulfill
      if (available >= demand.quantity) {
        available -= demand.quantity;
      } else {
        // Create shortage
        const shortageQty = demand.quantity - available;
        shortages.push({
          partId,
          partNumber: partId, // Would need to look up
          shortageQty,
          shortageDate: demand.date,
          affectedOrders: [demand.reference],
        });
        shortageCount++;

        // Create planned order
        const dueDate = new Date(demand.date);
        dueDate.setDate(dueDate.getDate() - leadTime);

        plannedOrders.push({
          partId,
          partNumber: partId,
          orderType: "PURCHASE",
          quantity: shortageQty,
          dueDate,
          estimatedCost: shortageQty * 10, // Simplified cost
        });

        totalSpend += shortageQty * 10;
        available = 0;
      }
    }
  }

  return {
    plannedOrders,
    shortages,
    capacityIssues,
    summary: {
      totalPlannedOrders: plannedOrders.length,
      totalSpend,
      avgCapacityUtilization: 0, // Would need capacity data
      shortageCount,
      lateOrders: shortages.length,
    },
  };
}

/**
 * Save simulation results to database
 */
async function saveSimulationResults(
  simulationId: string,
  results: SimulationResults,
): Promise<void> {
  // Delete existing results
  await prisma.simulationResult.deleteMany({
    where: { simulationId },
  });

  // Save planned orders
  for (const order of results.plannedOrders) {
    await prisma.simulationResult.create({
      data: {
        simulationId,
        resultType: "PLANNED_ORDER",
        partId: order.partId,
        periodStart: order.dueDate,
        periodEnd: order.dueDate,
        quantity: new Decimal(order.quantity),
        details: order as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // Save shortages
  for (const shortage of results.shortages) {
    await prisma.simulationResult.create({
      data: {
        simulationId,
        resultType: "SHORTAGE",
        partId: shortage.partId,
        periodStart: shortage.shortageDate,
        periodEnd: shortage.shortageDate,
        quantity: new Decimal(shortage.shortageQty),
        details: shortage as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

/**
 * Compare two simulations
 */
export async function compareSimulations(simulationIds: string[]): Promise<{
  simulations: Array<{
    id: string;
    name: string;
    summary: Record<string, unknown>;
  }>;
  variances: {
    plannedOrders: number[];
    totalSpend: number[];
    shortages: number[];
  };
}> {
  const simulations = await prisma.simulation.findMany({
    where: { id: { in: simulationIds } },
  });

  const summaries = simulations.map((s) => ({
    id: s.id,
    name: s.name,
    summary: (s.resultsSummary as Record<string, unknown>) || {},
  }));

  // Calculate variances
  const variances = {
    plannedOrders: summaries.map(
      (s) => (s.summary.totalPlannedOrders as number) || 0,
    ),
    totalSpend: summaries.map((s) => (s.summary.totalSpend as number) || 0),
    shortages: summaries.map((s) => (s.summary.shortageCount as number) || 0),
  };

  return { simulations: summaries, variances };
}

/**
 * Get simulation by ID
 */
export async function getSimulation(simulationId: string) {
  return prisma.simulation.findUnique({
    where: { id: simulationId },
    include: {
      results: {
        orderBy: { periodStart: "asc" },
      },
    },
  });
}

/**
 * Delete simulation
 */
export async function deleteSimulation(simulationId: string): Promise<void> {
  await prisma.simulation.delete({
    where: { id: simulationId },
  });
}
