// ═══════════════════════════════════════════════════════════════════
//                    MOBILE WORK ORDER API
//              Work order operations for shop floor - Production
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
type DbWorkOrderResult = Record<string, any>;

// Helper: Transform work order from database
function transformWorkOrder(wo: DbWorkOrderResult) {
  const operations =
    wo.operations?.map((op: DbWorkOrderResult) => ({
      id: op.id,
      sequence: op.operationNumber,
      name: op.name || `Operation ${op.operationNumber}`,
      status:
        op.status === "completed"
          ? "Completed"
          : op.status === "in_progress"
            ? "In Progress"
            : "Pending",
      plannedHours: op.plannedRunTime || 0,
      actualHours: op.actualRunTime || 0,
    })) || [];

  // Find current operation (first in-progress or first pending)
  const currentOp =
    operations.find((op: DbWorkOrderResult) => op.status === "In Progress") ||
    operations.find((op: DbWorkOrderResult) => op.status === "Pending");

  return {
    id: wo.id,
    woNumber: wo.woNumber,
    partNumber: wo.product?.sku || "",
    partDescription: wo.product?.name || "",
    qty: wo.quantity,
    qtyCompleted: wo.completedQty || 0,
    scrapQty: wo.scrapQty || 0,
    status:
      wo.status === "completed"
        ? "Completed"
        : wo.status === "in_progress"
          ? "In Progress"
          : wo.status === "released"
            ? "Released"
            : "Draft",
    priority:
      wo.priority?.charAt(0).toUpperCase() + wo.priority?.slice(1) || "Normal",
    startDate:
      wo.plannedStart?.toISOString().split("T")[0] ||
      wo.actualStart?.toISOString().split("T")[0],
    dueDate: wo.plannedEnd?.toISOString().split("T")[0],
    workCenter: wo.workCenterRef?.name || wo.workCenter || "",
    currentOperation: currentOp
      ? {
          id: currentOp.id,
          name: currentOp.name,
          sequence: currentOp.sequence,
          status: currentOp.status,
          plannedHours: currentOp.plannedHours,
          actualHours: currentOp.actualHours,
        }
      : null,
    operations,
    salesOrderNumber: wo.salesOrder?.orderNumber,
    notes: wo.notes,
  };
}

/**
 * GET /api/mobile/workorder
 * Get work orders
 */
export const GET = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(req.url);
    const woId = searchParams.get("woId");
    const status = searchParams.get("status") || "released,in_progress";
    const workCenter = searchParams.get("workCenter");

    // Build where clause
    const where: Prisma.WorkOrderWhereInput = {};

    if (woId) {
      where.id = woId;
    }

    // Map status filter
    const statusList = status
      .toLowerCase()
      .split(",")
      .map((s) => s.trim().replace(" ", "_"));
    if (statusList.length > 0) {
      where.status = { in: statusList };
    }

    if (workCenter) {
      where.workCenter = workCenter;
    }

    // Fetch from database
    const workOrders = await prisma.workOrder.findMany({
      where,
      include: {
        product: {
          select: { sku: true, name: true },
        },
        salesOrder: {
          select: { orderNumber: true },
        },
        workCenterRef: {
          select: { name: true, code: true },
        },
        operations: {
          orderBy: { operationNumber: "asc" },
        },
      },
      orderBy: [
        { priority: "desc" },
        { plannedEnd: "asc" },
        { createdAt: "desc" },
      ],
      take: 50,
    });

    // Transform results
    const results = workOrders.map(transformWorkOrder);

    // Sort by priority
    const priorityOrder = { Rush: 0, High: 1, Normal: 2, Low: 3 };
    results.sort((a: DbWorkOrderResult, b: DbWorkOrderResult) => {
      const priorityDiff =
        (priorityOrder[a.priority as keyof typeof priorityOrder] || 99) -
        (priorityOrder[b.priority as keyof typeof priorityOrder] || 99);
      if (priorityDiff !== 0) return priorityDiff;
      if (!a.dueDate || !b.dueDate) return 0;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

    // Calculate summary
    const summary = {
      total: results.length,
      inProgress: results.filter(
        (wo: DbWorkOrderResult) => wo.status === "In Progress",
      ).length,
      released: results.filter(
        (wo: DbWorkOrderResult) => wo.status === "Released",
      ).length,
      rushOrders: results.filter(
        (wo: DbWorkOrderResult) => wo.priority === "Rush",
      ).length,
      behindSchedule: results.filter(
        (wo: DbWorkOrderResult) =>
          wo.dueDate && new Date(wo.dueDate) < new Date(),
      ).length,
      completed: results.filter(
        (wo: DbWorkOrderResult) => wo.status === "Completed",
      ).length,
    };

    return NextResponse.json({
      success: true,
      data: results,
      summary,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/mobile/workorder",
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch work orders" },
      { status: 500 },
    );
  }
});

