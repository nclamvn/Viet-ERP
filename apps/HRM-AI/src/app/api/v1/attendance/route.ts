import { NextRequest } from "next/server";
import { authenticateApiRequest, apiResponse, apiError } from "@/lib/api/auth";
import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-ai-client";
import { safeParseInt } from "@/lib/api/parse-params";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, "read:attendance");
  if (!auth.success) return apiError(auth.error!, auth.statusCode);

  const { searchParams } = new URL(request.url);
  const page = safeParseInt(searchParams.get("page"), 1);
  const limit = Math.min(safeParseInt(searchParams.get("limit"), 50), 100);
  const date = searchParams.get("date");
  const employeeId = searchParams.get("employeeId");

  const where: Prisma.AttendanceWhereInput = {
    employee: { tenantId: auth.tenantId },
  };
  if (date) where.date = new Date(date);
  if (employeeId) where.employeeId = employeeId;

  const [data, total] = await Promise.all([
    db.attendance.findMany({
      where,
      include: {
        employee: { select: { id: true, employeeCode: true, fullName: true } },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { date: "desc" },
    }),
    db.attendance.count({ where }),
  ]);

  return apiResponse(data, { page, limit, total });
}
