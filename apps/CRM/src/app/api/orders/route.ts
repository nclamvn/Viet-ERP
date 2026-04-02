import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/crm-client";
import { getCurrentUser, AuthError } from "@/lib/auth/get-current-user";
import { requireRole, isErrorResponse, canAccess } from "@/lib/auth/rbac";
import { validateRequest, createOrderSchema } from "@/lib/validations";
import { handleApiError } from "@/lib/api/errors";

// Auto-generate order number: ORD-YYYY-NNNN
async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;

  const lastOrder = await prisma.salesOrder.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });

  let nextNum = 1;
  if (lastOrder) {
    const lastNum = parseInt(lastOrder.orderNumber.replace(prefix, ""));
    if (!isNaN(lastNum)) nextNum = lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(4, "0")}`;
}

// GET /api/orders — List orders with status filter, pagination
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");
    const cursor = searchParams.get("cursor");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "20")),
    );

    const where: Prisma.SalesOrderWhereInput = {};

    if (!canAccess(user, "view_all")) {
      where.createdById = user.id;
    }

    if (status) {
      where.status = status as any;
    }

    const includeClause = {
      company: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true } },
      _count: { select: { items: true } },
      createdBy: { select: { id: true, name: true } },
    };

    // Cursor-based pagination
    if (cursor) {
      const data = await prisma.salesOrder.findMany({
        where,
        include: includeClause,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        cursor: { id: cursor },
        skip: 1,
      });

      const hasMore = data.length > limit;
      const items = hasMore ? data.slice(0, limit) : data;
      const nextCursor = hasMore ? items[items.length - 1].id : null;

      return NextResponse.json({ data: items, nextCursor, hasMore });
    }

    // Offset-based pagination
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        include: includeClause,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.salesOrder.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, limit });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/orders error:", error);
    return NextResponse.json(
      { error: "Failed to fetch orders" },
      { status: 500 },
    );
  }
}

// POST /api/orders — Create order (can be from quote conversion)
export async function POST(req: NextRequest) {
  try {
    const result = await requireRole(["ADMIN", "MANAGER", "MEMBER"]);
    if (isErrorResponse(result)) return result;
    const user = result;
    const body = await req.json();
    const data = validateRequest(createOrderSchema, body);

    const orderNumber = await generateOrderNumber();

    let orderItems: any[] = [];
    let currency = "VND";

    // If converting from a quote, pull items and currency from the quote
    if (data.quoteId) {
      const quote = await prisma.quote.findUnique({
        where: { id: data.quoteId! },
        include: { items: true },
      });
      if (!quote) {
        return NextResponse.json({ error: "Quote not found" }, { status: 404 });
      }

      currency = quote.currency;

      // Mark quote as accepted
      await prisma.quote.update({
        where: { id: data.quoteId! },
        data: { status: "ACCEPTED" },
      });

      orderItems = quote.items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
        description: item.description,
        productId: item.productId || undefined,
      }));
    } else {
      // Try to inherit currency from deal if no quote
      if (data.dealId) {
        const deal = await prisma.deal.findUnique({
          where: { id: data.dealId },
          select: { currency: true },
        });
        if (deal) currency = deal.currency;
      }
    }

    if (!data.quoteId && data.items?.length) {
      orderItems = data.items.map((item) => {
        const itemTotal = item.quantity * item.unitPrice;
        return {
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: itemTotal,
          description: item.description,
          productId: item.productId || undefined,
        };
      });
    }

    // Calculate totals
    const subtotal = orderItems.reduce(
      (sum, item) => sum + Number(item.total),
      0,
    );
    const taxAmount = subtotal * 0.1; // 10% VAT
    const total = subtotal + taxAmount;

    const order = await prisma.salesOrder.create({
      data: {
        orderNumber,
        companyId: data.companyId || undefined,
        dealId: data.dealId || undefined,
        quoteId: data.quoteId || undefined,
        currency,
        shippingAddress: data.shippingAddress,
        notes: data.notes,
        subtotal,
        taxAmount,
        total,
        createdById: user.id,
        items: {
          create: orderItems,
        },
      },
      include: {
        items: { include: { product: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        quote: { select: { id: true, quoteNumber: true } },
      },
    });

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    return handleApiError(error, "/api/orders");
  }
}
