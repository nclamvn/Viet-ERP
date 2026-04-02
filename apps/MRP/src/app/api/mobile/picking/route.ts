// ═══════════════════════════════════════════════════════════════════
//                    MOBILE PICKING API
//              Sales order picking operations - Production
// ═══════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/api/with-auth";

const pickingPostSchema = z.object({
  pickId: z.string().min(1, "pickId là bắt buộc"),
  itemId: z.string().min(1, "itemId là bắt buộc"),
  qtyPicked: z.number().positive("Số lượng phải lớn hơn 0"),
  location: z.string().optional(),
  serialNumbers: z.array(z.string()).optional(),
  lotNumber: z.string().optional(),
  userId: z.string().optional(),
});

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbPickListResult = Record<string, any>;

// Helper: Map numeric priority to string
function getPriorityLabel(priority: number): string {
  if (priority <= 2) return "Rush";
  if (priority <= 4) return "High";
  if (priority <= 6) return "Normal";
  return "Low";
}

// Helper: Transform pick list from database
function transformPickList(pickList: DbPickListResult) {
  return {
    id: pickList.id,
    pickNumber: pickList.pickListNumber,
    soNumber: pickList.sourceType === "SALES_ORDER" ? pickList.sourceId : "",
    customer: "", // Would need additional query to get customer
    status:
      pickList.status === "COMPLETED"
        ? "Completed"
        : pickList.status === "IN_PROGRESS"
          ? "In Progress"
          : "Pending",
    priority: getPriorityLabel(pickList.priority || 5),
    dueDate: pickList.dueDate?.toISOString().split("T")[0] || null,
    items:
      pickList.lines?.map((line: DbPickListResult) => ({
        id: line.id,
        partNumber: line.part?.partNumber || "",
        description: line.part?.name || "",
        qtyToPick: Number(line.requestedQty) || 0,
        qtyPicked: Number(line.pickedQty) || 0,
        location: line.locationCode || line.warehouse?.code || "",
        binQty: 0, // Would need inventory query
      })) || [],
  };
}

/**
 * GET /api/mobile/picking
 * Get pick lists
 */
