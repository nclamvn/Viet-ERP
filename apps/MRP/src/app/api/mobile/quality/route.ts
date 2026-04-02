// ═══════════════════════════════════════════════════════════════════
//                    MOBILE QUALITY API
//              Quality inspection operations - Production
// ═══════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/api/with-auth";

const qualityPostSchema = z.object({
  inspectionId: z.string().min(1, "Inspection ID là bắt buộc"),
  checkpointId: z.string().optional(),
  result: z.string().optional(),
  value: z.string().optional(),
  notes: z.string().optional(),
  qtyPassed: z.number().int().min(0).optional(),
  qtyFailed: z.number().int().min(0).optional(),
  disposition: z.string().optional(),
  userId: z.string().optional(),
});

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbInspectionResult = Record<string, any>;

// Helper function to transform inspection data
function transformInspection(inspection: DbInspectionResult) {
  // Get characteristics from plan if available
  const characteristics =
    inspection.plan?.characteristics?.map((char: DbInspectionResult) => ({
      id: char.id,
      name: char.name,
      description: char.description,
      type: char.type,
      specification: char.specification,
      isCritical: char.isCritical,
      isMajor: char.isMajor,
    })) || [];

  // Map results to characteristics
  const resultsByChar: Record<
    string,
    { result: string; measuredValue: number | null; findings: string | null }
  > = {};
  inspection.results?.forEach((r: DbInspectionResult) => {
    resultsByChar[r.characteristicId] = {
      result: r.result,
      measuredValue: r.measuredValue,
      findings: r.findings,
    };
  });

  return {
    id: inspection.id,
    inspectionNumber: inspection.inspectionNumber,
    type: inspection.type || "RECEIVING",
    source: inspection.workOrder?.woNumber || "Manual",
    partNumber: inspection.part?.partNumber || inspection.product?.sku || "",
    partDescription: inspection.part?.name || inspection.product?.name || "",
    lotNumber: inspection.lotNumber,
    qtyToInspect: inspection.quantityReceived || 0,
    qtyInspected: inspection.quantityInspected || 0,
    status:
      inspection.status === "completed"
        ? "Completed"
        : inspection.status === "in_progress"
          ? "In Progress"
          : "Pending",
    priority: "Normal", // No priority field in schema
    createdAt: inspection.createdAt.toISOString(),
    dueDate: null, // No dueDate field in schema
    characteristics,
    characteristicResults: resultsByChar,
    result: inspection.result,
    notes: inspection.notes,
  };
}

/**
 * GET /api/mobile/quality
 * Get pending inspections
 */
export const GET = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(req.url);
    const inspectionId = searchParams.get("inspectionId");
    const status = searchParams.get("status") || "pending,in_progress";
    const type = searchParams.get("type");

    // Build where clause
    const where: Prisma.InspectionWhereInput = {};

    if (inspectionId) {
      where.id = inspectionId;
    }

    // Map status filter
    const statusList = status
      .toLowerCase()
      .split(",")
      .map((s) => s.trim().replace(" ", "_"));
    if (statusList.length > 0) {
      where.status = { in: statusList };
    }

    if (type) {
      where.type = type.toLowerCase();
    }

    // Fetch from database
    const inspections = await prisma.inspection.findMany({
      where,
      include: {
        part: {
          select: { partNumber: true, name: true },
        },
        product: {
          select: { sku: true, name: true },
        },
        workOrder: {
          select: { woNumber: true },
        },
        plan: {
          include: {
            characteristics: {
              orderBy: { sequence: "asc" },
            },
          },
        },
        results: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 50,
    });

    // Transform results
    const results = inspections.map(transformInspection);

    // Calculate summary
    const summary = {
      total: results.length,
      pending: results.filter((i) => i.status === "Pending").length,
      inProgress: results.filter((i) => i.status === "In Progress").length,
      rushItems: results.filter(
        (i) => i.priority === "Rush" || i.priority === "High",
      ).length,
    };

    return NextResponse.json({
      success: true,
      data: results,
      summary,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/mobile/quality",
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch inspections" },
      { status: 500 },
    );
  }
});

/**
 * POST /api/mobile/quality
 * Submit inspection result
 */
