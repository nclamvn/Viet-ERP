import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api/with-auth";
import { logger } from "@/lib/logger";

const inspectionPutSchema = z
  .object({
    status: z.string().optional(),
    result: z.enum(["PASS", "FAIL", "CONDITIONAL"]).optional(),
    quantityInspected: z.number().int().min(0).optional(),
    quantityAccepted: z.number().int().min(0).optional(),
    quantityRejected: z.number().int().min(0).optional(),
    notes: z.string().optional(),
    lotNumber: z.string().optional(),
  })
  .passthrough();

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";

// GET - Get single inspection
export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id } = await context.params;

    const includeRelations = {
      part: { select: { id: true, partNumber: true, name: true, unit: true } },
      product: { select: { id: true, sku: true, name: true } },
      plan: { select: { id: true, planNumber: true, name: true } },
      workOrder: {
        select: { id: true, woNumber: true, status: true, completedQty: true },
      },
      results: {
        include: { characteristic: true },
        orderBy: { inspectedAt: "asc" as const },
      },
    };

    // Try by ID first, then fallback to inspectionNumber
    let inspection = await prisma.inspection.findUnique({
      where: { id },
      include: includeRelations,
    });

    if (!inspection) {
      inspection = await prisma.inspection.findUnique({
        where: { inspectionNumber: id },
        include: includeRelations,
      });
    }

    if (!inspection) {
      return NextResponse.json(
        { error: "Inspection not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(inspection);
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/quality/inspections/[id]",
    });
    return NextResponse.json(
      { error: "Failed to fetch inspection" },
      { status: 500 },
    );
  }
});