export const GET = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(req.url);
    const pickId = searchParams.get("pickId");
    const status = searchParams.get("status") || "pending,in_progress";

    // Build where clause
    const where: Prisma.PickListWhereInput = {};

    if (pickId) {
      where.id = pickId;
    }

    // Map status filter to uppercase as stored in DB
    const statusList = status
      .toUpperCase()
      .split(",")
      .map((s) => s.trim().replace(" ", "_"));
    if (statusList.length > 0) {
      where.status = { in: statusList };
    }

    // Fetch from database
    const pickLists = await prisma.pickList.findMany({
      where,
      include: {
        lines: {
          include: {
            part: { select: { partNumber: true, name: true } },
            warehouse: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: [
        { priority: "asc" }, // 1 = highest priority
        { dueDate: "asc" },
        { createdAt: "desc" },
      ],
      take: 50,
    });

    // Transform results
    const results = pickLists.map(transformPickList);

    // Sort by priority
    const priorityOrder = { Rush: 0, High: 1, Normal: 2, Low: 3 };
    results.sort(
      (a: DbPickListResult, b: DbPickListResult) =>
        (priorityOrder[a.priority as keyof typeof priorityOrder] || 99) -
        (priorityOrder[b.priority as keyof typeof priorityOrder] || 99),
    );

    // Calculate summary
    interface PickItem {
      qtyPicked: number;
      qtyToPick: number;
    }
    const summary = {
      totalPicks: results.length,
      rushPicks: results.filter((p: DbPickListResult) => p.priority === "Rush")
        .length,
      totalItems: results.reduce(
        (sum: number, pick: DbPickListResult) =>
          sum + (pick.items as PickItem[]).length,
        0,
      ),
      itemsPending: results.reduce(
        (sum: number, pick: DbPickListResult) =>
          sum +
          (pick.items as PickItem[]).filter(
            (i: PickItem) => i.qtyPicked < i.qtyToPick,
          ).length,
        0,
      ),
    };

    return NextResponse.json({
      success: true,
      data: results,
      summary,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/mobile/picking",
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch pick lists" },
      { status: 500 },
    );
  }
});

/**
 * POST /api/mobile/picking
 * Process pick confirmation
 */
export const POST = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await req.json();
    const parsed = pickingPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Dữ liệu không hợp lệ",
          errors: parsed.error.issues,
        },
        { status: 400 },
      );
    }
    const {
      pickId,
      itemId,
      qtyPicked,
      location,
      serialNumbers,
      lotNumber,
      userId,
    } = parsed.data;

    // Find the pick list line
    const pickLine = await prisma.pickListLine.findUnique({
      where: { id: itemId },
      include: {
        pickList: true,
        part: { select: { partNumber: true, name: true } },
        warehouse: { select: { code: true } },
      },
    });

    if (!pickLine || pickLine.pickListId !== pickId) {
      return NextResponse.json(
        { success: false, error: "Pick item not found" },
        { status: 404 },
      );
    }

    // Check remaining to pick
    const currentPicked = Number(pickLine.pickedQty) || 0;
    const requestedQty = Number(pickLine.requestedQty) || 0;
    const remaining = requestedQty - currentPicked;

    if (qtyPicked > remaining) {
      return NextResponse.json(
        { success: false, error: `Quantity exceeds remaining (${remaining})` },
        { status: 400 },
      );
    }

    // Update pick line
    const newQtyPicked = currentPicked + qtyPicked;
    const isItemComplete = newQtyPicked >= requestedQty;

    await prisma.pickListLine.update({
      where: { id: itemId },
      data: {
        pickedQty: newQtyPicked,
        pickedAt: new Date(),
        pickedBy: userId,
        lotNumber: lotNumber || pickLine.lotNumber,
      },
    });

    // Check if all items are complete and update pick list status
    const allLines = await prisma.pickListLine.findMany({
      where: { pickListId: pickId },
    });

    const allComplete = allLines.every(
      (line) =>
        (line.id === itemId ? newQtyPicked : Number(line.pickedQty) || 0) >=
        Number(line.requestedQty),
    );

    if (allComplete) {
      await prisma.pickList.update({
        where: { id: pickId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    } else if (pickLine.pickList.status === "PENDING") {
      await prisma.pickList.update({
        where: { id: pickId },
        data: { status: "IN_PROGRESS", startedAt: new Date() },
      });
    }

    return NextResponse.json({
      success: true,
      transactionId: `PICK-${Date.now()}`,
      message: `Picked ${qtyPicked} units of ${pickLine.part?.partNumber || "item"}`,
      data: {
        pickNumber: pickLine.pickList.pickListNumber,
        partNumber: pickLine.part?.partNumber,
        qtyPicked,
        location: location || pickLine.locationCode,
        newTotalPicked: newQtyPicked,
        remainingToPick: requestedQty - newQtyPicked,
        itemComplete: isItemComplete,
        allComplete,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/mobile/picking",
    });
    return NextResponse.json(
      { success: false, error: "Failed to process pick" },
      { status: 500 },
    );
  }
});

/**
 * PATCH /api/mobile/picking
 * Complete pick list
 */
export const PATCH = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await req.json();
    const { pickId, action, forceComplete } = body;

    if (!pickId || !action) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 },
      );
    }

    const pickList = await prisma.pickList.findUnique({
      where: { id: pickId },
      include: {
        lines: {
          include: {
            part: { select: { partNumber: true } },
          },
        },
      },
    });

    if (!pickList) {
      return NextResponse.json(
        { success: false, error: "Pick list not found" },
        { status: 404 },
      );
    }

    if (action === "complete") {
      // Check if all items are picked
      const incomplete = pickList.lines.filter(
        (line) => (Number(line.pickedQty) || 0) < Number(line.requestedQty),
      );

      if (incomplete.length > 0 && !forceComplete) {
        return NextResponse.json(
          {
            success: false,
            error: `${incomplete.length} items not fully picked`,
            incompleteItems: incomplete.map((line) => ({
              partNumber: line.part?.partNumber || "Unknown",
              remaining:
                Number(line.requestedQty) - (Number(line.pickedQty) || 0),
            })),
          },
          { status: 400 },
        );
      }

      // Complete the pick list
      await prisma.pickList.update({
        where: { id: pickId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        message: "Pick list completed",
        data: {
          pickNumber: pickList.pickListNumber,
          status: "Completed",
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (action === "cancel") {
      await prisma.pickList.update({
        where: { id: pickId },
        data: { status: "CANCELLED" },
      });

      return NextResponse.json({
        success: true,
        message: "Pick list cancelled",
        data: {
          pickNumber: pickList.pickListNumber,
          status: "Cancelled",
          timestamp: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json(
      { success: false, error: "Invalid action" },
      { status: 400 },
    );
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/mobile/picking",
    });
    return NextResponse.json(
      { success: false, error: "Failed to update pick list" },
      { status: 500 },
    );
  }
});
