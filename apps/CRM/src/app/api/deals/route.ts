import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/crm-client";
import { getCurrentUser, AuthError } from "@/lib/auth/get-current-user";
import { requireRole, isErrorResponse, canAccess } from "@/lib/auth/rbac";
import { validateRequest, createDealSchema } from "@/lib/validations";
import { handleApiError } from "@/lib/api/errors";
import { sanitizeObject } from "@/lib/api/sanitize";
import { removeDiacritics } from "@/lib/utils/vietnamese";
import { getChecklistTemplate } from "@/lib/compliance/checklist-templates";

// GET /api/deals — List deals with filters, pagination
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q") || "";
    const stageId = searchParams.get("stageId");
    const companyId = searchParams.get("companyId");
    const ownerId = searchParams.get("ownerId");
    const cursor = searchParams.get("cursor");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "20")),
    );

    const where: Prisma.DealWhereInput = {};

    if (!canAccess(user, "view_all")) {
      where.ownerId = user.id;
    }

    if (q) {
      const normalized = removeDiacritics(q);
      const terms = [q];
      if (normalized !== q) terms.push(normalized);
      where.OR = terms.flatMap((term) => [
        { title: { contains: term, mode: "insensitive" as const } },
        { notes: { contains: term, mode: "insensitive" as const } },
      ]);
    }

    if (stageId) where.stageId = stageId;
    if (companyId) where.companyId = companyId;
    if (ownerId && canAccess(user, "view_all")) where.ownerId = ownerId;

    const includeClause = {
      stage: {
        select: {
          id: true,
          name: true,
          color: true,
          probability: true,
          isWon: true,
          isLost: true,
        },
      },
      company: { select: { id: true, name: true, country: true } },
      contacts: {
        include: {
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      },
      owner: { select: { id: true, name: true, avatarUrl: true } },
      partner: { include: { company: { select: { id: true, name: true } } } },
    };

    if (cursor) {
      const data = await prisma.deal.findMany({
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
      prisma.deal.findMany({
        where,
        include: includeClause,
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.deal.count({ where }),
    ]);

    return NextResponse.json({ data, total, page, limit });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/deals error:", error);
    return NextResponse.json(
      { error: "Failed to fetch deals" },
      { status: 500 },
    );
  }
}

// POST /api/deals — Create deal
export async function POST(req: NextRequest) {
  try {
    const result = await requireRole(["ADMIN", "MANAGER", "MEMBER"]);
    if (isErrorResponse(result)) return result;
    const user = result;

    const body = await req.json();
    const validated = validateRequest(createDealSchema, body);
    const data = sanitizeObject(validated);

    // Build contacts create from new contacts array or legacy contactIds
    const contactsCreate = data.contacts?.length
      ? data.contacts.map(
          (c: { contactId: string; role?: string; isPrimary?: boolean }) => ({
            contactId: c.contactId,
            role: c.role || "OTHER",
            isPrimary: c.isPrimary || false,
          }),
        )
      : data.contactIds?.length
        ? data.contactIds.map((contactId: string) => ({ contactId }))
        : undefined;

    const deal = await prisma.deal.create({
      data: {
        title: data.title,
        stageId: data.stageId,
        pipelineId: data.pipelineId,
        value: data.value,
        currency: data.currency || "VND",
        dealType: data.dealType || undefined,
        companyId: data.companyId || undefined,
        partnerId: data.partnerId || undefined,
        expectedCloseAt: data.expectedCloseAt || undefined,
        notes: data.notes || undefined,
        ownerId: user.id,
        contacts: contactsCreate ? { create: contactsCreate } : undefined,
      },
      include: {
        stage: true,
        company: { select: { id: true, name: true } },
        contacts: { include: { contact: true } },
        owner: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Auto-create compliance checklist based on dealType
    if (data.dealType) {
      const template = getChecklistTemplate(data.dealType);
      if (template.length > 0) {
        await prisma.dealChecklist.createMany({
          data: template.map((item) => ({
            dealId: deal.id,
            key: item.key,
            label: item.labelKey,
          })),
        });
      }
    }

    return NextResponse.json(deal, { status: 201 });
  } catch (error) {
    return handleApiError(error, "/api/deals");
  }
}

// PATCH /api/deals — Bulk update (kanban stage move)
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const body = await req.json();
    const { id, stageId } = body;

    if (!id || !stageId) {
      return NextResponse.json(
        { error: "id and stageId are required" },
        { status: 400 },
      );
    }

    // Check ownership for stage moves
    const existing = await prisma.deal.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!existing)
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    if (!canAccess(user, "edit_any") && existing.ownerId !== user.id) {
      return NextResponse.json(
        {
          error: "Forbidden",
          message: "Bạn không có quyền thực hiện thao tác này",
        },
        { status: 403 },
      );
    }

    const deal = await prisma.deal.update({
      where: { id },
      data: { stageId },
      include: {
        stage: {
          select: {
            id: true,
            name: true,
            color: true,
            isWon: true,
            isLost: true,
          },
        },
        company: { select: { id: true, name: true } },
        contacts: {
          include: {
            contact: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        owner: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    return NextResponse.json(deal);
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    console.error("PATCH /api/deals error:", error);
    return NextResponse.json(
      { error: "Failed to update deal" },
      { status: 500 },
    );
  }
}