// PUT - Update inspection (status, result, etc.)
export const PUT = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const parsed = inspectionPutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Dữ liệu không hợp lệ",
          errors: parsed.error.issues,
        },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // Try by ID first, then fallback to inspectionNumber
    let existing = await prisma.inspection.findUnique({
      where: { id },
      include: { part: true },
    });
    if (!existing) {
      existing = await prisma.inspection.findUnique({
        where: { inspectionNumber: id },
        include: { part: true },
      });
    }
    if (!existing) {
      return NextResponse.json(
        { error: "Inspection not found" },
        { status: 404 },
      );
    }

    // Prevent re-completing an already completed inspection
    if (data.status === "completed" && existing.status === "completed") {
      return NextResponse.json(
        {
          error:
            "Inspection này đã hoàn thành trước đó. Không thể complete lại.",
        },
        { status: 409 },
      );
    }

    const updateData: Prisma.InspectionUpdateInput = {};
    if (data.status) updateData.status = data.status;
    if (data.result) updateData.result = data.result;
    if (data.quantityInspected !== undefined)
      updateData.quantityInspected = data.quantityInspected;
    if (data.quantityAccepted !== undefined)
      updateData.quantityAccepted = data.quantityAccepted;
    if (data.quantityRejected !== undefined)
      updateData.quantityRejected = data.quantityRejected;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.lotNumber !== undefined) updateData.lotNumber = data.lotNumber;

    if (data.status === "completed") {
      updateData.inspectedAt = new Date();
    }

    const inspection = await prisma.inspection.update({
      where: { id: existing.id },
      data: updateData,
      include: {
        part: {
          select: { id: true, partNumber: true, name: true, unit: true },
        },
        results: { include: { characteristic: true } },
      },
    });

    // When RECEIVING inspection is completed, handle inventory based on result
    if (
      data.status === "completed" &&
      existing.type === "RECEIVING" &&
      existing.partId &&
      data.result
    ) {
      const lotNumber =
        data.lotNumber ||
        existing.lotNumber ||
        `INS-${existing.inspectionNumber}`;
      const acceptedQty =
        data.quantityAccepted ?? existing.quantityAccepted ?? 0;
      const rejectedQty =
        data.quantityRejected ?? existing.quantityRejected ?? 0;

      // Build inventory moves based on result
      // Each result can produce multiple moves (e.g. CONDITIONAL → HOLD + QUARANTINE)
      const moves: {
        warehouseType: string;
        quantity: number;
        locationCode: string;
        fallbackDefault?: boolean;
      }[] = [];

      if (data.result === "PASS") {
        // All accepted → Main Warehouse
        moves.push({
          warehouseType: "MAIN",
          quantity: acceptedQty,
          locationCode: "STOCK",
          fallbackDefault: true,
        });
      } else if (data.result === "FAIL") {
        // All rejected → Quarantine
        moves.push({
          warehouseType: "QUARANTINE",
          quantity: rejectedQty,
          locationCode: "QUARANTINE",
        });
      } else if (data.result === "CONDITIONAL") {
        // Accepted → Hold, Rejected → Quarantine
        moves.push({
          warehouseType: "HOLD",
          quantity: acceptedQty,
          locationCode: "HOLD",
        });
        moves.push({
          warehouseType: "QUARANTINE",
          quantity: rejectedQty,
          locationCode: "QUARANTINE",
        });
      }

      // Find source RECEIVING inventory before moves
      const receivingInventory = await prisma.inventory.findFirst({
        where: {
          partId: existing.partId,
          locationCode: "RECEIVING",
        },
        include: { warehouse: true },
      });

      // Execute each inventory move + audit trail
      for (const move of moves) {
        if (move.quantity <= 0) continue;

        let targetWarehouse = await prisma.warehouse.findFirst({
          where: { type: move.warehouseType },
        });
        // Fallback to default warehouse for PASS
        if (!targetWarehouse && move.fallbackDefault) {
          targetWarehouse = await prisma.warehouse.findFirst({
            where: { isDefault: true },
          });
        }
        if (!targetWarehouse) continue;

        // Check if inventory already exists for this part + warehouse + lot
        const existingInventory = await prisma.inventory.findFirst({
          where: {
            partId: existing.partId,
            warehouseId: targetWarehouse.id,
            lotNumber: lotNumber,
          },
        });

        const previousQty = existingInventory?.quantity ?? 0;

        if (existingInventory) {
          await prisma.inventory.update({
            where: { id: existingInventory.id },
            data: { quantity: existingInventory.quantity + move.quantity },
          });
        } else {
          await prisma.inventory.create({
            data: {
              partId: existing.partId,
              warehouseId: targetWarehouse.id,
              quantity: move.quantity,
              reservedQty: 0,
              lotNumber: lotNumber,
              locationCode: move.locationCode,
            },
          });
        }

        // Audit trail: inventory move
        await prisma.lotTransaction.create({
          data: {
            lotNumber: lotNumber,
            transactionType: "INSPECTED",
            partId: existing.partId,
            quantity: move.quantity,
            previousQty: previousQty,
            newQty: previousQty + move.quantity,
            inspectionId: existing.id,
            fromWarehouseId: receivingInventory?.warehouseId ?? null,
            toWarehouseId: targetWarehouse.id,
            fromLocation: "RECEIVING",
            toLocation: move.locationCode,
            userId: session.user?.id || "system",
            notes: `Inspection ${existing.inspectionNumber} [${data.result}]: ${move.quantity} → ${targetWarehouse.code}/${move.locationCode}`,
          },
        });
      }

      // Subtract from RECEIVING inventory in source warehouse
      const totalMoved = moves.reduce(
        (sum, m) => sum + (m.quantity > 0 ? m.quantity : 0),
        0,
      );
      if (totalMoved > 0 && receivingInventory) {
        const prevRecvQty = receivingInventory.quantity;
        const newQty = prevRecvQty - totalMoved;
        if (newQty <= 0) {
          await prisma.inventory.delete({
            where: { id: receivingInventory.id },
          });
        } else {
          await prisma.inventory.update({
            where: { id: receivingInventory.id },
            data: { quantity: newQty },
          });
        }

        // Audit trail: RECEIVING subtraction
        await prisma.lotTransaction.create({
          data: {
            lotNumber: lotNumber,
            transactionType: "INSPECTED",
            partId: existing.partId,
            quantity: -totalMoved,
            previousQty: prevRecvQty,
            newQty: Math.max(0, newQty),
            inspectionId: existing.id,
            fromWarehouseId: receivingInventory.warehouseId,
            fromLocation: "RECEIVING",
            userId: session.user?.id || "system",
            notes: `Inspection ${existing.inspectionNumber}: -${totalMoved} from RECEIVING (${receivingInventory.warehouse.code})`,
          },
        });
      }

      // For FAIL or CONDITIONAL with rejections, create NCR
      if (
        (data.result === "FAIL" || data.result === "CONDITIONAL") &&
        rejectedQty > 0
      ) {
        const existingNCR = await prisma.nCR.findFirst({
          where: { inspectionId: existing.id },
        });

        if (!existingNCR) {
          const ncrCount = await prisma.nCR.count();
          const ncrNumber = `NCR-${new Date().getFullYear()}-${String(ncrCount + 1).padStart(4, "0")}`;

          await prisma.nCR.create({
            data: {
              ncrNumber,
              status: "open",
              priority: "medium",
              source: "receiving",
              inspectionId: existing.id,
              partId: existing.partId,
              lotNumber: lotNumber,
              quantityAffected: rejectedQty,
              title: `Receiving inspection ${data.result === "FAIL" ? "failed" : "conditional"} - ${existing.inspectionNumber}`,
              description: `Receiving inspection ${existing.inspectionNumber} - ${rejectedQty} rejected items. Lot: ${lotNumber}`,
              createdBy: session.user?.id || "system",
            },
          });
        }
      }
    }

    return NextResponse.json(inspection);
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "PUT /api/quality/inspections/[id]",
    });
    return NextResponse.json(
      { error: "Failed to update inspection" },
      { status: 500 },
    );
  }
});
