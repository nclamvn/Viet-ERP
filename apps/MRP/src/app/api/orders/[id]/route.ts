import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api/with-auth";
import { logger } from "@/lib/logger";
import { z } from "zod";
import {
  auditUpdate,
  auditStatusChange,
  auditDelete,
} from "@/lib/audit/route-audit";

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
// Validation schema for order item
const OrderItemSchema = z.object({
  productId: z.string().min(1, "Product ID là bắt buộc"),
  quantity: z.number().int().min(1, "Số lượng phải >= 1"),
  unitPrice: z.number().min(0, "Đơn giá phải >= 0"),
});

// Validation schema for updating an order
const OrderUpdateSchema = z.object({
  customerId: z.string().optional(),
  requiredDate: z.string().optional(),
  items: z.array(OrderItemSchema).optional(),
  notes: z.string().max(2000).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  status: z
    .enum([
      "draft",
      "pending",
      "confirmed",
      "in_production",
      "partially_shipped",
      "shipped",
      "delivered",
      "cancelled",
    ])
    .optional(),
});

export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id } = await context.params;

    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        lines: {
          include: {
            product: true,
          },
          orderBy: { lineNumber: "asc" },
        },
        shipments: {
          include: {
            lines: {
              include: { product: true },
              orderBy: { lineNumber: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/orders/[id]",
    });
    return NextResponse.json(
      { error: "Failed to fetch order details" },
      { status: 500 },
    );
  }
});

// PUT - Update sales order
export const PUT = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id } = await context.params;

    // Check if order exists
    const existing = await prisma.salesOrder.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Đơn hàng không tồn tại" },
        { status: 404 },
      );
    }

    // Check if order can be edited
    if (!["draft", "pending", "confirmed"].includes(existing.status)) {
      return NextResponse.json(
        { error: "Không thể chỉnh sửa đơn hàng ở trạng thái này" },
        { status: 400 },
      );
    }

    const body = await request.json();

    // Validate request body
    const validationResult = OrderUpdateSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.issues },
        { status: 400 },
      );
    }

    const { items, ...headerData } = validationResult.data;

    // Check if customer exists (if changing customer)
    if (headerData.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: headerData.customerId },
      });
      if (!customer) {
        return NextResponse.json(
          { error: "Khách hàng không tồn tại" },
          { status: 400 },
        );
      }
    }

    // Build update data
    const updateData: Prisma.SalesOrderUpdateInput = { ...headerData };
    if (headerData.requiredDate) {
      updateData.requiredDate = new Date(headerData.requiredDate);
    }

    // Validate products and calculate total if items provided
    if (items && items.length > 0) {
      const productIds = items.map((item) => item.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      const foundProductIds = new Set(products.map((p) => p.id));
      const missingProducts = productIds.filter(
        (pid) => !foundProductIds.has(pid),
      );
      if (missingProducts.length > 0) {
        return NextResponse.json(
          { error: `Sản phẩm không tồn tại: ${missingProducts.join(", ")}` },
          { status: 400 },
        );
      }

      // Calculate new total
      const totalAmount = items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0,
      );
      updateData.totalAmount = totalAmount;
    }

    // Use transaction to update header and lines together
    const order = await prisma.$transaction(async (tx) => {
      // Delete existing lines if new items provided
      if (items && items.length > 0) {
        await tx.salesOrderLine.deleteMany({
          where: { orderId: id },
        });
      }

      // Update header and create new lines
      return tx.salesOrder.update({
        where: { id },
        data: {
          ...updateData,
          ...(items &&
            items.length > 0 && {
              lines: {
                create: items.map((item, index) => ({
                  lineNumber: index + 1,
                  productId: item.productId,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  lineTotal: item.quantity * item.unitPrice,
                })),
              },
            }),
        },
        include: {
          customer: {
            select: { id: true, name: true, code: true },
          },
          lines: {
            include: {
              product: {
                select: { id: true, name: true, sku: true },
              },
            },
            orderBy: { lineNumber: "asc" },
          },
        },
      });
    });

    // Audit trail: log changes
    if (
      validationResult.data.status &&
      validationResult.data.status !== existing.status
    ) {
      auditStatusChange(
        request,
        session.user,
        "SalesOrder",
        id,
        existing.status,
        validationResult.data.status,
      );
    } else {
      auditUpdate(
        request,
        session.user,
        "SalesOrder",
        id,
        existing as unknown as Record<string, unknown>,
        headerData as Record<string, unknown>,
      );
    }

    return NextResponse.json(order);
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "PUT /api/orders/[id]",
    });
    return NextResponse.json(
      { error: "Failed to update order" },
      { status: 500 },
    );
  }
});

// DELETE - Cancel/Delete sales order
export const DELETE = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id } = await context.params;

    const existing = await prisma.salesOrder.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Đơn hàng không tồn tại" },
        { status: 404 },
      );
    }

    // If draft, delete completely
    if (existing.status === "draft") {
      await prisma.salesOrder.delete({ where: { id } });
      auditDelete(request, session.user, "SalesOrder", id, {
        orderNumber: existing.orderNumber,
      });
      return NextResponse.json({ deleted: true, id });
    }

    // Cannot cancel already shipped/delivered/cancelled orders
    if (
      ["partially_shipped", "shipped", "delivered", "cancelled"].includes(
        existing.status,
      )
    ) {
      return NextResponse.json(
        { error: "Không thể hủy đơn hàng đã giao hoặc đã hủy" },
        { status: 400 },
      );
    }

    // Cancel instead of delete
    await prisma.salesOrder.update({
      where: { id },
      data: { status: "cancelled" },
    });

    auditStatusChange(
      request,
      session.user,
      "SalesOrder",
      id,
      existing.status,
      "cancelled",
    );

    return NextResponse.json({ cancelled: true, id });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "DELETE /api/orders/[id]",
    });
    return NextResponse.json(
      { error: "Failed to delete order" },
      { status: 500 },
    );
  }
});
