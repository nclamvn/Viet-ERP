import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/crm-client";
import { getCurrentUser, AuthError } from "@/lib/auth/get-current-user";
import { requireRole, isErrorResponse, canAccess } from "@/lib/auth/rbac";
import { validateRequest, createContactSchema } from "@/lib/validations";
import { handleApiError } from "@/lib/api/errors";
import { sanitizeObject } from "@/lib/api/sanitize";
import { removeDiacritics } from "@/lib/utils/vietnamese";

// GET /api/contacts — List contacts with search, filter, pagination
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q") || "";
    const status = searchParams.get("status");
    const companyId = searchParams.get("companyId");
    const cursor = searchParams.get("cursor");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "20")),
    );

    const where: Prisma.ContactWhereInput = {};

    // MEMBER/VIEWER: only see own contacts
    if (!canAccess(user, "view_all")) {
      where.ownerId = user.id;
    }

    if (q) {
      const normalized = removeDiacritics(q);
      const terms = [q];
      if (normalized !== q) terms.push(normalized);
      where.OR = terms.flatMap((term) => [
        { firstName: { contains: term, mode: "insensitive" as const } },
        { lastName: { contains: term, mode: "insensitive" as const } },
        { email: { contains: term, mode: "insensitive" as const } },
        { phone: { contains: term, mode: "insensitive" as const } },
        { jobTitle: { contains: term, mode: "insensitive" as const } },
      ]);
    }

    if (status) {
      where.status = status as any;
    }

    if (companyId) {
      where.companyId = companyId;
    }

    const includeClause = {
      company: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
    };

    // Cursor-based pagination
    if (cursor) {
      const data = await prisma.contact.findMany({
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

    // Offset-based pagination
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: includeClause,
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.contact.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, limit });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/contacts error:", error);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 },
    );
  }
}

// POST /api/contacts — Create contact
export async function POST(req: NextRequest) {
  try {
    const result = await requireRole(["ADMIN", "MANAGER", "MEMBER"]);
    if (isErrorResponse(result)) return result;
    const user = result;

    const body = await req.json();
    const validated = validateRequest(createContactSchema, body);
    const data = sanitizeObject(validated);

    const contact = await prisma.contact.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || undefined,
        phone: data.phone || undefined,
        mobile: data.mobile || undefined,
        jobTitle: data.jobTitle || undefined,
        department: data.department || undefined,
        companyId: data.companyId || undefined,
        source: (data.source || undefined) as any,
        status: data.status,
        notes: data.notes || undefined,
        ownerId: user.id,
      },
      include: {
        company: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
      },
    });

    return NextResponse.json(contact, { status: 201 });
  } catch (error) {
    return handleApiError(error, "/api/contacts");
  }
}
