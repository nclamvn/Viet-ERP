// src/lib/inventory/picking-engine.ts
// FIFO / FEFO / ANY picking strategy engine

import { prisma } from "@/lib/prisma";
import { PickingStrategy } from ".prisma/mrp-client";

interface PickingRequest {
  partId: string;
  warehouseId: string;
  requiredQty: number;
  strategy?: PickingStrategy; // override part default
}

interface PickingAllocation {
  inventoryId: string;
  lotNumber: string | null;
  quantity: number;
  expiryDate: Date | null;
}

interface PickingResult {
  success: boolean;
  allocations: PickingAllocation[];
  totalAllocated: number;
  errors: string[];
}

/**
 * Allocate inventory using the specified picking strategy (FIFO, FEFO, or ANY).
 *
 * - FIFO: oldest lots first (by createdAt)
 * - FEFO: earliest expiry first (by expiryDate, nulls last)
 * - ANY: largest quantity first (current/legacy behavior)
 */
export async function allocateByStrategy(
  request: PickingRequest,
): Promise<PickingResult> {
  const { partId, warehouseId, requiredQty } = request;

  // Determine strategy: explicit override > part default > ANY
  let strategy = request.strategy;
  if (!strategy) {
    const part = await prisma.part.findUnique({
      where: { id: partId },
      select: { pickingStrategy: true },
    });
    strategy = part?.pickingStrategy ?? "ANY";
  }

  // Build orderBy based on strategy
  let orderBy: Record<string, string>[];
  switch (strategy) {
    case "FIFO":
      orderBy = [{ createdAt: "asc" }];
      break;
    case "FEFO":
      // Prisma sorts nulls last for asc by default on nullable fields
      orderBy = [{ expiryDate: "asc" }, { createdAt: "asc" }];
      break;
    case "ANY":
    default:
      orderBy = [{ quantity: "desc" }];
      break;
  }

  const inventoryRecords = await prisma.inventory.findMany({
    where: {
      partId,
      warehouseId,
      quantity: { gt: 0 },
    },
    orderBy,
  });

  if (inventoryRecords.length === 0) {
    return {
      success: false,
      allocations: [],
      totalAllocated: 0,
      errors: [
        `No inventory found for part ${partId} in warehouse ${warehouseId}`,
      ],
    };
  }

  // For FEFO, push records with null expiryDate to the end
  if (strategy === "FEFO") {
    inventoryRecords.sort((a, b) => {
      if (a.expiryDate === null && b.expiryDate === null) return 0;
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate.getTime() - b.expiryDate.getTime();
    });
  }

  // Greedy allocate across records
  const allocations: PickingAllocation[] = [];
  let remaining = requiredQty;

  for (const inv of inventoryRecords) {
    if (remaining <= 0) break;

    const available = inv.quantity - inv.reservedQty;
    if (available <= 0) continue;

    const allocQty = Math.min(available, remaining);
    allocations.push({
      inventoryId: inv.id,
      lotNumber: inv.lotNumber,
      quantity: allocQty,
      expiryDate: inv.expiryDate,
    });
    remaining -= allocQty;
  }

  const totalAllocated = requiredQty - remaining;

  return {
    success: remaining <= 0,
    allocations,
    totalAllocated,
    errors:
      remaining > 0
        ? [
            `Insufficient inventory: need ${requiredQty}, can allocate ${totalAllocated}`,
          ]
        : [],
  };
}

/**
 * Get sorted inventory records for a part in a warehouse using picking strategy.
 * Used by shipping/transfer operations that do their own deduction logic.
 */
export async function getSortedInventory(
  partId: string,
  warehouseId: string,
  strategy?: PickingStrategy,
) {
  // Resolve strategy
  if (!strategy) {
    const part = await prisma.part.findUnique({
      where: { id: partId },
      select: { pickingStrategy: true },
    });
    strategy = part?.pickingStrategy ?? "ANY";
  }

  let orderBy: Record<string, string>[];
  switch (strategy) {
    case "FIFO":
      orderBy = [{ createdAt: "asc" }];
      break;
    case "FEFO":
      orderBy = [{ expiryDate: "asc" }, { createdAt: "asc" }];
      break;
    case "ANY":
    default:
      orderBy = [{ quantity: "desc" }];
      break;
  }

  const records = await prisma.inventory.findMany({
    where: { partId, warehouseId },
    orderBy,
  });

  // For FEFO, push null expiryDate to end
  if (strategy === "FEFO") {
    records.sort((a, b) => {
      if (a.expiryDate === null && b.expiryDate === null) return 0;
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate.getTime() - b.expiryDate.getTime();
    });
  }

  return records;
}
