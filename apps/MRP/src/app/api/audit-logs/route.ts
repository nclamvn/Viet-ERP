// =============================================================================
// AUDIT LOG API
// Fetch audit logs for the AI Copilot audit log viewer
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api/with-auth";
import { logger } from "@/lib/logger";

import { checkReadEndpointLimit } from "@/lib/rate-limit";
/**
 * GET /api/audit-logs
 * Fetch audit logs with optional filters
 *
 * Query params:
 *   - userId: filter by user ID
 *   - startDate: ISO date string for range start
 *   - endDate: ISO date string for range end
 *   - module: filter by entity type (maps to entityType)
 *   - page: page number (default 1)
 *   - limit: items per page (default 50)
 *   - search: search in entityName, action, or metadata
 */
export const GET = withAuth(async (req, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(req);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const moduleFilter = searchParams.get("module");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    // Build where clause
    const where: Prisma.AuditLogWhereInput = {};

    if (userId) {
      where.userId = userId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (moduleFilter && moduleFilter !== "all") {
      // Map module names to entity types
      const moduleEntityMap: Record<string, string[]> = {
        inventory: ["Inventory", "Part", "Warehouse"],
        sales: ["SalesOrder", "SalesOrderLine", "Customer"],
        procurement: [
          "PurchaseOrder",
          "PurchaseOrderLine",
          "Supplier",
          "PurchaseInvoice",
        ],
        production: ["WorkOrder", "MaterialAllocation", "ProductionReceipt"],
        quality: ["NCR", "CAPA", "Inspection", "InspectionResult"],
      };
      const entityTypes = moduleEntityMap[moduleFilter];
      if (entityTypes) {
        where.entityType = { in: entityTypes };
      }
    }

    if (search) {
      where.OR = [
        { entityName: { contains: search, mode: "insensitive" } },
        { action: { contains: search, mode: "insensitive" } },
        { entityType: { contains: search, mode: "insensitive" } },
      ];
    }

    // Fetch audit logs with user info
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Look up user names for the log entries
    const userIds = [...new Set(logs.map((l) => l.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, role: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Map to the format expected by the AuditLogViewer component
    const mappedLogs = logs.map((log) => {
      const user = userMap.get(log.userId);
      const metadata = (log.metadata as Record<string, any>) || {};

      // Determine module from entityType
      let logModule = "other";
      const entityType = log.entityType.toLowerCase();
      if (["inventory", "part", "warehouse"].includes(entityType))
        logModule = "inventory";
      else if (
        ["salesorder", "salesorderline", "customer"].includes(entityType)
      )
        logModule = "sales";
      else if (
        [
          "purchaseorder",
          "purchaseorderline",
          "supplier",
          "purchaseinvoice",
        ].includes(entityType)
      )
        logModule = "procurement";
      else if (
        ["workorder", "materialallocation", "productionreceipt"].includes(
          entityType,
        )
      )
        logModule = "production";
      else if (
        ["ncr", "capa", "inspection", "inspectionresult"].includes(entityType)
      )
        logModule = "quality";

      return {
        id: log.id,
        timestamp: log.createdAt.toISOString(),
        userId: log.userId,
        userName: user?.name || user?.email || "Unknown User",
        userRole: user?.role || metadata.userRole || "user",
        sessionId: metadata.sessionId || log.id,
        input: {
          type: "action" as const,
          content: `${log.action} ${log.entityType}: ${log.entityName || log.entityId}`,
          context: {
            page: log.entityType,
            module: logModule,
          },
        },
        processing: {
          intent: `${log.action.toLowerCase()}_${log.entityType.toLowerCase()}`,
          agent: `${logModule}_agent`,
          tokensUsed: 0,
          latencyMs: 0,
        },
        output: {
          confidence: 1.0,
          suggestedActions: [],
          responseLength: 0,
          hadWarnings: false,
        },
        userAction: log.action === "DELETE" ? ("approved" as const) : undefined,
        feedback: undefined,
        metadata: {
          entityType: log.entityType,
          entityId: log.entityId,
          entityName: log.entityName,
          action: log.action,
          oldValues: log.oldValues,
          newValues: log.newValues,
          ipAddress: log.ipAddress,
        },
      };
    });

    return NextResponse.json({
      success: true,
      data: mappedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/audit-logs",
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch audit logs" },
      { status: 500 },
    );
  }
});
