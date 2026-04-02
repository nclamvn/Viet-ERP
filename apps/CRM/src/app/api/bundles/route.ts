import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/crm-client";
import { requireRole, isErrorResponse } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/errors";
import { bundleSchema } from "@/lib/validations/bundle";

// GET /api/bundles — List bundles
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const bundleType = searchParams.get("bundleType");
    const isActive = searchParams.get("isActive");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50")),
    );
    const skip = (page - 1) * limit;

    const where: Prisma.ProductBundleWhereInput = {};

    if (bundleType) where.bundleType = bundleType as any;
    if (isActive !== null && isActive !== undefined) {
      where.isActive = isActive === "true";
    }

    const [data, total] = await Promise.all([
      prisma.productBundle.findMany({
        where,
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  unitPrice: true,
                  category: true,
                },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
          pricingTiers: true,
        },
        orderBy: { sortOrder: "asc" },
        skip,
        take: limit,
      }),
      prisma.productBundle.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, limit });
  } catch (error) {
    console.error("GET /api/bundles error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bundles" },
      { status: 500 },
    );
  }
}

// POST /api/bundles — Create bundle + items
export async function POST(req: NextRequest) {
  try {
    const result = await requireRole(["ADMIN", "MANAGER"]);
    if (isErrorResponse(result)) return result;

    const body = await req.json();
    const data = bundleSchema.parse(body);

    const bundle = await prisma.productBundle.create({
      data: {
        name: data.name,
        description: data.description,
        sku: data.sku,
        bundleType: data.bundleType,
        basePrice: data.basePrice,
        currency: data.currency,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
        items: {
          create: data.items.map((item, idx) => ({
            productId: item.productId,
            quantity: item.quantity,
            isRequired: item.isRequired,
            sortOrder: item.sortOrder || idx,
          })),
        },
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                unitPrice: true,
                category: true,
              },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return NextResponse.json(bundle, { status: 201 });
  } catch (error) {
    return handleApiError(error, "/api/bundles");
  }
}
