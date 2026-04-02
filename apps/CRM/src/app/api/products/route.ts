import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/crm-client";

// GET /api/products — List products with filters
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q") || "";
    const category = searchParams.get("category");
    const isActive = searchParams.get("isActive");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50")),
    );
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {};

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    if (category) {
      where.category = category as any;
    }

    if (isActive !== null && isActive !== undefined) {
      where.isActive = isActive === "true";
    }

    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, limit });
  } catch (error) {
    console.error("GET /api/products error:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 },
    );
  }
}

// POST /api/products — Create product
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name,
      sku,
      description,
      unitPrice,
      currency,
      unit,
      isActive,
      category,
      eccn,
      itar,
      exportNotes,
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Product name is required" },
        { status: 400 },
      );
    }

    const product = await prisma.product.create({
      data: {
        name,
        sku: sku || undefined,
        description,
        unitPrice: unitPrice || 0,
        currency: currency || "VND",
        unit: unit || "piece",
        isActive: isActive !== undefined ? isActive : true,
        category,
        eccn: eccn || undefined,
        itar: itar !== undefined ? itar : false,
        exportNotes: exportNotes || undefined,
      },
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "A product with this SKU already exists" },
        { status: 400 },
      );
    }
    console.error("POST /api/products error:", error);
    return NextResponse.json(
      { error: "Failed to create product" },
      { status: 500 },
    );
  }
}
