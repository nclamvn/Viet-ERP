import { NextRequest } from "next/server";
import { authenticateApiRequest, apiResponse, apiError } from "@/lib/api/auth";
import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-unified-client";
import { safeParseInt } from "@/lib/api/parse-params";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, "read:employees");
  if (!auth.success) return apiError(auth.error!, auth.statusCode);

  const { searchParams } = new URL(request.url);
  const page = safeParseInt(searchParams.get("page"), 1);
  const limit = Math.min(safeParseInt(searchParams.get("limit"), 20), 100);
  const status = searchParams.get("status") || undefined;

  const where: Prisma.EmployeeWhereInput = { tenantId: auth.tenantId };
  if (status) where.status = status as Prisma.EnumEmployeeStatusFilter;

  const [data, total] = await Promise.all([
    db.employee.findMany({
      where,
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        workEmail: true,
        phone: true,
        gender: true,
        status: true,
        hireDate: true,
        department: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { employeeCode: "asc" },
    }),
    db.employee.count({ where }),
  ]);

  return apiResponse(data, { page, limit, total });
}
