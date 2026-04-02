import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/crm-client";
import { getCurrentUser, AuthError } from "@/lib/auth/get-current-user";
import { requireRole, isErrorResponse, canAccess } from "@/lib/auth/rbac";
import { validateRequest, createQuoteSchema } from "@/lib/validations";
import { handleApiError } from "@/lib/api/errors";

// Auto-generate quote number: QUO-YYYY-NNNN
async function generateQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `QUO-${year}-`;

  const lastQuote = await prisma.quote.findFirst({
    where: { quoteNumber: { startsWith: prefix } },
    orderBy: { quoteNumber: "desc" },
    select: { quoteNumber: true },
  });

  let nextNum = 1;
  if (lastQuote) {
    const lastNum = parseInt(lastQuote.quoteNumber.replace(prefix, ""));
    if (!isNaN(lastNum)) nextNum = lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(4, "0")}`;
}

// GET /api/quotes — List quotes with status filter, pagination
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

    const where: Prisma.QuoteWhereInput = {};

    if (!canAccess(user, "view_all")) {
      where.createdById = user.id;
    }

    if (status) {
      where.status = status as any;
    }

    const includeClause = {
      contact: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      company: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true } },
      _count: { select: { items: true } },
    };

    // Cursor-based pagination
    if (cursor) {
      const data = await prisma.quote.findMany({
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
      prisma.quote.findMany({
        where,
        include: includeClause,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.quote.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, limit });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/quotes error:", error);
    return NextResponse.json(
      { error: "Failed to fetch quotes" },
      { status: 500 },
    );
  }
}

// POST /api/quotes — Create quote with items
export async function POST(req: NextRequest) {
  try {
    const result = await requireRole(["ADMIN", "MANAGER", "MEMBER"]);
    if (isErrorResponse(result)) return result;
    const user = result;
    const body = await req.json();
    const data = validateRequest(createQuoteSchema, body);

    const quoteNumber = await generateQuoteNumber();

    // Calculate totals from validated items
    let subtotal = 0;
    const processedItems = data.items.map((item, index: number) => {
      const itemTotal = item.quantity * item.unitPrice - item.discount;
      subtotal += itemTotal;
      return {
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        total: itemTotal,
        description: item.description,
        productId: item.productId || undefined,
        sortOrder: index,
      };
    });

    const discountAmount = subtotal * (data.discountPercent / 100);
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = afterDiscount * (data.taxPercent / 100);
    const total = afterDiscount + taxAmount;

    // Resolve currency: explicit > deal's currency > VND
    let currency = data.currency;
    if (!currency && data.dealId) {
      const deal = await prisma.deal.findUnique({
        where: { id: data.dealId },
        select: { currency: true },
      });
      currency = deal?.currency || "VND";
    }

    const quote = await prisma.quote.create({
      data: {
        quoteNumber,
        contactId: data.contactId || undefined,
        companyId: data.companyId || undefined,
        dealId: data.dealId || undefined,
        currency: currency || "VND",
        validUntil: data.validUntil || undefined,
        notes: data.notes,
        terms: data.terms,
        subtotal,
        discountPercent: data.discountPercent,
        discountAmount,
        taxPercent: data.taxPercent,
        taxAmount,
        total,
        createdById: user.id,
        items: {
          create: processedItems,
        },
      },
      include: {
        items: { include: { product: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
      },
    });

    return NextResponse.json(quote, { status: 201 });
  } catch (error) {
    return handleApiError(error, "/api/quotes");
  }
}
