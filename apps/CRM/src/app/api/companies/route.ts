import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/crm-client";
import { getCurrentUser, AuthError } from "@/lib/auth/get-current-user";
import { requireRole, isErrorResponse, canAccess } from "@/lib/auth/rbac";
import { validateRequest, createCompanySchema } from "@/lib/validations";
import { handleApiError } from "@/lib/api/errors";
import { sanitizeObject } from "@/lib/api/sanitize";
import { removeDiacritics } from "@/lib/utils/vietnamese";

// GET /api/companies — List companies with search, filter, pagination
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q") || "";
    const industry = searchParams.get("industry");
    const size = searchParams.get("size");
    const cursor = searchParams.get("cursor");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "20")),
    );

    const where: Prisma.CompanyWhereInput = {};

    if (!canAccess(user, "view_all")) {
      where.ownerId = user.id;
    }

    if (q) {
      const normalized = removeDiacritics(q);
      const terms = [q];
      if (normalized !== q) terms.push(normalized);
      where.OR = terms.flatMap((term) => [
        { name: { contains: term, mode: "insensitive" as const } },
        { domain: { contains: term, mode: "insensitive" as const } },
        { email: { contains: term, mode: "insensitive" as const } },
        { taxCode: { contains: term, mode: "insensitive" as const } },
      ]);
    }

    if (industry) {
      where.industry = industry;
    }

    if (size) {
      where.size = size as any;
    }

    const includeClause = {
      tags: { include: { tag: true } },
      _count: {
        select: {
          contacts: true,
          deals: true,
        },
      },
    };

    if (cursor) {
      const data = await prisma.company.findMany({
        where,
        include: includeClause,
        orderBy: { updatedAt: "desc" },
        take: limit + 1,
        cursor: { id: cursor },
        skip: 1,
      });

      const hasMore = data.length > limit;
      const items = hasMore ? data.slice(0, limit) : data;
      const nextCursor = hasMore ? items[items.length - 1].id : null;

      return NextResponse.json({ data: items, nextCursor, hasMore });
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: includeClause,
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.company.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, limit });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/companies error:", error);
    return NextResponse.json(
      { error: "Failed to fetch companies" },
      { status: 500 },
    );
  }
}

// POST /api/companies — Create company
export async function POST(req: NextRequest) {
  try {
    const result = await requireRole(["ADMIN", "MANAGER", "MEMBER"]);
    if (isErrorResponse(result)) return result;
    const user = result;

    const body = await req.json();
    const validated = validateRequest(createCompanySchema, body);
    const data = sanitizeObject(validated);

    const company = await prisma.company.create({
      data: {
        name: data.name,
        domain: data.domain || undefined,
        industry: data.industry || undefined,
        size: data.size || undefined,
        phone: data.phone || undefined,
        email: data.email || undefined,
        website: data.website || undefined,
        address: data.address || undefined,
        city: data.city || undefined,
        province: data.province || undefined,
        country: data.country || "VN",
        taxCode: data.taxCode || undefined,
        notes: data.notes || undefined,
        logoUrl: data.logoUrl || undefined,
        parentId: data.parentId || undefined,
        ownerId: user.id,
      },
      include: {
        tags: { include: { tag: true } },
        _count: {
          select: { contacts: true, deals: true },
        },
      },
    });

    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    return handleApiError(error, "/api/companies");
  }
}
