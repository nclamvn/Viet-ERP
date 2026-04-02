import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { employeeService } from "@/services/employee.service";
import { audit } from "@/lib/audit/logger";
import { createEmployeeSchema } from "@/lib/validations/employee";
import {
  withErrorHandler,
  Errors,
  successResponse,
  paginatedResponse,
} from "@/lib/errors";
import type { EmployeeStatus } from ".prisma/hrm-unified-client";
import { safeParseInt } from "@/lib/api/parse-params";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await auth();
  if (!session?.user) {
    throw Errors.unauthorized();
  }

  const searchParams = request.nextUrl.searchParams;
  const filters = {
    search: searchParams.get("search") || undefined,
    departmentId: searchParams.get("departmentId") || undefined,
    positionId: searchParams.get("positionId") || undefined,
    branchId: searchParams.get("branchId") || undefined,
    status: (searchParams.get("status") as EmployeeStatus) || undefined,
    page: safeParseInt(searchParams.get("page"), 1),
    pageSize: safeParseInt(searchParams.get("pageSize"), 20),
  };

  const result = await employeeService.findAll(session.user.tenantId, filters);

  return paginatedResponse(result.data, {
    page: filters.page,
    pageSize: filters.pageSize,
    total: result.pagination.total,
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const session = await auth();
  if (!session?.user) {
    throw Errors.unauthorized();
  }

  const body = await request.json();
  const validated = createEmployeeSchema.parse(body);

  const employee = await employeeService.create(
    session.user.tenantId,
    validated,
  );

  await audit.create(
    {
      tenantId: session.user.tenantId,
      userId: session.user.id,
      userEmail: session.user.email || "",
    },
    "Employee",
    employee.id,
  );

  return successResponse(employee, undefined, 201);
});
