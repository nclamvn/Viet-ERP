// ═══════════════════════════════════════════════════════════════════
//                    MOBILE MAINTENANCE API
//              Maintenance orders for technicians - Production
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
type DbMaintenanceOrderResult = Record<string, any>;

// Helper: Transform maintenance order from database
function transformMaintenanceOrder(mo: DbMaintenanceOrderResult) {
  return {
    id: mo.id,
    workOrderNumber: mo.orderNumber,
    equipmentCode: mo.equipment?.code || "",
    equipmentName: mo.equipment?.name || "",
    location: mo.equipment?.location || mo.equipment?.workCenter?.name || "",
    type: mapType(mo.type),
    priority: mapPriority(mo.priority),
    status: mapStatus(mo.status),
    description: mo.description || mo.title,
    dueTime: mo.plannedEndDate
      ? new Date(mo.plannedEndDate).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    dueDate: mo.plannedEndDate?.toISOString().split("T")[0] || null,
    estimatedMinutes: Math.round((mo.estimatedDuration || 1) * 60),
    createdAt: mo.createdAt.toISOString(),
    assignedTo: mo.assignedTo,
  };
}

// Map database type to UI type
function mapType(type: string): "PM" | "CM" | "Emergency" | "Inspection" {
  const typeMap: Record<string, "PM" | "CM" | "Emergency" | "Inspection"> = {
    PM: "PM",
    PREVENTIVE: "PM",
    CM: "CM",
    CORRECTIVE: "CM",
    EM: "Emergency",
    EMERGENCY: "Emergency",
    CAL: "Inspection",
    CALIBRATION: "Inspection",
    INSPECTION: "Inspection",
  };
  return typeMap[type?.toUpperCase()] || "PM";
}

// Map database priority to UI priority
function mapPriority(priority: string): "URGENT" | "HIGH" | "NORMAL" {
  const priorityMap: Record<string, "URGENT" | "HIGH" | "NORMAL"> = {
    emergency: "URGENT",
    critical: "URGENT",
    high: "HIGH",
    medium: "NORMAL",
    low: "NORMAL",
  };
  return priorityMap[priority?.toLowerCase()] || "NORMAL";
}

// Map database status to UI status
function mapStatus(
  status: string,
): "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ON_HOLD" {
  const statusMap: Record<
    string,
    "PENDING" | "IN_PROGRESS" | "COMPLETED" | "ON_HOLD"
  > = {
    pending: "PENDING",
    scheduled: "PENDING",
    in_progress: "IN_PROGRESS",
    waiting_parts: "ON_HOLD",
    completed: "COMPLETED",
    cancelled: "COMPLETED",
  };
  return statusMap[status?.toLowerCase()] || "PENDING";
}

/**
 * GET /api/mobile/maintenance
 * Get maintenance orders for technicians
 */
export const GET = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(req.url);
    const maintenanceId = searchParams.get("maintenanceId");
    const status = searchParams.get("status") || "pending,in_progress";
    const assignedTo = searchParams.get("assignedTo");
    const equipmentId = searchParams.get("equipmentId");
    const search = searchParams.get("search");

    // Build where clause
    const where: Prisma.MaintenanceOrderWhereInput = {};

    if (maintenanceId) {
      where.id = maintenanceId;
    }

    // Map status filter
    if (status && status !== "all") {
      const statusList = status
        .toLowerCase()
        .split(",")
        .map((s) => s.trim());
      const dbStatuses: string[] = [];
      statusList.forEach((s) => {
        if (s === "pending") dbStatuses.push("pending", "scheduled");
        else if (s === "in_progress") dbStatuses.push("in_progress");
        else if (s === "completed") dbStatuses.push("completed", "cancelled");
        else if (s === "on_hold") dbStatuses.push("waiting_parts");
        else dbStatuses.push(s);
      });
      where.status = { in: dbStatuses };
    }

    if (assignedTo) {
      where.assignedTo = assignedTo;
    }

    if (equipmentId) {
      where.equipmentId = equipmentId;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
        { equipment: { code: { contains: search, mode: "insensitive" } } },
        { equipment: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Fetch from database
    const maintenanceOrders = await prisma.maintenanceOrder.findMany({
      where,
      include: {
        equipment: {
          include: {
            workCenter: {
              select: { name: true, location: true },
            },
          },
        },
      },
      orderBy: [
        { priority: "desc" },
        { plannedStartDate: "asc" },
        { createdAt: "desc" },
      ],
      take: 50,
    });

    // Transform results
    const results = maintenanceOrders.map(transformMaintenanceOrder);

    // Sort by priority
    const priorityOrder = { URGENT: 0, HIGH: 1, NORMAL: 2 };
    const statusOrder = {
      IN_PROGRESS: 0,
      PENDING: 1,
      ON_HOLD: 2,
      COMPLETED: 3,
    };
    results.sort((a, b) => {
      const statusDiff =
        (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99);
      if (statusDiff !== 0) return statusDiff;
      return (
        (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99)
      );
    });

    // Calculate summary
    const summary = {
      total: results.length,
      pending: results.filter((m) => m.status === "PENDING").length,
      inProgress: results.filter((m) => m.status === "IN_PROGRESS").length,
      completed: results.filter((m) => m.status === "COMPLETED").length,
      urgent: results.filter((m) => m.priority === "URGENT").length,
    };

    return NextResponse.json({
      success: true,
      data: results,
      summary,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/mobile/maintenance",
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch maintenance orders" },
      { status: 500 },
    );
  }
});

