// src/app/api/leave/policies/route.ts
// Leave Policies API

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { leavePolicyService } from "@/services/leave-policy.service";
import {
  withErrorHandler,
  Errors,
  successResponse,
  paginatedResponse,
} from "@/lib/errors";
import { checkPermission } from "@/lib/security/rbac";
import type { LeaveType } from ".prisma/hrm-unified-client";
import { safeParseInt } from "@/lib/api/parse-params";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await auth();
  if (!session?.user?.tenantId) {
    throw Errors.unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const leaveType = searchParams.get("leaveType") as LeaveType | null;
  const isActive = searchParams.get("isActive");
  const page = safeParseInt(searchParams.get("page"), 1);
  const pageSize = safeParseInt(searchParams.get("pageSize"), 50);

  const result = await leavePolicyService.getAll(session.user.tenantId, {
    leaveType: leaveType || undefined,
    isActive: isActive === null ? true : isActive === "true",
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

  // Check permissions using RBAC
  checkPermission(session.user.role, "leave", "create");

  const body = await request.json();
  const policy = await leavePolicyService.create(session.user.tenantId, body);

  return successResponse(policy, undefined, 201);
});
