// =============================================================================
// GRN (Goods Receipt Note) API
// GET  /api/purchase-orders/grn — List GRNs
// POST /api/purchase-orders/grn — Create GRN
// =============================================================================

import { NextRequest } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import {
  withPermission,
  successResponse,
  errorResponse,
  validationErrorResponse,
  AuthUser,
} from "@/lib/api/with-permission";
import {
  parsePaginationParams,
  buildOffsetPaginationQuery,
  buildPaginatedResponse,
  paginatedSuccess,
  paginatedError,
} from "@/lib/pagination";
import { generateGRNNumber } from "@/lib/purchasing/grn-number";
import { createGRNSchema } from "@/lib/validations/grn";
import { auditCreate, auditStatusChange } from "@/lib/audit/route-audit";
import { createMatchFromGRN } from "@/lib/purchasing/three-way-match";
import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";

// =============================================================================
// GET — List GRNs
// =============================================================================

async function getHandler(
  request: NextRequest,
  { params, user }: { params?: Record<string, string>; user: AuthUser },
) {
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const startTime = Date.now();

  try {
    const paginationParams = parsePaginationParams(request);
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const purchaseOrderId = searchParams.get("purchaseOrderId");
    const status = searchParams.get("status");

    const where: Prisma.GoodsReceiptNoteWhereInput = {};

    if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { grnNumber: { contains: search, mode: "insensitive" } },
        {
          purchaseOrder: {
            poNumber: { contains: search, mode: "insensitive" },
          },
        },
      ];
    }

    const [totalCount, grns] = await Promise.all([
      prisma.goodsReceiptNote.count({ where }),
      prisma.goodsReceiptNote.findMany({
        where,
        ...buildOffsetPaginationQuery(paginationParams),
        orderBy: paginationParams.sortBy
          ? { [paginationParams.sortBy]: paginationParams.sortOrder }
          : { receivedDate: "desc" },
        include: {
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              supplierId: true,
              supplier: { select: { id: true, name: true, code: true } },
            },
          },
          _count: { select: { items: true } },
        },
      }),
    ]);

    return paginatedSuccess(
      buildPaginatedResponse(grns, totalCount, paginationParams, startTime),
    );
  } catch (error) {
    console.error("[GRN_LIST]", error);
    return paginatedError("Không thể lấy danh sách phiếu nhận hàng", 500);
  }
}

// =============================================================================
// POST — Create GRN
// =============================================================================

