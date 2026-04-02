import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/crm-client";
import { getCurrentUser, AuthError } from "@/lib/auth/get-current-user";
import { requireRole, isErrorResponse, canAccess } from "@/lib/auth/rbac";
import { validateRequest, createActivitySchema } from "@/lib/validations";
import { handleApiError } from "@/lib/api/errors";

// GET /api/activities — List activities with filters, pagination
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const { searchParams } = req.nextUrl;
    const type = searchParams.get("type");
    const contactId = searchParams.get("contactId");
    const dealId = searchParams.get("dealId");
    const userId = searchParams.get("userId");
    const isCompleted = searchParams.get("isCompleted");
    const cursor = searchParams.get("cursor");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "20")),
    );

    const where: Prisma.ActivityWhereInput = {};

    if (!canAccess(user, "view_all")) {
      where.userId = user.id;
    }

    if (type) where.type = type as any;
    if (contactId) where.contactId = contactId;
    if (dealId) where.dealId = dealId;
    if (userId && canAccess(user, "view_all")) where.userId = userId;
    if (isCompleted !== null && isCompleted !== undefined) {
      where.isCompleted = isCompleted === "true";
    }

    const includeClause = {
      contact: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      company: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true, value: true } },
      user: { select: { id: true, name: true, avatarUrl: true } },
    };

    if (cursor) {
      const data = await prisma.activity.findMany({
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

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        include: includeClause,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.activity.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, limit });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/activities error:", error);
    return NextResponse.json(
      { error: "Failed to fetch activities" },
      { status: 500 },
    );
  }
}

// POST /api/activities — Create activity
export async function POST(req: NextRequest) {
  try {
    const result = await requireRole(["ADMIN", "MANAGER", "MEMBER"]);
    if (isErrorResponse(result)) return result;
    const user = result;

    const body = await req.json();
    const data = validateRequest(createActivitySchema, body);

    const activity = await prisma.activity.create({
      data: {
        type: data.type,
        subject: data.subject,
        description: data.description,
        dueAt: data.dueAt || undefined,
        duration: data.duration,
        contactId: data.contactId || undefined,
        companyId: data.companyId || undefined,
        dealId: data.dealId || undefined,
        userId: user.id,
      },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    if (data.contactId) {
      await prisma.contact
        .update({
          where: { id: data.contactId },
          data: { lastActivityAt: new Date() },
        })
        .catch(() => {});
    }

    return NextResponse.json(activity, { status: 201 });
  } catch (error) {
    return handleApiError(error, "/api/activities");
  }
}
