import { NextRequest } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  withPermission,
  successResponse,
  errorResponse,
  notFoundResponse,
  validationErrorResponse,
  AuthUser,
} from "@/lib/api/with-permission";
import { generateInspectionNumber } from "@/lib/quality/inspection-engine";
import {
  auditUpdate,
  auditStatusChange,
  auditDelete,
} from "@/lib/audit/route-audit";
import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";

// =============================================================================
// VALIDATION
// =============================================================================

// Schema for PO line item
const POLineSchema = z.object({
  partId: z.string().min(1, "Part ID là bắt buộc"),
  quantity: z
    .number()
    .int()
    .min(1, "Số lượng phải >= 1")
    .max(999999, "Số lượng quá lớn"),
  unitPrice: z
    .number()
    .min(0, "Đơn giá phải >= 0")
    .max(999999999, "Đơn giá quá lớn"),
});

const updatePOSchema = z.object({
  poNumber: z.string().min(1).optional(),
  supplierId: z.string().optional(),
  orderDate: z.string().or(z.date()).optional(),
  expectedDate: z.string().or(z.date()).optional(),
  status: z
    .enum([
      "draft",
      "pending",
      "pending_approval",
      "approved",
      "rejected",
      "confirmed",
      "in_progress",
      "received",
      "cancelled",
    ])
    .optional(),
  currency: z.string().optional(), // Added: allow currency update
  notes: z.string().optional().nullable(),
  lines: z.array(POLineSchema).optional(),
});

// =============================================================================
// GET - Get single PO
// =============================================================================

async function getHandler(
  request: NextRequest,
  { params, user }: { params?: Record<string, string>; user: AuthUser },
) {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const id = params?.id;
  if (!id) return errorResponse("ID không hợp lệ", 400);

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: {
        include: { part: true },
        orderBy: { lineNumber: "asc" },
      },
    },
  });

  if (!order) return notFoundResponse("Đơn mua hàng");
  return successResponse(order);
}

// =============================================================================
// PUT - Update PO
// =============================================================================

