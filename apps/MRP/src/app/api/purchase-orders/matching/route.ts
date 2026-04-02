// =============================================================================
// 3-WAY MATCHING LIST API
// GET /api/purchase-orders/matching — List all match records
// =============================================================================

import { NextRequest } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { withPermission, AuthUser } from "@/lib/api/with-permission";
import {
  parsePaginationParams,
  buildOffsetPaginationQuery,
  buildPaginatedResponse,
  paginatedSuccess,
  paginatedError,
} from "@/lib/pagination";
import { checkReadEndpointLimit } from "@/lib/rate-limit";

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
    const status = searchParams.get("status");
    const purchaseOrderId = searchParams.get("purchaseOrderId");

    const where: Prisma.ThreeWayMatchWhereInput = {};
    if (status) where.status = status;
    if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;

    const [totalCount, matches] = await Promise.all([
      prisma.threeWayMatch.count({ where }),
      prisma.threeWayMatch.findMany({
        where,
        ...buildOffsetPaginationQuery(paginationParams),
        orderBy: paginationParams.sortBy
          ? { [paginationParams.sortBy]: paginationParams.sortOrder }
          : { createdAt: "desc" },
        include: {
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              supplier: { select: { id: true, name: true, code: true } },
            },
          },
          grn: { select: { id: true, grnNumber: true, receivedDate: true } },
        },
      }),
    ]);

    return paginatedSuccess(
      buildPaginatedResponse(matches, totalCount, paginationParams, startTime),
    );
  } catch (error) {
    console.error("[MATCHING_LIST]", error);
    return paginatedError("Không thể lấy danh sách đối chiếu", 500);
  }
}

export const GET = withPermission(getHandler, { read: "purchasing:view" });
