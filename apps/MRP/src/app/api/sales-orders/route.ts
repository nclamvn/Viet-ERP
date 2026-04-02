import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { z } from "zod";
import {
  parsePaginationParams,
  buildOffsetPaginationQuery,
  buildPaginatedResponse,
  paginatedSuccess,
  paginatedError,
} from "@/lib/pagination";
import {
  withPermission,
  successResponse,
  errorResponse,
  validationErrorResponse,
  AuthUser,
} from "@/lib/api/with-permission";

import { checkReadEndpointLimit } from "@/lib/rate-limit";

/** Parse date string ensuring UTC for date-only strings (YYYY-MM-DD) */
function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  // Date-only strings: explicitly append UTC timezone to avoid local-time parsing
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(value + "T00:00:00.000Z");
  }
  return new Date(value);
}

// =============================================================================
// VALIDATION
// =============================================================================

const createOrderSchema = z.object({
  orderNumber: z.string().min(1, "Số đơn hàng là bắt buộc"),
  customerId: z.string().min(1, "Khách hàng là bắt buộc"),
  orderDate: z.string().or(z.date()),
  requiredDate: z.string().or(z.date()),
  promisedDate: z.string().or(z.date()).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  status: z
    .enum([
      "draft",
      "pending",
      "confirmed",
      "in_progress",
      "completed",
      "cancelled",
    ])
    .default("draft"),
  currency: z.string().default("USD"),
  notes: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().min(1).max(999999),
        unitPrice: z.number().min(0).max(999999999),
        discount: z.number().min(0).max(100).default(0),
      }),
    )
    .optional(),
});

// =============================================================================
// GET - List sales orders
// =============================================================================

async function getHandler(
  request: NextRequest,
  { user }: { params?: Record<string, string>; user: AuthUser },
) {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const startTime = Date.now();

  try {
    const params = parsePaginationParams(request);
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const status = searchParams.get("status");
    const customerId = searchParams.get("customerId");
    const priority = searchParams.get("priority");

    const where: Prisma.SalesOrderWhereInput = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (priority) where.priority = priority;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [totalCount, orders] = await Promise.all([
      prisma.salesOrder.count({ where }),
      prisma.salesOrder.findMany({
        where,
        ...buildOffsetPaginationQuery(params),
        orderBy: params.sortBy
          ? { [params.sortBy]: params.sortOrder }
          : { orderDate: "desc" },
        include: {
          customer: { select: { id: true, code: true, name: true } },
          lines: {
            include: {
              product: { select: { id: true, sku: true, name: true } },
            },
          },
          _count: { select: { lines: true } },
        },
      }),
    ]);

    return paginatedSuccess(
      buildPaginatedResponse(orders, totalCount, params, startTime),
    );
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/sales-orders",
    });
    return paginatedError("Failed to fetch sales orders", 500);
  }
}

export const GET = withPermission(getHandler, { read: "orders:view" });

// =============================================================================
// POST - Create sales order
// =============================================================================

async function postHandler(
  request: NextRequest,
  { user }: { params?: Record<string, string>; user: AuthUser },
) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const validation = createOrderSchema.safeParse(body);
  if (!validation.success) {
    const errors: Record<string, string[]> = {};
    validation.error.issues.forEach((err) => {
      const path = err.path.join(".");
      if (!errors[path]) errors[path] = [];
      errors[path].push(err.message);
    });
    return validationErrorResponse(errors);
  }

  // Check unique order number
  const exists = await prisma.salesOrder.findUnique({
    where: { orderNumber: validation.data.orderNumber },
  });
  if (exists) return errorResponse("Số đơn hàng đã tồn tại", 409);

  // Check customer exists
  const customer = await prisma.customer.findUnique({
    where: { id: validation.data.customerId },
  });
  if (!customer) return errorResponse("Khách hàng không tồn tại", 400);

  const { lines, ...orderData } = validation.data;

  // Calculate total
  let totalAmount = 0;
  if (lines && lines.length > 0) {
    totalAmount = lines.reduce((sum, line) => {
      const lineTotal =
        line.quantity * line.unitPrice * (1 - line.discount / 100);
      return sum + lineTotal;
    }, 0);
  }

  const order = await prisma.salesOrder.create({
    data: {
      ...orderData,
      orderDate: parseDate(orderData.orderDate),
      requiredDate: parseDate(orderData.requiredDate),
      promisedDate: orderData.promisedDate
        ? parseDate(orderData.promisedDate)
        : null,
      totalAmount,
      lines: lines
        ? {
            create: lines.map((line, index) => ({
              lineNumber: index + 1,
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discount: line.discount,
              lineTotal:
                line.quantity * line.unitPrice * (1 - line.discount / 100),
            })),
          }
        : undefined,
    },
    include: {
      customer: true,
      lines: { include: { product: true } },
    },
  });

  return successResponse(order, 201);
}

export const POST = withPermission(postHandler, { create: "orders:create" });
