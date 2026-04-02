import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { alertService } from "@/services/analytics";
import { z } from "zod";
import type { AlertSeverity, AlertStatus } from ".prisma/hrm-unified-client";

const createAlertSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  metricType: z.string(),
  condition: z.enum(["gt", "lt", "eq", "gte", "lte", "change_percent"]),
  threshold: z.number(),
  compareWith: z
    .enum(["previous_period", "same_period_last_year", "fixed_value"])
    .optional(),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  departmentId: z.string().optional(),
  notifyUsers: z.array(z.string()).optional(),
  notifyRoles: z.array(z.string()).optional(),
  notifyEmail: z.boolean().optional(),
  notifyInApp: z.boolean().optional(),
  cooldownMinutes: z.number().int().positive().optional(),
});

// GET /api/analytics/alerts
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = session.user.tenantId;
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status") as AlertStatus | null;
    const severity = searchParams.get("severity") as AlertSeverity | null;
    const isActive = searchParams.get("isActive");
    const departmentId = searchParams.get("departmentId");

    const alerts = await alertService.listAlerts(tenantId, {
      status: status || undefined,
      severity: severity || undefined,
      isActive: isActive !== null ? isActive === "true" : undefined,
      departmentId: departmentId || undefined,
    });

    return NextResponse.json({
      success: true,
      data: alerts,
    });
  } catch (error) {
    console.error("Error fetching alerts:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts" },
      { status: 500 },
    );
  }
}

// POST /api/analytics/alerts
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
    const userId = session.user.id;
    const body = await request.json();
    const data = createAlertSchema.parse(body);

    const alert = await alertService.createAlert(tenantId, userId, data);

    return NextResponse.json(
      {
        success: true,
        data: alert,
        message: "Alert created successfully",
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
    console.error("Error creating alert:", error);
    return NextResponse.json(
      { error: "Failed to create alert" },
      { status: 500 },
    );
  }
}
