// src/app/api/activity/timeline/route.ts
// Work session activity timeline endpoint

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from ".prisma/mrp-client";

function getEntityUrl(entityType: string, entityId: string): string {
  const routes: Record<string, string> = {
    PO: `/purchasing/${entityId}`,
    SO: `/orders/${entityId}`,
    MRP_RUN: `/mrp/${entityId}`,
    WORK_ORDER: `/production/${entityId}`,
    INVENTORY: `/inventory`,
    PART: `/engineering/parts/${entityId}`,
    BOM: `/engineering/bom/${entityId}`,
  };
  return routes[entityType] || "/";
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");
    const entityType = searchParams.get("entityType");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const sessionWhere: Prisma.WorkSessionWhereInput = {
      userId: session.user.id,
    };
    if (entityType) {
      sessionWhere.entityType = entityType;
    }

    const where: Prisma.SessionActivityWhereInput = {
      session: sessionWhere,
    };

    if (dateFrom || dateTo) {
      const timestampFilter: Prisma.DateTimeFilter = {};
      if (dateFrom) timestampFilter.gte = new Date(dateFrom);
      if (dateTo) timestampFilter.lte = new Date(dateTo);
      where.timestamp = timestampFilter;
    }

    const [activities, total] = await Promise.all([
      prisma.sessionActivity.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: limit,
        skip: offset,
        include: {
          session: {
            select: {
              entityType: true,
              entityNumber: true,
              entityId: true,
            },
          },
        },
      }),
      prisma.sessionActivity.count({ where }),
    ]);

    const transformedActivities = activities.map((activity) => ({
      id: activity.id,
      action: activity.action,
      description: activity.description,
      timestamp: activity.timestamp.toISOString(),
      entityType: activity.session.entityType,
      entityNumber: activity.session.entityNumber,
      entityUrl: getEntityUrl(
        activity.session.entityType,
        activity.session.entityId,
      ),
      metadata: (activity.metadataJson as Record<string, unknown>) || {},
    }));

    return NextResponse.json({
      activities: transformedActivities,
      total,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error("GET /api/activity/timeline error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
