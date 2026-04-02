import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";
import { logger } from "@/lib/logger";

const transferLineSchema = z.object({
  partId: z.string().min(1),
  quantity: z.number().positive(),
});

const transferPostSchema = z.object({
  fromSiteId: z.string().min(1, "fromSiteId là bắt buộc"),
  toSiteId: z.string().min(1, "toSiteId là bắt buộc"),
  requestDate: z.string().optional(),
  lines: z.array(transferLineSchema).min(1, "Cần ít nhất một dòng chuyển kho"),
  notes: z.string().optional(),
});

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
import { withAuth } from "@/lib/api/with-auth";
// GET /api/mrp/multi-site/transfers - Get transfer orders
export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const fromSiteId = searchParams.get("fromSiteId") || undefined;
    const toSiteId = searchParams.get("toSiteId") || undefined;
    const status = searchParams.get("status") || undefined;

    const where: Record<string, unknown> = {};
    if (fromSiteId) where.fromSiteId = fromSiteId;
    if (toSiteId) where.toSiteId = toSiteId;
    if (status) where.status = status;

    const transfers = await prisma.transferOrder.findMany({
      where,
      include: {
        fromSite: true,
        toSite: true,
        lines: {
          include: {
            part: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json(transfers);
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/mrp/multi-site/transfers",
    });
    return NextResponse.json(
      { error: "Failed to get transfer orders" },
      { status: 500 },
    );
  }
});

// POST /api/mrp/multi-site/transfers - Create a transfer order
export const POST = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await request.json();
    const parsed = transferPostSchema.safeParse(body);
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
    const { fromSiteId, toSiteId, requestDate, lines, notes } = parsed.data;

    // Generate transfer number
    const count = await prisma.transferOrder.count();
    const transferNumber = `TO-${String(count + 1).padStart(6, "0")}`;

    // Get lead time (simplified - could be site-specific)
    const leadTimeDays = 3;
    const expectedDate = new Date(requestDate || new Date());
    expectedDate.setDate(expectedDate.getDate() + leadTimeDays);

    const transfer = await prisma.transferOrder.create({
      data: {
        transferNumber,
        fromSiteId,
        toSiteId,
        status: "DRAFT",
        requestDate: new Date(requestDate || new Date()),
        expectedDate,
        notes,
        lines: {
          create: lines.map((line, index) => ({
            partId: line.partId,
            lineNumber: index + 1,
            quantity: new Decimal(line.quantity),
            shippedQty: new Decimal(0),
            receivedQty: new Decimal(0),
          })),
        },
      },
      include: {
        fromSite: true,
        toSite: true,
        lines: {
          include: {
            part: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      transfer,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "POST /api/mrp/multi-site/transfers",
    });
    return NextResponse.json(
      { error: "Failed to create transfer order" },
      { status: 500 },
    );
  }
});

// PUT /api/mrp/multi-site/transfers - Update transfer order status
export const PUT = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await request.json();
    const { transferId, action, lineUpdates } = body;

    if (!transferId || !action) {
      return NextResponse.json(
        { error: "transferId and action are required" },
        { status: 400 },
      );
    }

    const transfer = await prisma.transferOrder.findUnique({
      where: { id: transferId },
      include: { lines: true },
    });

    if (!transfer) {
      return NextResponse.json(
        { error: "Transfer order not found" },
        { status: 404 },
      );
    }

    let newStatus = transfer.status;
    const updateData: Record<string, unknown> = {};

    switch (action) {
      case "approve":
        newStatus = "APPROVED";
        break;
      case "ship":
        newStatus = "IN_TRANSIT";
        updateData.shippedDate = new Date();
        // Update line shipped quantities
        if (lineUpdates) {
          for (const update of lineUpdates) {
            await prisma.transferOrderLine.update({
              where: { id: update.lineId },
              data: { shippedQty: new Decimal(update.shippedQty) },
            });
          }
        }
        break;
      case "receive":
        newStatus = "RECEIVED";
        updateData.receivedDate = new Date();
        // Update line received quantities
        if (lineUpdates) {
          for (const update of lineUpdates) {
            await prisma.transferOrderLine.update({
              where: { id: update.lineId },
              data: { receivedQty: new Decimal(update.receivedQty) },
            });
          }
        }
        break;
      case "cancel":
        newStatus = "CANCELLED";
        break;
      default:
        return NextResponse.json(
          { error: "Invalid action. Use: approve, ship, receive, or cancel" },
          { status: 400 },
        );
    }

    updateData.status = newStatus;

    const updated = await prisma.transferOrder.update({
      where: { id: transferId },
      data: updateData,
      include: {
        fromSite: true,
        toSite: true,
        lines: {
          include: {
            part: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      transfer: updated,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "PUT /api/mrp/multi-site/transfers",
    });
    return NextResponse.json(
      { error: "Failed to update transfer order" },
      { status: 500 },
    );
  }
});
