// ═══════════════════════════════════════════════════════════════════
//                    MOBILE EQUIPMENT API
//              Equipment status for technicians - Production
// ═══════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/api/with-auth";

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbEquipmentResult = Record<string, any>;

// Helper: Transform equipment from database
function transformEquipment(eq: DbEquipmentResult) {
  // Calculate next PM date from maintenance schedules or equipment field
  const nextPM =
    eq.nextMaintenanceDate?.toISOString().split("T")[0] ||
    eq.maintenanceSchedules?.[0]?.nextDueDate?.toISOString().split("T")[0] ||
    null;

  // Get last issue from maintenance orders
  const lastIssue = eq.maintenanceOrders?.find(
    (mo: DbEquipmentResult) => mo.type === "CM" || mo.type === "EM",
  )?.problemReported;

  return {
    id: eq.id,
    code: eq.code,
    name: eq.name,
    type: eq.type || "General",
    location:
      eq.location || eq.workCenter?.location || eq.workCenter?.name || "",
    status: mapStatus(eq.status),
    oee: eq.currentOee || eq.targetOee || 0,
    runningHours: Math.round((eq.totalDowntimeHours || 0) * 10) / 10, // Show downtime hours
    nextPM,
    lastIssue,
    workCenter: eq.workCenter?.name,
    criticality: eq.criticality,
  };
}

// Map database status to UI status
function mapStatus(
  status: string,
): "RUNNING" | "IDLE" | "DOWN" | "MAINTENANCE" {
  const statusMap: Record<string, "RUNNING" | "IDLE" | "DOWN" | "MAINTENANCE"> =
    {
      operational: "RUNNING",
      running: "RUNNING",
      active: "RUNNING",
      idle: "IDLE",
      standby: "IDLE",
      down: "DOWN",
      breakdown: "DOWN",
      failed: "DOWN",
      maintenance: "MAINTENANCE",
      under_maintenance: "MAINTENANCE",
      planned_maintenance: "MAINTENANCE",
    };
  return statusMap[status?.toLowerCase()] || "IDLE";
}

/**
 * GET /api/mobile/equipment
 * Get equipment list with status
 */
export const GET = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(req.url);
    const equipmentId = searchParams.get("equipmentId");
    const status = searchParams.get("status");
    const workCenterId = searchParams.get("workCenterId");
    const search = searchParams.get("search");

    // Build where clause
    const where: Prisma.EquipmentWhereInput = {};

    if (equipmentId) {
      where.id = equipmentId;
    }

    if (status && status !== "all") {
      // Map UI status to database status values
      const statusMap: Record<string, string[]> = {
        RUNNING: ["operational", "running", "active"],
        IDLE: ["idle", "standby"],
        DOWN: ["down", "breakdown", "failed"],
        MAINTENANCE: [
          "maintenance",
          "under_maintenance",
          "planned_maintenance",
        ],
      };
      where.status = {
        in: statusMap[status.toUpperCase()] || [status.toLowerCase()],
      };
    }

    if (workCenterId) {
      where.workCenterId = workCenterId;
    }

    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ];
    }

    // Fetch from database
    const equipment = await prisma.equipment.findMany({
      where,
      include: {
        workCenter: {
          select: { id: true, code: true, name: true, location: true },
        },
        maintenanceSchedules: {
          where: { isActive: true },
          orderBy: { nextDueDate: "asc" },
          take: 1,
          select: { nextDueDate: true },
        },
        maintenanceOrders: {
          where: { status: { not: "completed" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { type: true, description: true },
        },
      },
      orderBy: [{ status: "asc" }, { code: "asc" }],
      take: 100,
    });

    // Transform results
    const results = equipment.map(transformEquipment);

    // Calculate summary
    const summary = {
      total: results.length,
      running: results.filter((e) => e.status === "RUNNING").length,
      idle: results.filter((e) => e.status === "IDLE").length,
      down: results.filter((e) => e.status === "DOWN").length,
      maintenance: results.filter((e) => e.status === "MAINTENANCE").length,
    };

    return NextResponse.json({
      success: true,
      data: results,
      summary,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/mobile/equipment",
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch equipment" },
      { status: 500 },
    );
  }
});

/**
 * POST /api/mobile/equipment
 * Update equipment status or report issue
 */
export const POST = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const bodySchema = z.object({
      action: z.string(),
      equipmentId: z.string(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: z.any().optional() as z.ZodOptional<z.ZodType<Record<string, any>>>,
    });

    const rawBody = await req.json();
    const parseResult = bodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input",
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }
    const body = parseResult.data;
    const { action, equipmentId, data } = body;

    if (!equipmentId || !action) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: equipmentId, action",
        },
        { status: 400 },
      );
    }

    const equipment = await prisma.equipment.findUnique({
      where: { id: equipmentId },
    });

    if (!equipment) {
      return NextResponse.json(
        { success: false, error: "Equipment not found" },
        { status: 404 },
      );
    }

    switch (action) {
      case "update_status": {
        const { newStatus } = data || {};
        if (!newStatus) {
          return NextResponse.json(
            { success: false, error: "New status required" },
            { status: 400 },
          );
        }

        await prisma.equipment.update({
          where: { id: equipmentId },
          data: { status: newStatus.toLowerCase() },
        });

        return NextResponse.json({
          success: true,
          message: `Equipment ${equipment.code} status updated to ${newStatus}`,
          data: {
            equipmentCode: equipment.code,
            newStatus,
            updatedAt: new Date().toISOString(),
          },
        });
      }

      case "report_downtime": {
        const { reason, description, severity } = data || {};

        if (!reason || !description) {
          return NextResponse.json(
            { success: false, error: "Reason and description required" },
            { status: 400 },
          );
        }

        // Update equipment status to down
        await prisma.equipment.update({
          where: { id: equipmentId },
          data: { status: "down" },
        });

        // Create maintenance order for the issue
        const maintenanceOrder = await prisma.maintenanceOrder.create({
          data: {
            orderNumber: `MO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now().toString().slice(-4)}`,
            equipmentId,
            type: "CM", // Corrective Maintenance
            priority:
              severity === "critical"
                ? "emergency"
                : severity === "high"
                  ? "high"
                  : "medium",
            status: "pending",
            title: `${reason} - ${equipment.code}`,
            description,
            problemReported: `${reason}: ${description}`,
          },
        });

        return NextResponse.json({
          success: true,
          message: `Downtime reported for ${equipment.code}`,
          data: {
            equipmentCode: equipment.code,
            maintenanceOrderId: maintenanceOrder.id,
            maintenanceOrderNumber: maintenanceOrder.orderNumber,
            reportedAt: new Date().toISOString(),
          },
        });
      }

      case "start_maintenance": {
        // Update equipment status to maintenance
        await prisma.equipment.update({
          where: { id: equipmentId },
          data: { status: "maintenance" },
        });

        return NextResponse.json({
          success: true,
          message: `Maintenance started for ${equipment.code}`,
          data: {
            equipmentCode: equipment.code,
            startedAt: new Date().toISOString(),
          },
        });
      }

      case "complete_maintenance": {
        const { notes } = data || {};

        // Update equipment status back to operational
        await prisma.equipment.update({
          where: { id: equipmentId },
          data: { status: "operational" },
        });

        return NextResponse.json({
          success: true,
          message: `Maintenance completed for ${equipment.code}`,
          data: {
            equipmentCode: equipment.code,
            completedAt: new Date().toISOString(),
            notes,
          },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Invalid action: ${action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/mobile/equipment",
    });
    return NextResponse.json(
      { success: false, error: "Failed to process equipment operation" },
      { status: 500 },
    );
  }
});
