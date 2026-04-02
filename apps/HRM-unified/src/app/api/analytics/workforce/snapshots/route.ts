import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { workforceAnalyticsService } from "@/services/analytics";
import { z } from "zod";
import type { SnapshotType } from ".prisma/hrm-unified-client";

const createSnapshotSchema = z.object({
  snapshotType: z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
  snapshotDate: z.string().transform((s) => new Date(s)),
});

// GET /api/analytics/workforce/snapshots
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = session.user.tenantId;
    const { searchParams } = new URL(request.url);

    const snapshotType = (searchParams.get("type") ||
      "MONTHLY") as SnapshotType;
    const startDateStr = searchParams.get("startDate");
    const endDateStr = searchParams.get("endDate");

    const endDate = endDateStr ? new Date(endDateStr) : new Date();
    const startDate = startDateStr
      ? new Date(startDateStr)
      : new Date(
          endDate.getFullYear() - 1,
          endDate.getMonth(),
          endDate.getDate(),
        );

    const snapshots = await workforceAnalyticsService.getSnapshots(
      tenantId,
      snapshotType,
      startDate,
      endDate,
    );

    return NextResponse.json({
      success: true,
      data: snapshots,
    });
  } catch (error) {
    console.error("Error fetching snapshots:", error);
    return NextResponse.json(
      { error: "Failed to fetch snapshots" },
      { status: 500 },
    );
  }
}

// POST /api/analytics/workforce/snapshots
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
    const data = createSnapshotSchema.parse(body);

    const snapshot = await workforceAnalyticsService.createSnapshot(
      tenantId,
      data.snapshotType,
      data.snapshotDate,
    );

    return NextResponse.json(
      {
        success: true,
        data: snapshot,
        message: "Snapshot created successfully",
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
    console.error("Error creating snapshot:", error);
    return NextResponse.json(
      { error: "Failed to create snapshot" },
      { status: 500 },
    );
  }
}
