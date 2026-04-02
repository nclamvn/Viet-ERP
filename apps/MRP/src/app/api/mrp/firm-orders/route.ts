import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { logger } from "@/lib/logger";

const firmOrderPostSchema = z.object({
  partId: z.string().min(1, "partId là bắt buộc"),
  siteId: z.string().optional(),
  quantity: z.number().positive("Số lượng phải lớn hơn 0"),
  dueDate: z.string().min(1, "Ngày đến hạn là bắt buộc"),
  orderType: z.string().optional().default("PURCHASE"),
  isFirm: z.boolean().optional().default(false),
});

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
import { withAuth } from "@/lib/api/with-auth";
// GET /api/mrp/firm-orders - Get planned orders (firm and non-firm)
export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const firmOnly = searchParams.get("firmOnly") === "true";
    const partId = searchParams.get("partId") || undefined;
    const siteId = searchParams.get("siteId") || undefined;
    const status = searchParams.get("status") || undefined;

    const where: Record<string, unknown> = {};
    if (firmOnly) where.isFirm = true;
    if (partId) where.partId = partId;
    if (siteId) where.siteId = siteId;
    if (status) where.status = status;

    const orders = await prisma.plannedOrder.findMany({
      where,
      include: {
        part: true,
      },
      orderBy: [{ isFirm: "desc" }, { dueDate: "asc" }],
      take: 200,
    });

    return NextResponse.json(orders);
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/mrp/firm-orders",
    });
    return NextResponse.json(
      { error: "Failed to get planned orders" },
      { status: 500 },
    );
  }
});

// POST /api/mrp/firm-orders - Create a planned order
export const POST = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await request.json();
    const parsed = firmOrderPostSchema.safeParse(body);
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
    const { partId, siteId, quantity, dueDate, orderType, isFirm } =
      parsed.data;

    // Generate order number
    const count = await prisma.plannedOrder.count();
    const orderNumber = `PO-${String(count + 1).padStart(6, "0")}`;

    // Calculate start date based on lead time (default 7 days before due date)
    const dueDateObj = new Date(dueDate);
    const startDateObj = new Date(dueDateObj);
    startDateObj.setDate(startDateObj.getDate() - 7);

    const order = await prisma.plannedOrder.create({
      data: {
        orderNumber,
        partId,
        siteId,
        quantity: new Decimal(quantity),
        startDate: startDateObj,
        dueDate: dueDateObj,
        orderType: orderType || "PURCHASE",
        isFirm: isFirm || false,
        firmedAt: isFirm ? new Date() : null,
      },
      include: {
        part: true,
      },
    });

    return NextResponse.json({
      success: true,
      order,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "POST /api/mrp/firm-orders",
    });
    return NextResponse.json(
      { error: "Failed to create planned order" },
      { status: 500 },
    );
  }
});

// PUT /api/mrp/firm-orders - Update (firm/unfirm) a planned order
export const PUT = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await request.json();
    const { orderId, isFirm, quantity, dueDate, status } = body;

    if (!orderId) {
      return NextResponse.json(
        { error: "orderId is required" },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (typeof isFirm === "boolean") {
      updateData.isFirm = isFirm;
      updateData.firmedAt = isFirm ? new Date() : null;
    }
    if (quantity !== undefined) updateData.quantity = new Decimal(quantity);
    if (dueDate) updateData.dueDate = new Date(dueDate);
    if (status) updateData.status = status;

    const order = await prisma.plannedOrder.update({
      where: { id: orderId },
      data: updateData,
      include: {
        part: true,
      },
    });

    return NextResponse.json({
      success: true,
      order,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "PUT /api/mrp/firm-orders",
    });
    return NextResponse.json(
      { error: "Failed to update planned order" },
      { status: 500 },
    );
  }
});

// DELETE /api/mrp/firm-orders - Delete a planned order
export const DELETE = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const orderId = searchParams.get("id");

    if (!orderId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await prisma.plannedOrder.delete({
      where: { id: orderId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "DELETE /api/mrp/firm-orders",
    });
    return NextResponse.json(
      { error: "Failed to delete planned order" },
      { status: 500 },
    );
  }
});
