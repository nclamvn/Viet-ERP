import { NextRequest } from "next/server";
import { authenticateApiRequest, apiResponse, apiError } from "@/lib/api/auth";
import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-unified-client";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request, "read:leave");
  if (!auth.success) return apiError(auth.error!, auth.statusCode);

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId");
  const year = parseInt(
    searchParams.get("year") || String(new Date().getFullYear()),
  );

  const where: Prisma.LeaveBalanceWhereInput = {
    employee: { tenantId: auth.tenantId },
    year,
  };
  if (employeeId) where.employeeId = employeeId;

  const balances = await db.leaveBalance.findMany({
    where,
    include: {
      employee: { select: { id: true, employeeCode: true, fullName: true } },
      policy: { select: { id: true, code: true, name: true } },
    },
  });

  const data = balances.map((b) => ({
    ...b,
    entitlement: Number(b.entitlement),
    used: Number(b.used),
    remaining: Number(b.entitlement) - Number(b.used),
  }));

  return apiResponse(data);
}