async function putHandler(
  request: NextRequest,
  { params, user }: { params?: Record<string, string>; user: AuthUser },
) {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const id = params?.id;
  if (!id) return errorResponse("ID không hợp lệ", 400);

  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!existing) return notFoundResponse("Đơn mua hàng");

  // Allow status change to "received" from "confirmed"/"in_progress"
  // But block general edits on already received/cancelled POs
  if (
    ![
      "draft",
      "pending",
      "pending_approval",
      "rejected",
      "confirmed",
      "in_progress",
    ].includes(existing.status)
  ) {
    return errorResponse("Không thể chỉnh sửa PO ở trạng thái này", 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const validation = updatePOSchema.safeParse(body);
  if (!validation.success) {
    const errors: Record<string, string[]> = {};
    validation.error.issues.forEach((err) => {
      const path = err.path.join(".");
      if (!errors[path]) errors[path] = [];
      errors[path].push(err.message);
    });
    return validationErrorResponse(errors);
  }

  // Block direct status manipulation to approval workflow states via PUT
  // These must go through /submit, /approve, /reject, /cancel routes
  if (
    validation.data.status &&
    ["pending_approval", "approved", "rejected"].includes(
      validation.data.status,
    )
  ) {
    return errorResponse(
      "Sử dụng API workflow (/submit, /approve, /reject) để thay đổi trạng thái duyệt.",
      400,
    );
  }

  const { lines, ...headerData } = validation.data;

  // Optimistic locking: check if record was modified since client last read it
  if (body.expectedUpdatedAt) {
    const expectedDate = new Date(body.expectedUpdatedAt);
    if (existing.updatedAt.getTime() !== expectedDate.getTime()) {
      return errorResponse(
        "Dữ liệu đã bị thay đổi bởi người dùng khác. Vui lòng tải lại và thử lại.",
        409,
      );
    }
  }

  // Build header update data
  const updateData: Prisma.PurchaseOrderUpdateInput = { ...headerData };
  if (headerData.orderDate)
    updateData.orderDate = new Date(headerData.orderDate);
  if (headerData.expectedDate)
    updateData.expectedDate = new Date(headerData.expectedDate);

  // Validate parts exist if lines provided
  if (lines && lines.length > 0) {
    const partIds = lines.map((line) => line.partId);
    const parts = await prisma.part.findMany({
      where: { id: { in: partIds } },
      select: { id: true },
    });
    const foundPartIds = new Set(parts.map((p) => p.id));
    const missingParts = partIds.filter((pid) => !foundPartIds.has(pid));
    if (missingParts.length > 0) {
      return errorResponse(
        `Parts không tồn tại: ${missingParts.join(", ")}`,
        400,
      );
    }

    // Calculate new total amount
    const totalAmount = lines.reduce(
      (sum, line) => sum + line.quantity * line.unitPrice,
      0,
    );
    updateData.totalAmount = totalAmount;
  }

  // === Pre-compute receiving data before transaction (if PO is being received) ===
  const isBeingReceived =
    validation.data.status === "received" && existing.status !== "received";

  let receivingWarehouse: Awaited<
    ReturnType<typeof prisma.warehouse.findFirst>
  > = null;
  const inspectionNumbers: Record<string, string> = {};

  if (isBeingReceived) {
    // Find RECEIVING warehouse (pre-transaction reads)
    receivingWarehouse = await prisma.warehouse.findFirst({
      where: { type: "RECEIVING" },
    });
    if (!receivingWarehouse) {
      receivingWarehouse = await prisma.warehouse.findFirst({
        where: { status: "active" },
        orderBy: { createdAt: "asc" },
      });
    }
    if (!receivingWarehouse) {
      receivingWarehouse = await prisma.warehouse.create({
        data: {
          code: "WH-RECEIVING",
          name: "Receiving Area",
          type: "RECEIVING",
          status: "active",
        },
      });
    }

    // Pre-generate inspection numbers (may have side effects)
    const poLines = existing.lines;
    for (const line of poLines) {
      const existingInspection = await prisma.inspection.findFirst({
        where: { poLineId: line.id, type: "RECEIVING" },
      });
      if (!existingInspection) {
        inspectionNumbers[line.id] =
          await generateInspectionNumber("RECEIVING");
      }
    }
  }

  // Single atomic transaction: PO update + inventory + inspections
  const order = await prisma.$transaction(async (tx) => {
    // Delete existing lines if new lines provided
    if (lines && lines.length > 0) {
      await tx.purchaseOrderLine.deleteMany({
        where: { poId: id },
      });
    }

    // Update header and create new lines
    const updatedOrder = await tx.purchaseOrder.update({
      where: { id },
      data: {
        ...updateData,
        ...(lines &&
          lines.length > 0 && {
            lines: {
              create: lines.map((line, index) => ({
                lineNumber: index + 1,
                partId: line.partId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                lineTotal: line.quantity * line.unitPrice,
              })),
            },
          }),
      },
      include: {
        supplier: true,
        lines: {
          include: { part: true },
          orderBy: { lineNumber: "asc" },
        },
      },
    });

    // If PO is being received, update inventory + create inspections in the SAME transaction
    if (isBeingReceived && receivingWarehouse) {
      // IMPORTANT: Always use updatedOrder.lines (the current lines after any replacement).
      // Pre-computed inspectionNumbers keyed by old line IDs won't match new lines,
      // so we generate inspection numbers on-the-fly for any line missing one.
      const poLines = updatedOrder.lines || existing.lines;

      for (const line of poLines) {
        // Update receivedQty and line status
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: {
            receivedQty: line.quantity,
            status: "received",
          },
        });

        const existingInventory = await tx.inventory.findFirst({
          where: {
            partId: line.partId,
            warehouseId: receivingWarehouse.id,
            locationCode: "RECEIVING",
          },
        });

        if (existingInventory) {
          await tx.inventory.update({
            where: { id: existingInventory.id },
            data: {
              quantity: existingInventory.quantity + line.quantity,
              updatedAt: new Date(),
            },
          });
        } else {
          await tx.inventory.create({
            data: {
              partId: line.partId,
              warehouseId: receivingWarehouse.id,
              quantity: line.quantity,
              reservedQty: 0,
              locationCode: "RECEIVING",
            },
          });
        }

        // Create audit log
        await tx.lotTransaction.create({
          data: {
            lotNumber: `PO-RCV-${existing.poNumber}-${line.lineNumber || Date.now()}`,
            partId: line.partId,
            transactionType: "PO_RECEIVED",
            quantity: line.quantity,
            previousQty: existingInventory?.quantity ?? 0,
            newQty: (existingInventory?.quantity ?? 0) + line.quantity,
            userId: user.id || "system",
            notes: `Nhận hàng từ PO: ${existing.poNumber}`,
          },
        });

        // Auto-create receiving inspection
        // Use pre-computed number if available (old lines), otherwise generate new one
        const existingInspection = await tx.inspection.findFirst({
          where: { poLineId: line.id, type: "RECEIVING" },
        });
        if (!existingInspection) {
          const inspNumber =
            inspectionNumbers[line.id] ||
            (await generateInspectionNumber("RECEIVING"));
          await tx.inspection.create({
            data: {
              inspectionNumber: inspNumber,
              type: "RECEIVING",
              status: "pending",
              partId: line.partId,
              poLineId: line.id,
              quantityReceived: line.quantity,
              quantityInspected: 0,
              inspectedBy: user.id || "system",
              lotNumber: `LOT-${existing.poNumber}-${line.lineNumber || 1}`,
            },
          });
        }
      }
    }

    return updatedOrder;
  });

  // Audit trail (fire-and-forget, outside transaction)
  if (validation.data.status && validation.data.status !== existing.status) {
    auditStatusChange(
      request,
      { id: user.id, name: user.name, email: user.email },
      "PurchaseOrder",
      id!,
      existing.status,
      validation.data.status,
    );
  } else {
    auditUpdate(
      request,
      { id: user.id, name: user.name, email: user.email },
      "PurchaseOrder",
      id!,
      existing as unknown as Record<string, unknown>,
      headerData as Record<string, unknown>,
    );
  }

  return successResponse(order);
}