/**
 * POST /api/mobile/workorder
 * Work order operations
 */
export const POST = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const bodySchema = z.object({
      action: z.string(),
      woId: z.string(),
      operationId: z.string().optional(),
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
    const { action, woId, operationId, data } = body;

    if (!woId || !action) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: woId, action" },
        { status: 400 },
      );
    }

    const wo = await prisma.workOrder.findUnique({
      where: { id: woId },
      include: {
        product: { select: { sku: true, name: true } },
        operations: { orderBy: { operationNumber: "asc" } },
      },
    });

    if (!wo) {
      return NextResponse.json(
        { success: false, error: "Work order not found" },
        { status: 404 },
      );
    }

    switch (action) {
      case "start_operation": {
        if (!operationId) {
          return NextResponse.json(
            { success: false, error: "Operation ID required" },
            { status: 400 },
          );
        }

        const operation = wo.operations.find((op) => op.id === operationId);
        if (!operation) {
          return NextResponse.json(
            { success: false, error: "Operation not found" },
            { status: 404 },
          );
        }

        // Update operation status
        await prisma.workOrderOperation.update({
          where: { id: operationId },
          data: {
            status: "in_progress",
            actualStartDate: new Date(),
          },
        });

        // Update work order status if needed
        if (wo.status === "released") {
          await prisma.workOrder.update({
            where: { id: woId },
            data: {
              status: "in_progress",
              actualStart: wo.actualStart || new Date(),
            },
          });
        }

        return NextResponse.json({
          success: true,
          message: `Started operation: ${operation.name}`,
          data: {
            woNumber: wo.woNumber,
            operationName: operation.name,
            startedAt: new Date().toISOString(),
          },
        });
      }

      case "complete_operation": {
        if (!operationId) {
          return NextResponse.json(
            { success: false, error: "Operation ID required" },
            { status: 400 },
          );
        }

        const operation = wo.operations.find((op) => op.id === operationId);
        if (!operation) {
          return NextResponse.json(
            { success: false, error: "Operation not found" },
            { status: 404 },
          );
        }

        const { qtyCompleted, qtyScrap, actualHours, notes } = data || {};

        await prisma.workOrderOperation.update({
          where: { id: operationId },
          data: {
            status: "completed",
            actualEndDate: new Date(),
            actualRunTime: actualHours || operation.actualRunTime,
            notes: notes,
          },
        });

        return NextResponse.json({
          success: true,
          message: `Completed operation: ${operation.name}`,
          data: {
            woNumber: wo.woNumber,
            operationName: operation.name,
            qtyCompleted: qtyCompleted || 0,
            qtyScrap: qtyScrap || 0,
            actualHours: actualHours || operation.actualRunTime,
            completedAt: new Date().toISOString(),
          },
        });
      }

      case "record_production": {
        const { qtyGood, qtyScrap, notes } = data || {};

        if (qtyGood === undefined) {
          return NextResponse.json(
            { success: false, error: "Quantity required" },
            { status: 400 },
          );
        }

        const newCompleted = wo.completedQty + qtyGood;
        const newScrap = wo.scrapQty + (qtyScrap || 0);

        if (newCompleted + newScrap > wo.quantity) {
          return NextResponse.json(
            {
              success: false,
              error: `Total would exceed WO quantity (${wo.quantity})`,
            },
            { status: 400 },
          );
        }

        const isComplete = newCompleted >= wo.quantity;

        await prisma.workOrder.update({
          where: { id: woId },
          data: {
            completedQty: newCompleted,
            scrapQty: newScrap,
            status: isComplete ? "completed" : "in_progress",
            actualEnd: isComplete ? new Date() : undefined,
            notes: notes
              ? wo.notes
                ? `${wo.notes}\n${notes}`
                : notes
              : wo.notes,
          },
        });

        return NextResponse.json({
          success: true,
          message: `Recorded production: ${qtyGood} good, ${qtyScrap || 0} scrap`,
          data: {
            woNumber: wo.woNumber,
            qtyGood,
            qtyScrap: qtyScrap || 0,
            newTotalCompleted: newCompleted,
            remaining: wo.quantity - newCompleted,
            isComplete,
            recordedAt: new Date().toISOString(),
          },
        });
      }

      case "report_issue": {
        const { issueType, description, severity } = data || {};

        if (!issueType || !description) {
          return NextResponse.json(
            { success: false, error: "Issue type and description required" },
            { status: 400 },
          );
        }

        // Create NCR if this is a quality issue
        let ncrId = null;
        if (issueType === "quality") {
          const ncr = await prisma.nCR.create({
            data: {
              ncrNumber: `NCR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now().toString().slice(-4)}`,
              workOrderId: woId,
              productId: wo.productId,
              title: `Quality Issue - ${wo.woNumber}`,
              description,
              priority: severity?.toLowerCase() || "medium",
              source: "IN_PROCESS",
              quantityAffected: 1,
              status: "open",
              createdBy: data?.userId || "system",
            },
          });
          ncrId = ncr.id;
        }

        // Add note to work order
        await prisma.workOrder.update({
          where: { id: woId },
          data: {
            notes: wo.notes
              ? `${wo.notes}\n[${severity || "Medium"}] ${issueType}: ${description}`
              : `[${severity || "Medium"}] ${issueType}: ${description}`,
          },
        });

        return NextResponse.json({
          success: true,
          ncrId,
          message: "Issue reported successfully",
          data: {
            woNumber: wo.woNumber,
            issueType,
            severity: severity || "Medium",
            description,
            reportedAt: new Date().toISOString(),
          },
        });
      }

      case "clock_in": {
        const { userId, operationId: opId } = data || {};

        // Get the first operation if no operation specified
        const targetOp = opId
          ? wo.operations.find((op) => op.id === opId)
          : wo.operations[0];

        if (!targetOp) {
          return NextResponse.json(
            { success: false, error: "No operation found for work order" },
            { status: 400 },
          );
        }

        // Create labor entry
        await prisma.laborEntry.create({
          data: {
            workOrderOperationId: targetOp.id,
            userId: userId || "system",
            startTime: new Date(),
            type: "DIRECT",
          },
        });

        return NextResponse.json({
          success: true,
          message: `Clocked in to WO ${wo.woNumber}`,
          data: {
            woNumber: wo.woNumber,
            clockedInAt: new Date().toISOString(),
          },
        });
      }

      case "clock_out": {
        const { userId, hoursWorked } = data || {};

        // Find and update the latest open labor entry for any operation in this WO
        const operationIds = wo.operations.map((op) => op.id);
        const laborEntry = await prisma.laborEntry.findFirst({
          where: {
            workOrderOperationId: { in: operationIds },
            userId: userId || "system",
            endTime: null,
          },
          orderBy: { startTime: "desc" },
        });

        if (laborEntry) {
          const startTime = new Date(laborEntry.startTime);
          const endTime = new Date();
          const durationMinutes =
            (endTime.getTime() - startTime.getTime()) / (1000 * 60);

          await prisma.laborEntry.update({
            where: { id: laborEntry.id },
            data: {
              endTime: endTime,
              durationMinutes: hoursWorked ? hoursWorked * 60 : durationMinutes,
            },
          });
        }

        return NextResponse.json({
          success: true,
          message: `Clocked out from WO ${wo.woNumber}`,
          data: {
            woNumber: wo.woNumber,
            hoursWorked: hoursWorked || 0,
            clockedOutAt: new Date().toISOString(),
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
      context: "/api/mobile/workorder",
    });
    return NextResponse.json(
      { success: false, error: "Failed to process work order operation" },
      { status: 500 },
    );
  }
});
