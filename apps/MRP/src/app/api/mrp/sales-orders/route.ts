// =============================================================================
// MRP SALES ORDERS API ROUTES
// API endpoints for getting sales orders for MRP planning
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

import { checkReadEndpointLimit } from "@/lib/rate-limit";
import { withAuth } from "@/lib/api/with-auth";
// =============================================================================
// TYPES
// =============================================================================

interface MRPResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

// =============================================================================
// GET /api/mrp/sales-orders
// Get sales orders available for MRP planning
// =============================================================================

export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");

    // Build where clause dynamically
    const where: Prisma.SalesOrderWhereInput = {};

    // Filter by status - default to confirmed and in_production orders for MRP
    if (status) {
      where.status = { in: status.split(",") };
    } else {
      where.status = { in: ["confirmed", "in_production", "pending"] };
    }

    // Filter by date range
    if (fromDate || toDate) {
      where.requiredDate = {};
      if (fromDate) {
        where.requiredDate.gte = new Date(fromDate);
      }
      if (toDate) {
        where.requiredDate.lte = new Date(toDate);
      }
    }

    const orders = await prisma.salesOrder.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { requiredDate: "asc" },
      take: 1000,
    });

    // Transform to match expected format
    const formattedOrders = orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        code: order.customer.code,
      },
      orderDate: order.orderDate.toISOString().split("T")[0],
      requiredDate: order.requiredDate.toISOString().split("T")[0],
      promisedDate: order.promisedDate?.toISOString().split("T")[0],
      status: order.status.charAt(0).toUpperCase() + order.status.slice(1),
      priority: order.priority,
      totalValue:
        order.totalAmount ||
        order.lines.reduce((sum, line) => sum + (line.lineTotal || 0), 0),
      currency: order.currency,
      items: order.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        partNumber: line.product.sku,
        partName: line.product.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        status: line.status,
      })),
    }));

    return NextResponse.json({ success: true, data: formattedOrders });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/mrp/sales-orders",
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch sales orders" },
      { status: 500 },
    );
  }
});