async function postHandler(
  request: NextRequest,
  { params, user }: { params?: Record<string, string>; user: AuthUser },
) {
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const validation = createGRNSchema.safeParse(body);
  if (!validation.success) {
    const errors: Record<string, string[]> = {};
    validation.error.issues.forEach((err) => {
      const path = err.path.join(".");
      if (!errors[path]) errors[path] = [];
      errors[path].push(err.message);
    });
    return validationErrorResponse(errors);
  }

  const data = validation.data;

  // Validate PO exists and is in receivable status
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: data.purchaseOrderId },
    include: { lines: true },
  });

  if (!po) {
    return errorResponse("Đơn mua hàng không tồn tại", 404);
  }

  const receivableStatuses = [
    "approved",
    "confirmed",
    "in_progress",
    "partially_received",
  ];
  if (!receivableStatuses.includes(po.status)) {
    return errorResponse(
      `Không thể nhận hàng cho PO ở trạng thái "${po.status}". PO phải ở trạng thái: ${receivableStatuses.join(", ")}.`,
      400,
    );
  }

  // Validate all poLineIds exist and belong to this PO
  const poLineIds = new Set(po.lines.map((l) => l.id));
  for (const item of data.items) {
    if (!poLineIds.has(item.poLineId)) {
      return errorResponse(
        `Dòng PO "${item.poLineId}" không thuộc đơn mua hàng này.`,
        400,
      );
    }
  }

  // Validate partIds match the PO lines
  const poLineMap = new Map(po.lines.map((l) => [l.id, l]));
  for (const item of data.items) {
    const poLine = poLineMap.get(item.poLineId);
    if (poLine && poLine.partId !== item.partId) {
      return errorResponse(
        `Linh kiện "${item.partId}" không khớp với dòng PO "${item.poLineId}" (expected: ${poLine.partId}).`,
        400,
      );
    }
  }

  // Generate GRN number
  const grnNumber = await generateGRNNumber();

  // Find receiving warehouse
  let receivingWarehouse = await prisma.warehouse.findFirst({
    where: { type: "RECEIVING" },
  });
  if (!receivingWarehouse) {
    receivingWarehouse = await prisma.warehouse.findFirst({
      where: { status: "active" },
      orderBy: { createdAt: "asc" },
    });
  }

  // Create GRN + update PO lines + update inventory in single transaction
  const grn = await prisma.$transaction(async (tx) => {
    // Create GRN with items
    const newGRN = await tx.goodsReceiptNote.create({
      data: {
        grnNumber,
        purchaseOrderId: data.purchaseOrderId,
        receivedById: user.id,
        receivedDate: data.receivedDate
          ? new Date(data.receivedDate)
          : new Date(),
        notes: data.notes,
        items: {
          create: data.items.map((item) => ({
            poLineId: item.poLineId,
            partId: item.partId,
            quantityOrdered: item.quantityOrdered,
            quantityReceived: item.quantityReceived,
            quantityAccepted: item.quantityAccepted,
            quantityRejected: item.quantityRejected,
            rejectionReason: item.rejectionReason,
            lotNumber: item.lotNumber,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
          })),
        },
      },
      include: {
        purchaseOrder: { select: { id: true, poNumber: true } },
        items: {
          include: {
            part: { select: { id: true, partNumber: true, name: true } },
          },
        },
      },
    });

    // Update PO line receivedQty and inventory for each accepted item
    for (const item of data.items) {
      if (item.quantityAccepted > 0) {
        // Update PO line receivedQty
        await tx.purchaseOrderLine.update({
          where: { id: item.poLineId },
          data: {
            receivedQty: { increment: item.quantityAccepted },
          },
        });

        // Update inventory if warehouse exists
        if (receivingWarehouse) {
          const existingInventory = await tx.inventory.findFirst({
            where: {
              partId: item.partId,
              warehouseId: receivingWarehouse.id,
              locationCode: "RECEIVING",
            },
          });

          if (existingInventory) {
            await tx.inventory.update({
              where: { id: existingInventory.id },
              data: { quantity: { increment: item.quantityAccepted } },
            });
          } else {
            await tx.inventory.create({
              data: {
                partId: item.partId,
                warehouseId: receivingWarehouse.id,
                quantity: item.quantityAccepted,
                reservedQty: 0,
                locationCode: "RECEIVING",
                lotNumber: item.lotNumber || null,
                expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
              },
            });
          }

          // Lot transaction for audit
          await tx.lotTransaction.create({
            data: {
              lotNumber: item.lotNumber || `GRN-${grnNumber}-${item.poLineId}`,
              partId: item.partId,
              transactionType: "RECEIVED",
              quantity: item.quantityAccepted,
              previousQty: existingInventory?.quantity ?? 0,
              newQty:
                (existingInventory?.quantity ?? 0) + item.quantityAccepted,
              poId: data.purchaseOrderId,
              toWarehouseId: receivingWarehouse.id,
              toLocation: "RECEIVING",
              userId: user.id,
              notes: `Nhận hàng GRN: ${grnNumber}`,
            },
          });
        }
      }
    }

    // Check if all PO lines are fully received → update PO status
    const updatedPOLines = await tx.purchaseOrderLine.findMany({
      where: { poId: data.purchaseOrderId },
    });

    const allReceived = updatedPOLines.every(
      (line) => line.receivedQty >= line.quantity,
    );
    const someReceived = updatedPOLines.some((line) => line.receivedQty > 0);

    if (allReceived) {
      await tx.purchaseOrder.update({
        where: { id: data.purchaseOrderId },
        data: { status: "received" },
      });
    } else if (someReceived && po.status !== "partially_received") {
      await tx.purchaseOrder.update({
        where: { id: data.purchaseOrderId },
        data: { status: "partially_received" },
      });
    }

    // Auto-create 3-way match record
    await createMatchFromGRN(data.purchaseOrderId, newGRN.id, tx);

    return newGRN;
  });

  // Audit trail (fire-and-forget)
  auditCreate(
    request,
    { id: user.id, name: user.name, email: user.email },
    "GoodsReceiptNote",
    grn.id,
    {
      grnNumber,
      purchaseOrderId: data.purchaseOrderId,
      itemCount: data.items.length,
    },
  );

  // If PO status changed, audit that too
  const updatedPO = await prisma.purchaseOrder.findUnique({
    where: { id: data.purchaseOrderId },
    select: { status: true },
  });
  if (updatedPO && updatedPO.status !== po.status) {
    auditStatusChange(
      request,
      { id: user.id, name: user.name, email: user.email },
      "PurchaseOrder",
      data.purchaseOrderId,
      po.status,
      updatedPO.status,
    );
  }

  return successResponse(grn, 201);
}

// =============================================================================
// EXPORTS
// =============================================================================

export const GET = withPermission(getHandler, { read: "purchasing:view" });
export const POST = withPermission(postHandler, {
  create: "purchasing:create",
});
