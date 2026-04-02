// src/app/api/insights/route.ts
// Insights API

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { insightService } from "@/services/insight.service";
import type { InsightType, InsightSeverity } from ".prisma/hrm-unified-client";
import { safeParseInt } from "@/lib/api/parse-params";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only managers and admins can view insights
    if (!["ADMIN", "HR_MANAGER", "MANAGER"].includes(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") as InsightType | null;
    const severity = searchParams.get("severity") as InsightSeverity | null;
    const category = searchParams.get("category");
    const includeDismissed = searchParams.get("includeDismissed") === "true";
    const page = safeParseInt(searchParams.get("page"), 1);
    const pageSize = safeParseInt(searchParams.get("pageSize"), 20);

    const result = await insightService.getAll(session.user.tenantId, {
      type: type || undefined,
      severity: severity || undefined,
      category: category || undefined,
      includeDismissed,
      page,
      pageSize,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Get insights error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
