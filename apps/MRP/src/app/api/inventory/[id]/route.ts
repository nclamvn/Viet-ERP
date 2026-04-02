import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api/with-auth";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { auditUpdate } from "@/lib/audit/route-audit";

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
const updateSchema = z.object({
  quantity: z.number().optional(),
  reservedQty: z.number().optional(),
  locationCode: z.string().optional(),
  lotNumber: z.string().optional(),
  transferQty: z.number().optional(), // Partial transfer quantity
});

// GET - Fetch single inventory record with details
export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id } = await context.params;

    const inventory = await prisma.inventory.findUnique({
      where: { id },
      include: {
        part: {
          include: {
            // Include useful part details context
            partSuppliers: { include: { supplier: true } },
          },
        },
        warehouse: {
          select: {
            id: true,
            code: true,
            name: true,
            location: true,
            type: true,
          },
        },
      },
    });

    if (!inventory) {
      return NextResponse.json(
        { error: "Inventory record not found" },
        { status: 404 },
      );
    }

    // Fetch related receiving inspections for this part
    const receivingInspections = await prisma.inspection.findMany({
      where: {
        partId: inventory.partId,
        type: "RECEIVING",
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        inspectionNumber: true,
        status: true,
        result: true,
        lotNumber: true,
        quantityReceived: true,
        quantityAccepted: true,
        quantityRejected: true,
        inspectedAt: true,
        createdAt: true,
      },
    });

    // Fetch other inventory locations for the same part (different warehouses/lots)
    const otherLocations = await prisma.inventory.findMany({
      where: {
        partId: inventory.partId,
        id: { not: inventory.id }, // Exclude current record
      },
      include: {
        warehouse: true,
      },
      orderBy: { warehouse: { name: "asc" } },
    });

    return NextResponse.json({
      ...inventory,
      receivingInspections,
      otherLocations,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/inventory/[id]",
    });
    return NextResponse.json(
      { error: "Failed to fetch inventory details" },
      { status: 500 },
    );
  }
});

// Map locationCode → warehouse type
const locationToWarehouseType: Record<string, string> = {
  STOCK: "MAIN",
  RECEIVING: "RECEIVING",
  HOLD: "HOLD",
  QUARANTINE: "QUARANTINE",
  SCRAP: "SCRAP",
};

export const PATCH = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const validatedData = updateSchema.parse(body);

    // Fetch existing record
    const existing = await prisma.inventory.findUnique({
      where: { id },
      include: { warehouse: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Inventory not found" },
        { status: 404 },
      );
    }

    const isLocationChange =
      validatedData.locationCode &&
      validatedData.locationCode !== existing.locationCode;
    const transferQty = validatedData.transferQty ?? existing.quantity;

    // Validate transfer quantity
    if (
      isLocationChange &&
      (transferQty <= 0 || transferQty > existing.quantity)
    ) {
      return NextResponse.json(
        { error: `Số lượng chuyển phải từ 1 đến ${existing.quantity}` },
        { status: 400 },
      );
    }

    // If location is changing → handle warehouse transfer
    if (isLocationChange) {
      const targetWhType = locationToWarehouseType[validatedData.locationCode!];
      const needsWarehouseMove =
        targetWhType && existing.warehouse.type !== targetWhType;

      const targetWarehouse = needsWarehouseMove
        ? await prisma.warehouse.findFirst({ where: { type: targetWhType } })
        : existing.warehouse;

      if (!targetWarehouse) {
        return NextResponse.json(
          { error: "Kho đích không tồn tại" },
          { status: 400 },
        );
      }

      const isPartialTransfer = transferQty < existing.quantity;

      // Check if target already has same part+warehouse+lot
      const existingInTarget = needsWarehouseMove
        ? await prisma.inventory.findFirst({
            where: {
              partId: existing.partId,
              warehouseId: targetWarehouse.id,
              lotNumber: existing.lotNumber,
              id: { not: id },
            },
          })
        : null;

      if (isPartialTransfer) {
        // PARTIAL TRANSFER: subtract from source, add to target
        await prisma.inventory.update({
          where: { id },
          data: { quantity: existing.quantity - transferQty },
        });

        if (existingInTarget) {
          await prisma.inventory.update({
            where: { id: existingInTarget.id },
            data: { quantity: existingInTarget.quantity + transferQty },
          });
        } else {
          await prisma.inventory.create({
            data: {
              partId: existing.partId,
              warehouseId: targetWarehouse.id,
              quantity: transferQty,
              reservedQty: 0,
              lotNumber: existing.lotNumber,
              locationCode: validatedData.locationCode!,
            },
          });
        }
      } else {
        // FULL TRANSFER: move entire record
        if (existingInTarget) {
          // Merge into existing target record
          await prisma.inventory.update({
            where: { id: existingInTarget.id },
            data: { quantity: existingInTarget.quantity + existing.quantity },
          });
          await prisma.inventory.delete({ where: { id } });
        } else if (needsWarehouseMove) {
          await prisma.inventory.update({
            where: { id },
            data: {
              warehouseId: targetWarehouse.id,
              locationCode: validatedData.locationCode,
            },
          });
        } else {
          await prisma.inventory.update({
            where: { id },
            data: { locationCode: validatedData.locationCode },
          });
        }
      }

      // Audit trail
      await prisma.lotTransaction.create({
        data: {
          lotNumber: existing.lotNumber || `INV-${existing.id}`,
          transactionType: "ADJUSTED",
          partId: existing.partId,
          quantity: transferQty,
          previousQty: existing.quantity,
          newQty: existing.quantity - transferQty,
          fromWarehouseId: existing.warehouseId,
          toWarehouseId: targetWarehouse.id,
          fromLocation: existing.locationCode,
          toLocation: validatedData.locationCode,
          userId: session.user?.id || "system",
          notes: `Manual transfer: ${transferQty} units ${existing.warehouse.code}/${existing.locationCode} → ${targetWarehouse.code}/${validatedData.locationCode}${isPartialTransfer ? " (partial)" : ""}`,
        },
      });

      // Audit trail: log transfer
      auditUpdate(
        request,
        session.user,
        "Inventory",
        id,
        {
          locationCode: existing.locationCode,
          warehouseId: existing.warehouseId,
          quantity: existing.quantity,
        },
        {
          locationCode: validatedData.locationCode,
          warehouseId: targetWarehouse.id,
          quantity: existing.quantity - transferQty,
        },
      );

      return NextResponse.json({ success: true, transferred: transferQty });
    }

    // Non-transfer update (lotNumber, etc.)
    const updateData: Prisma.InventoryUpdateInput = {};
    if (validatedData.lotNumber !== undefined)
      updateData.lotNumber = validatedData.lotNumber;
    if (validatedData.quantity !== undefined)
      updateData.quantity = validatedData.quantity;

    const inventory = await prisma.inventory.update({
      where: { id },
      data: updateData,
      include: {
        part: true,
        warehouse: true,
      },
    });

    // Audit trail: log non-transfer update
    auditUpdate(
      request,
      session.user,
      "Inventory",
      id,
      existing as unknown as Record<string, unknown>,
      updateData as Record<string, unknown>,
    );

    return NextResponse.json(inventory);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "PATCH /api/inventory/[id]",
    });
    return NextResponse.json(
      { error: "Failed to update inventory" },
      { status: 500 },
    );
  }
});
