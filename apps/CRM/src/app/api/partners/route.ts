import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/crm-client";
import { requireRole, isErrorResponse } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/errors";
import { partnerSchema } from "@/lib/validations/partner";

// GET /api/partners — List partners
export async function GET(req: NextRequest) {
  try {
    const result = await requireRole(["ADMIN", "MANAGER"]);
    if (isErrorResponse(result)) return result;

    const { searchParams } = req.nextUrl;
    const partnerType = searchParams.get("partnerType");
    const certificationLevel = searchParams.get("certificationLevel");
    const isActive = searchParams.get("isActive");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50")),
    );
    const skip = (page - 1) * limit;

    const where: Prisma.PartnerWhereInput = {};
    if (partnerType) where.partnerType = partnerType as any;
    if (certificationLevel)
      where.certificationLevel = certificationLevel as any;
    if (isActive !== null && isActive !== undefined)
      where.isActive = isActive === "true";

    const [data, total] = await Promise.all([
      prisma.partner.findMany({
        where,
        include: {
          company: {
            select: { id: true, name: true, country: true, logoUrl: true },
          },
          _count: {
            select: { deals: true, commissions: true, registrations: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.partner.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, limit });
  } catch (error) {
    return handleApiError(error, "/api/partners");
  }
}

// POST /api/partners — Create partner
export async function POST(req: NextRequest) {
  try {
    const result = await requireRole(["ADMIN"]);
    if (isErrorResponse(result)) return result;

    const body = await req.json();
    const data = partnerSchema.parse(body);

    const partner = await prisma.partner.create({
      data: {
        companyId: data.companyId,
        partnerType: data.partnerType,
        territory: data.territory,
        commissionRate: data.commissionRate,
        certificationLevel: data.certificationLevel,
        contractStartDate: data.contractStartDate
          ? new Date(data.contractStartDate)
          : undefined,
        contractEndDate: data.contractEndDate
          ? new Date(data.contractEndDate)
          : undefined,
        isActive: data.isActive,
        notes: data.notes,
      },
      include: {
        company: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(partner, { status: 201 });
  } catch (error) {
    return handleApiError(error, "/api/partners");
  }
}
