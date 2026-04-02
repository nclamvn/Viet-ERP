/**
 * Workflow API Routes
 * GET - List workflow definitions and instances
 * POST - Start a new workflow instance
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { workflowEngine } from "@/lib/workflow";
import { WorkflowEntityType, WorkflowStatus } from ".prisma/mrp-client";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/api/with-auth";

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
// GET /api/workflows - List workflows
export const GET = withAuth(async (request: NextRequest, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // 'definitions' or 'instances'
    const entityType = searchParams.get(
      "entityType",
    ) as WorkflowEntityType | null;
    const status = searchParams.get("status");
    const userId = searchParams.get("userId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    if (type === "definitions") {
      // List workflow definitions
      const definitions = await prisma.workflowDefinition.findMany({
        where: {
          isActive: true,
          ...(entityType ? { entityType } : {}),
        },
        include: {
          steps: {
            orderBy: { stepNumber: "asc" },
          },
          _count: {
            select: { instances: true },
          },
        },
        orderBy: { name: "asc" },
      });

      return NextResponse.json({ definitions });
    }

    // List workflow instances
    const where = {
      ...(entityType ? { entityType } : {}),
      ...(status ? { status: status as WorkflowStatus } : {}),
      ...(userId ? { initiatedBy: userId } : {}),
    };

    const [instances, total] = await Promise.all([
      prisma.workflowInstance.findMany({
        where,
        include: {
          workflow: { select: { name: true, code: true } },
          initiatedByUser: { select: { id: true, name: true, email: true } },
          _count: {
            select: { approvals: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.workflowInstance.count({ where }),
    ]);

    return NextResponse.json({
      instances,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/workflows",
    });
    return NextResponse.json(
      { error: "Failed to fetch workflows" },
      { status: 500 },
    );
  }
});

// POST /api/workflows - Start a new workflow
export const POST = withAuth(async (request: NextRequest, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const bodySchema = z.object({
      workflowCode: z.string(),
      entityType: z.string(),
      entityId: z.string(),
      initiatedBy: z.string(),
      contextData: z.record(z.string(), z.unknown()).optional(),
    });

    const rawBody = await request.json();
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
    const { workflowCode, entityType, entityId, initiatedBy, contextData } =
      body;

    if (!workflowCode || !entityType || !entityId || !initiatedBy) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: workflowCode, entityType, entityId, initiatedBy",
        },
        { status: 400 },
      );
    }

    // Validate entity type
    const validEntityTypes = [
      "PURCHASE_ORDER",
      "SALES_ORDER",
      "WORK_ORDER",
      "NCR",
      "CAPA",
      "INVENTORY_ADJUSTMENT",
      "ENGINEERING_CHANGE",
    ];

    if (!validEntityTypes.includes(entityType)) {
      return NextResponse.json(
        {
          error: `Invalid entityType. Must be one of: ${validEntityTypes.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const result = await workflowEngine.startWorkflow({
      workflowCode,
      entityType: entityType as WorkflowEntityType,
      entityId,
      initiatedBy,
      contextData,
    });

    if (!result.success) {
      logger.logError(new Error(result.error || "Workflow start failed"), {
        context: "POST /api/workflows",
        workflowCode,
        entityType,
        entityId,
      });
      return NextResponse.json(
        {
          error:
            "Failed to start workflow. Please check the workflow configuration and try again.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      instanceId: result.instanceId,
      status: result.status,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "POST /api/workflows",
    });
    return NextResponse.json(
      { error: "Failed to start workflow" },
      { status: 500 },
    );
  }
});
