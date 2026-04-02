import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/crm-client";
import { requireRole, isErrorResponse } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/errors";

// GET /api/commissions — List all commissions
export async function GET(req: NextRequest) {
  try {
    const result = await requireRole(["ADMIN", "MANAGER"]);
    if (isErrorResponse(result)) return result;

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");
    const partnerId = searchParams.get("partnerId");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50")),
    );
    const skip = (page - 1) * limit;

    const where: Prisma.CommissionWhereInput = {};
    if (status) where.status = status as any;
    if (partnerId) where.partnerId = partnerId;

    const [data, total] = await Promise.all([
      prisma.commission.findMany({
        where,
        include: {
          deal: {
            select: { id: true, title: true, value: true, currency: true },
          },
          partner: {
            include: { company: { select: { id: true, name: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.commission.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, limit });
  } catch (error) {
    return handleApiError(error, "/api/commissions");
  }
}