// =============================================================================
// DELETE - Cancel/Delete PO
// =============================================================================

async function deleteHandler(
  request: NextRequest,
  { params, user }: { params?: Record<string, string>; user: AuthUser },
) {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const id = params?.id;
  if (!id) return errorResponse("ID không hợp lệ", 400);

  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) return notFoundResponse("Đơn mua hàng");

  if (existing.status === "draft") {
    await prisma.purchaseOrder.delete({ where: { id } });
    auditDelete(
      request,
      { id: user.id, name: user.name, email: user.email },
      "PurchaseOrder",
      id!,
      { poNumber: existing.poNumber },
    );
    return successResponse({ deleted: true, id });
  }

  if (["received", "cancelled"].includes(existing.status)) {
    return errorResponse("Không thể hủy PO đã nhận hàng hoặc đã hủy", 400);
  }

  await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "cancelled" },
  });

  auditStatusChange(
    request,
    { id: user.id, name: user.name, email: user.email },
    "PurchaseOrder",
    id!,
    existing.status,
    "cancelled",
  );

  return successResponse({ cancelled: true, id });
}

// =============================================================================
// EXPORTS
// =============================================================================

export const GET = withPermission(getHandler, { read: "purchasing:view" });
export const PUT = withPermission(putHandler, { update: "orders:edit" });
export const DELETE = withPermission(deleteHandler, {
  delete: "orders:delete",
});
