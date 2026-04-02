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
import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";

// =============================================================================
// VALIDATION
// =============================================================================

const updateOrderSchema = z.object({
  orderNumber: z.string().min(1).optional(),
  customerId: z.string().optional(),
  orderDate: z.string().or(z.date()).optional(),
  requiredDate: z.string().or(z.date()).optional(),
  promisedDate: z.string().or(z.date()).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  status: z
    .enum([
      "draft",
      "pending",
      "confirmed",
      "in_progress",
      "completed",
      "cancelled",
    ])
    .optional(),
  currency: z.string().optional(), // Added: allow currency update
  notes: z.string().optional().nullable(),
});

// =============================================================================
// GET - Get single order
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

  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      lines: {
        include: { product: true },
        orderBy: { lineNumber: "asc" },
      },
    },
  });

  if (!order) return notFoundResponse("Đơn hàng");
  return successResponse(order);
}

// =============================================================================
// PUT - Update order
// =============================================================================

async function putHandler(
  request: NextRequest,
  { params, user }: { params?: Record<string, string>; user: AuthUser },
) {
  // Rate limiting
  const rlResult = await checkWriteEndpointLimit(request);
  if (rlResult) return rlResult;

  const id = params?.id;
  if (!id) return errorResponse("ID không hợp lệ", 400);

  const existing = await prisma.salesOrder.findUnique({ where: { id } });
  if (!existing) return notFoundResponse("Đơn hàng");

  // Only allow edit for draft/pending orders
  if (!["draft", "pending", "confirmed"].includes(existing.status)) {
    return errorResponse("Không thể chỉnh sửa đơn hàng ở trạng thái này", 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const validation = updateOrderSchema.safeParse(body);
  if (!validation.success) {
    const errors: Record<string, string[]> = {};
    validation.error.issues.forEach((err) => {
      const path = err.path.join(".");
      if (!errors[path]) errors[path] = [];
      errors[path].push(err.message);
    });
    return validationErrorResponse(errors);
  }

  const updateData: Prisma.SalesOrderUpdateInput = { ...validation.data };
  if (validation.data.orderDate)
    updateData.orderDate = new Date(validation.data.orderDate);
  if (validation.data.requiredDate)
    updateData.requiredDate = new Date(validation.data.requiredDate);
  if (validation.data.promisedDate)
    updateData.promisedDate = new Date(validation.data.promisedDate);

  const order = await prisma.salesOrder.update({
    where: { id },
    data: updateData,
    include: { customer: true, lines: { include: { product: true } } },
  });

  return successResponse(order);
}

// =============================================================================
// DELETE - Cancel/Delete order
// =============================================================================

async function deleteHandler(
  request: NextRequest,
  { params, user }: { params?: Record<string, string>; user: AuthUser },
) {
  // Rate limiting
  const rlResult2 = await checkWriteEndpointLimit(request);
  if (rlResult2) return rlResult2;

  const id = params?.id;
  if (!id) return errorResponse("ID không hợp lệ", 400);

  const existing = await prisma.salesOrder.findUnique({ where: { id } });
  if (!existing) return notFoundResponse("Đơn hàng");

  // Only allow delete for draft orders, otherwise cancel
  if (existing.status === "draft") {
    await prisma.salesOrder.delete({ where: { id } });
    return successResponse({ deleted: true, id });
  }

  // For other statuses, cancel instead of delete
  if (["completed", "cancelled"].includes(existing.status)) {
    return errorResponse(
      "Không thể hủy đơn hàng đã hoàn thành hoặc đã hủy",
      400,
    );
  }

  await prisma.salesOrder.update({
    where: { id },
    data: { status: "cancelled" },
  });

  return successResponse({ cancelled: true, id });
}

// =============================================================================
// EXPORTS
// =============================================================================

export const GET = withPermission(getHandler, { read: "orders:view" });
export const PUT = withPermission(putHandler, { update: "orders:edit" });
export const DELETE = withPermission(deleteHandler, {
  delete: "orders:delete",
});
