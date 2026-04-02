// src/app/api/leave/requests/route.ts
// Leave Requests API

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { leaveRequestService } from "@/services/leave-request.service";
import { db } from "@/lib/db";
import {
  withErrorHandler,
  Errors,
  successResponse,
  paginatedResponse,
} from "@/lib/errors";
import type { RequestStatus } from ".prisma/hrm-ai-client";
import { safeParseInt } from "@/lib/api/parse-params";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await auth();
  if (!session?.user?.tenantId) {
    throw Errors.unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId");
  const policyId = searchParams.get("policyId");
  const status = searchParams.get("status") as RequestStatus | null;
  const page = safeParseInt(searchParams.get("page"), 1);
  const pageSize = safeParseInt(searchParams.get("pageSize"), 20);

  const result = await leaveRequestService.getAll(session.user.tenantId, {
    employeeId: employeeId || undefined,
    policyId: policyId || undefined,
    status: status || undefined,
    page,
    pageSize,
  });

  return paginatedResponse(result.data, {
    page,
    pageSize,
    total: result.pagination.total,
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await auth();
  if (!session?.user?.tenantId) {
    throw Errors.unauthorized();
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { employeeId: true },
  });

  if (!user?.employeeId) {
    throw Errors.businessRule("Bạn chưa có hồ sơ nhân viên");
  }

  const body = await request.json();

  // Parse dates
  const data = {
    ...body,
    startDate: new Date(body.startDate),
    endDate: new Date(body.endDate),
  };

  const leaveRequest = await leaveRequestService.create(
    session.user.tenantId,
    user.employeeId,
    data,
  );

  return successResponse(leaveRequest, undefined, 201);
});
