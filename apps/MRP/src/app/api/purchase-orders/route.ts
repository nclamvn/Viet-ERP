import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api/with-auth";
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
import { triggerPurchaseOrderWorkflow } from "@/lib/workflow/workflow-triggers";

import { checkReadEndpointLimit } from "@/lib/rate-limit";
// =============================================================================
// VALIDATION
// =============================================================================

const createPOSchema = z.object({
  poNumber: z.string().optional(),
  supplierId: z.string().min(1, "Nhà cung cấp là bắt buộc"),
  orderDate: z.string().or(z.date()),
  expectedDate: z.string().or(z.date()),
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
    .default("draft"),
  currency: z.string().default("USD"),
  notes: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        partId: z.string(),
        quantity: z.number().int().min(1).max(999999),
        unitPrice: z.number().min(0).max(999999999),
      }),
    )
    .optional(),
});

// =============================================================================
// GET - List purchase orders
// =============================================================================

export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const startTime = Date.now();

  try {
    const params = parsePaginationParams(request);
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const status = searchParams.get("status");
    const supplierId = searchParams.get("supplierId");

    const where: Prisma.PurchaseOrderWhereInput = {};
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (search) {
      where.OR = [
        { poNumber: { contains: search, mode: "insensitive" } },
        { supplier: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [totalCount, orders] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        ...buildOffsetPaginationQuery(params),
        orderBy: params.sortBy
          ? { [params.sortBy]: params.sortOrder }
          : { orderDate: "desc" },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          lines: {
            include: {
              part: { select: { id: true, partNumber: true, name: true } },
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
      context: "GET /api/purchase-orders",
    });
    return paginatedError("Failed to fetch purchase orders", 500);
  }
});

// =============================================================================
// POST - Create purchase order
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

  const validation = createPOSchema.safeParse(body);
  if (!validation.success) {
    const errors: Record<string, string[]> = {};
    validation.error.issues.forEach((err) => {
      const path = err.path.join(".");
      if (!errors[path]) errors[path] = [];
      errors[path].push(err.message);
    });
    return validationErrorResponse(errors);
  }

  // Auto-generate PO number if not provided or empty
  let poNumber = validation.data.poNumber;
  if (!poNumber || poNumber.trim() === "") {
    const year = new Date().getFullYear();
    const prefix = `PO-${year}-`;
    const lastPO = await prisma.purchaseOrder.findFirst({
      where: { poNumber: { startsWith: prefix } },
      orderBy: { poNumber: "desc" },
    });
    const lastSeq = lastPO
      ? parseInt(lastPO.poNumber.replace(prefix, "")) || 0
      : 0;
    poNumber = `${prefix}${String(lastSeq + 1).padStart(3, "0")}`;
  }

  // Check unique PO number
  const exists = await prisma.purchaseOrder.findUnique({
    where: { poNumber },
  });
  if (exists) return errorResponse("Số PO đã tồn tại", 409);

  // Check supplier exists
  const supplier = await prisma.supplier.findUnique({
    where: { id: validation.data.supplierId },
  });
  if (!supplier) return errorResponse("Nhà cung cấp không tồn tại", 400);

  const { lines, poNumber: _ignored, ...orderData } = validation.data;

  // Calculate total
  let totalAmount = 0;
  if (lines && lines.length > 0) {
    totalAmount = lines.reduce(
      (sum, line) => sum + line.quantity * line.unitPrice,
      0,
    );
  }

  const order = await prisma.purchaseOrder.create({
    data: {
      ...orderData,
      poNumber,
      orderDate: new Date(orderData.orderDate),
      expectedDate: new Date(orderData.expectedDate),
      totalAmount,
      lines: lines
        ? {
            create: lines.map((line, index) => ({
              lineNumber: index + 1,
              partId: line.partId,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.quantity * line.unitPrice,
            })),
          }
        : undefined,
    },
    include: {
      supplier: true,
      lines: { include: { part: true } },
    },
  });

  // Trigger approval workflow (non-blocking — errors are logged, not thrown)
  try {
    await triggerPurchaseOrderWorkflow(order.id, user.id, {
      totalAmount,
      supplierId: validation.data.supplierId,
      supplierName: supplier.name,
      lineCount: lines?.length ?? 0,
    });
  } catch (err) {
    logger.logError(err instanceof Error ? err : new Error(String(err)), {
      context: "PO workflow trigger",
    });
  }

  return successResponse(order, 201);
}

export const POST = withPermission(postHandler, {
  create: "purchasing:create",
});
