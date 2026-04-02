// =============================================================================
// QUOTATION API
// GET  /api/quotations — List quotations
// POST /api/quotations — Create quotation
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
import { generateQuoteNumber } from "@/lib/sales/quote-number";
import {
  calculateLineTotal,
  calculateQuotationTotals,
} from "@/lib/sales/quotation-calc";
import { createQuotationSchema } from "@/lib/validations/quotation";
import { auditCreate } from "@/lib/audit/route-audit";
import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";

// =============================================================================
// GET — List quotations
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
    const status = searchParams.get("status");
    const customerId = searchParams.get("customerId");

    const where: Prisma.QuotationWhereInput = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (search) {
      where.OR = [
        { quoteNumber: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [totalCount, quotations] = await Promise.all([
      prisma.quotation.count({ where }),
      prisma.quotation.findMany({
        where,
        ...buildOffsetPaginationQuery(paginationParams),
        orderBy: paginationParams.sortBy
          ? { [paginationParams.sortBy]: paginationParams.sortOrder }
          : { createdAt: "desc" },
        include: {
          customer: { select: { id: true, code: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);

    return paginatedSuccess(
      buildPaginatedResponse(
        quotations,
        totalCount,
        paginationParams,
        startTime,
      ),
    );
  } catch (error) {
    console.error("[QUOTATION_LIST]", error);
    return paginatedError("Không thể lấy danh sách báo giá", 500);
  }
}

// =============================================================================
// POST — Create quotation
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

  const validation = createQuotationSchema.safeParse(body);
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

  // Validate customer exists
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });
  if (!customer) return errorResponse("Khách hàng không tồn tại", 404);

  // Validate parts exist
  const partIds = data.items.map((item) => item.partId);
  const parts = await prisma.part.findMany({
    where: { id: { in: partIds } },
    select: { id: true },
  });
  const foundPartIds = new Set(parts.map((p) => p.id));
  const missingParts = partIds.filter((pid) => !foundPartIds.has(pid));
  if (missingParts.length > 0) {
    return errorResponse(
      `Linh kiện không tồn tại: ${missingParts.join(", ")}`,
      400,
    );
  }

  // Calculate totals
  const itemsWithTotals = data.items.map((item) => ({
    ...item,
    lineTotal: calculateLineTotal(item),
  }));
  const totals = calculateQuotationTotals(data.items, data.discountPercent);

  // Generate quote number
  const quoteNumber = await generateQuoteNumber();

  const quotation = await prisma.quotation.create({
    data: {
      quoteNumber,
      customerId: data.customerId,
      status: "draft",
      validUntil: new Date(data.validUntil),
      createdById: user.id,
      discountPercent: data.discountPercent || 0,
      currency: data.currency || "VND",
      ...totals,
      notes: data.notes,
      terms: data.terms,
      items: {
        create: itemsWithTotals.map((item) => ({
          partId: item.partId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountPercent: item.discountPercent || 0,
          taxRate: item.taxRate || 0,
          lineTotal: item.lineTotal,
        })),
      },
    },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      items: {
        include: {
          part: {
            select: { id: true, partNumber: true, name: true, unit: true },
          },
        },
      },
    },
  });

  auditCreate(
    request,
    { id: user.id, name: user.name, email: user.email },
    "Quotation",
    quotation.id,
    { quoteNumber, customerId: data.customerId, itemCount: data.items.length },
  );

  return successResponse(quotation, 201);
}

// =============================================================================
// EXPORTS
// =============================================================================

export const GET = withPermission(getHandler, { read: "orders:view" });
export const POST = withPermission(postHandler, { create: "orders:create" });
