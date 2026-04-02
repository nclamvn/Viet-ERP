// =============================================================================
// PRICING RULES API
// GET  /api/pricing-rules — List rules
// POST /api/pricing-rules — Create rule
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
import { createPricingRuleSchema } from "@/lib/validations/pricing-rule";
import { auditCreate } from "@/lib/audit/route-audit";
import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";

// =============================================================================
// GET
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
    const type = searchParams.get("type");
    const customerId = searchParams.get("customerId");
    const partId = searchParams.get("partId");
    const isActive = searchParams.get("isActive");

    const where: Prisma.PricingRuleWhereInput = {};
    if (type) where.type = type;
    if (customerId) where.customerId = customerId;
    if (partId) where.partId = partId;
    if (isActive !== null && isActive !== undefined && isActive !== "") {
      where.isActive = isActive === "true";
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [totalCount, rules] = await Promise.all([
      prisma.pricingRule.count({ where }),
      prisma.pricingRule.findMany({
        where,
        ...buildOffsetPaginationQuery(paginationParams),
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        include: {
          customer: { select: { id: true, code: true, name: true } },
          part: { select: { id: true, partNumber: true, name: true } },
        },
      }),
    ]);

    return paginatedSuccess(
      buildPaginatedResponse(rules, totalCount, paginationParams, startTime),
    );
  } catch (error) {
    console.error("[PRICING_RULES_LIST]", error);
    return paginatedError("Không thể lấy danh sách quy tắc giá", 500);
  }
}

// =============================================================================
// POST
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

  const validation = createPricingRuleSchema.safeParse(body);
  if (!validation.success) {
    const errors: Record<string, string[]> = {};
    validation.error.issues.forEach((err) => {
      const path = err.path.join(".") || "_root";
      if (!errors[path]) errors[path] = [];
      errors[path].push(err.message);
    });
    return validationErrorResponse(errors);
  }

  const data = validation.data;

  // Validate customer if provided
  if (data.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
    });
    if (!customer) return errorResponse("Khách hàng không tồn tại", 404);
  }

  // Validate part if provided
  if (data.partId) {
    const part = await prisma.part.findUnique({ where: { id: data.partId } });
    if (!part) return errorResponse("Linh kiện không tồn tại", 404);
  }

  const rule = await prisma.pricingRule.create({
    data: {
      name: data.name,
      description: data.description,
      type: data.type,
      customerId: data.customerId || null,
      partId: data.partId || null,
      category: data.category || null,
      minQuantity: data.minQuantity || null,
      maxQuantity: data.maxQuantity || null,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validTo: data.validTo ? new Date(data.validTo) : null,
      discountType: data.discountType,
      discountValue: data.discountValue,
      priority: data.priority,
      isActive: data.isActive,
      createdById: user.id,
    },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      part: { select: { id: true, partNumber: true, name: true } },
    },
  });

  auditCreate(
    request,
    { id: user.id, name: user.name, email: user.email },
    "PricingRule",
    rule.id,
    {
      name: data.name,
      type: data.type,
      discountType: data.discountType,
      discountValue: data.discountValue,
    },
  );

  return successResponse(rule, 201);
}

// =============================================================================
// EXPORTS
// =============================================================================

export const GET = withPermission(getHandler, { read: "orders:view" });
export const POST = withPermission(postHandler, { create: "orders:create" });
