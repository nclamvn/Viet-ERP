import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { predictiveAnalyticsService } from "@/services/analytics";
import { z } from "zod";
import type { PredictionModelType, RiskLevel } from ".prisma/hrm-ai-client";
import { safeParseInt } from "@/lib/api/parse-params";

const runPredictionsSchema = z.object({
  modelType: z.enum([
    "TURNOVER_RISK",
    "PROMOTION_READINESS",
    "PERFORMANCE_TREND",
    "SKILL_GAP",
    "COMPENSATION_EQUITY",
    "HEADCOUNT_FORECAST",
  ]),
  entityIds: z.array(z.string()).optional(),
});

// GET /api/analytics/predictions
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = session.user.tenantId;
    const { searchParams } = new URL(request.url);

    const modelType = searchParams.get(
      "modelType",
    ) as PredictionModelType | null;
    const riskLevel = searchParams.get("riskLevel") as RiskLevel | null;
    const entityType = searchParams.get("entityType");
    const limit = safeParseInt(searchParams.get("limit"), 100);

    const predictions = await predictiveAnalyticsService.getPredictions(
      tenantId,
      {
        modelType: modelType || undefined,
        riskLevel: riskLevel || undefined,
        entityType: entityType || undefined,
        limit,
      },
    );

    // Get risk distribution
    const distribution =
      await predictiveAnalyticsService.getRiskDistribution(tenantId);

    return NextResponse.json({
      success: true,
      data: {
        predictions,
        distribution,
        total: predictions.length,
      },
    });
  } catch (error) {
    console.error("Error fetching predictions:", error);
    return NextResponse.json(
      { error: "Failed to fetch predictions" },
      { status: 500 },
    );
  }
}

// POST /api/analytics/predictions
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only allow admin/HR roles
    if (!["SUPER_ADMIN", "ADMIN", "HR_MANAGER"].includes(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const tenantId = session.user.tenantId;
    const body = await request.json();
    const data = runPredictionsSchema.parse(body);

    const results = await predictiveAnalyticsService.runPredictions(
      tenantId,
      data.modelType,
      data.entityIds,
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          predictions: results,
          total: results.length,
        },
        message: `Generated ${results.length} predictions`,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 },
      );
    }
    console.error("Error running predictions:", error);
    return NextResponse.json(
      { error: "Failed to run predictions" },
      { status: 500 },
    );
  }
}