export const POST = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await req.json();
    const parsed = qualityPostSchema.safeParse(body);
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
      inspectionId,
      checkpointId,
      result,
      value,
      notes,
      qtyPassed,
      qtyFailed,
      disposition,
      userId,
    } = parsed.data;

    // Find the inspection
    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        part: { select: { partNumber: true, name: true } },
        product: { select: { sku: true, name: true } },
        plan: {
          include: {
            characteristics: true,
          },
        },
        results: true,
      },
    });

    if (!inspection) {
      return NextResponse.json(
        { success: false, error: "Inspection not found" },
        { status: 404 },
      );
    }

    // Handle characteristic result (checkpointId is characteristicId)
    if (checkpointId && result) {
      const upperResult = result.toUpperCase();
      if (!["PASS", "FAIL", "N/A"].includes(upperResult)) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid result. Must be PASS, FAIL, or N/A",
          },
          { status: 400 },
        );
      }

      // Upsert inspection result for this characteristic
      await prisma.inspectionResult.upsert({
        where: {
          inspectionId_characteristicId: {
            inspectionId,
            characteristicId: checkpointId,
          },
        },
        create: {
          inspectionId,
          characteristicId: checkpointId,
          result: upperResult,
          measuredValue: value ? parseFloat(value) : null,
          findings: notes,
          inspectedBy: userId || "system",
        },
        update: {
          result: upperResult,
          measuredValue: value ? parseFloat(value) : null,
          findings: notes,
          inspectedBy: userId || "system",
          inspectedAt: new Date(),
        },
      });

      // Update inspection status to in_progress if pending
      if (inspection.status === "pending") {
        await prisma.inspection.update({
          where: { id: inspectionId },
          data: { status: "in_progress" },
        });
      }

      return NextResponse.json({
        success: true,
        message: `Characteristic recorded as ${upperResult}`,
        data: {
          inspectionId,
          characteristicId: checkpointId,
          result: upperResult,
          value,
          notes,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Handle inspection quantity recording
    if (qtyPassed !== undefined) {
      const totalInspected = qtyPassed + (qtyFailed || 0);
      const currentInspected = inspection.quantityInspected || 0;
      const qtyToInspect = inspection.quantityReceived || 0;

      if (
        qtyToInspect > 0 &&
        totalInspected > qtyToInspect - currentInspected
      ) {
        return NextResponse.json(
          { success: false, error: "Quantity exceeds remaining to inspect" },
          { status: 400 },
        );
      }

      const newInspectedQty = currentInspected + totalInspected;
      const newAccepted = (inspection.quantityAccepted || 0) + qtyPassed;
      const newRejected = (inspection.quantityRejected || 0) + (qtyFailed || 0);
      const isComplete = qtyToInspect > 0 && newInspectedQty >= qtyToInspect;

      // Update inspection
      await prisma.inspection.update({
        where: { id: inspectionId },
        data: {
          quantityInspected: newInspectedQty,
          quantityAccepted: newAccepted,
          quantityRejected: newRejected,
          status: isComplete ? "completed" : "in_progress",
          result: isComplete ? (newRejected > 0 ? "FAIL" : "PASS") : undefined,
          notes: notes || inspection.notes,
          inspectedAt: isComplete ? new Date() : undefined,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Inspection recorded: ${qtyPassed} passed, ${qtyFailed || 0} failed`,
        data: {
          inspectionId,
          qtyPassed,
          qtyFailed: qtyFailed || 0,
          disposition,
          newTotalInspected: newInspectedQty,
          remaining: qtyToInspect > 0 ? qtyToInspect - newInspectedQty : 0,
          isComplete,
          timestamp: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid request - provide checkpointId with result or qtyPassed",
      },
      { status: 400 },
    );
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/mobile/quality",
    });
    return NextResponse.json(
      { success: false, error: "Failed to process inspection" },
      { status: 500 },
    );
  }
});

/**
 * PATCH /api/mobile/quality
 * Complete inspection
 */
export const PATCH = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await req.json();
    const { inspectionId, action, finalDisposition, notes } = body;

    if (!inspectionId || !action) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 },
      );
    }

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: {
        plan: {
          include: {
            characteristics: true,
          },
        },
        results: true,
      },
    });

    if (!inspection) {
      return NextResponse.json(
        { success: false, error: "Inspection not found" },
        { status: 404 },
      );
    }

    if (action === "complete") {
      // Check if inspection can be completed
      const characteristics = inspection.plan?.characteristics || [];
      const recordedResults = inspection.results || [];
      const recordedCharIds = new Set(
        recordedResults.map((r) => r.characteristicId),
      );

      // Check for critical/major characteristics that haven't been inspected
      const incompleteCharacteristics = characteristics.filter(
        (char: {
          isCritical: boolean;
          isMajor: boolean;
          id: string;
          name: string;
        }) =>
          (char.isCritical || char.isMajor) && !recordedCharIds.has(char.id),
      );

      if (incompleteCharacteristics.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `${incompleteCharacteristics.length} required characteristics incomplete`,
            incompleteCheckpoints: incompleteCharacteristics.map(
              (c: { name: string }) => c.name,
            ),
          },
          { status: 400 },
        );
      }

      // Determine final result
      const hasFailures = recordedResults.some(
        (r: { result: string }) => r.result === "FAIL",
      );
      const finalResult = hasFailures ? "FAIL" : "PASS";

      // Update inspection
      await prisma.inspection.update({
        where: { id: inspectionId },
        data: {
          status: "completed",
          result: finalResult,
          notes: notes
            ? inspection.notes
              ? `${inspection.notes}\nDisposition: ${finalDisposition}`
              : `Disposition: ${finalDisposition}`
            : inspection.notes,
          inspectedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        message: "Inspection completed",
        data: {
          inspectionId,
          status: "Completed",
          result: finalResult,
          finalDisposition,
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
      context: "/api/mobile/quality",
    });
    return NextResponse.json(
      { success: false, error: "Failed to update inspection" },
      { status: 500 },
    );
  }
});