/**
 * POST /api/mobile/maintenance
 * Update maintenance order status
 */
export const POST = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const bodySchema = z.object({
      action: z.string(),
      maintenanceId: z.string(),
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
    const { action, maintenanceId, data } = body;

    if (!maintenanceId || !action) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: maintenanceId, action",
        },
        { status: 400 },
      );
    }

    const mo = await prisma.maintenanceOrder.findUnique({
      where: { id: maintenanceId },
      include: { equipment: true },
    });

    if (!mo) {
      return NextResponse.json(
        { success: false, error: "Maintenance order not found" },
        { status: 404 },
      );
    }

    switch (action) {
      case "start": {
        await prisma.maintenanceOrder.update({
          where: { id: maintenanceId },
          data: {
            status: "in_progress",
            actualStartDate: new Date(),
            assignedTo: data?.userId || mo.assignedTo,
          },
        });

        // Update equipment status
        if (mo.equipmentId) {
          await prisma.equipment.update({
            where: { id: mo.equipmentId },
            data: { status: "maintenance" },
          });
        }

        return NextResponse.json({
          success: true,
          message: `Started maintenance: ${mo.orderNumber}`,
          data: {
            maintenanceOrderNumber: mo.orderNumber,
            startedAt: new Date().toISOString(),
          },
        });
      }

      case "pause": {
        const { reason } = data || {};

        await prisma.maintenanceOrder.update({
          where: { id: maintenanceId },
          data: {
            status: "waiting_parts",
          },
        });

        return NextResponse.json({
          success: true,
          message: `Paused maintenance: ${mo.orderNumber}`,
          data: {
            maintenanceOrderNumber: mo.orderNumber,
            reason,
            pausedAt: new Date().toISOString(),
          },
        });
      }

      case "resume": {
        await prisma.maintenanceOrder.update({
          where: { id: maintenanceId },
          data: { status: "in_progress" },
        });

        return NextResponse.json({
          success: true,
          message: `Resumed maintenance: ${mo.orderNumber}`,
          data: {
            maintenanceOrderNumber: mo.orderNumber,
            resumedAt: new Date().toISOString(),
          },
        });
      }

      case "complete": {
        const { notes, actualDuration } = data || {};

        const startDate = mo.actualStartDate || mo.createdAt;
        const duration =
          actualDuration ||
          (Date.now() - startDate.getTime()) / (1000 * 60 * 60);

        await prisma.maintenanceOrder.update({
          where: { id: maintenanceId },
          data: {
            status: "completed",
            actualEndDate: new Date(),
            actualDuration: duration,
            workPerformed: notes,
          },
        });

        // Update equipment status back to operational
        if (mo.equipmentId) {
          await prisma.equipment.update({
            where: { id: mo.equipmentId },
            data: {
              status: "operational",
              lastMaintenanceDate: new Date(),
            },
          });
        }

        return NextResponse.json({
          success: true,
          message: `Completed maintenance: ${mo.orderNumber}`,
          data: {
            maintenanceOrderNumber: mo.orderNumber,
            completedAt: new Date().toISOString(),
            duration: Math.round(duration * 100) / 100,
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
      context: "/api/mobile/maintenance",
    });
    return NextResponse.json(
      { success: false, error: "Failed to process maintenance operation" },
      { status: 500 },
    );
  }
});
