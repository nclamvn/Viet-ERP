import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import prisma from "@/lib/prisma";
import { updateWorkOrderStatus } from "@/lib/mrp-engine";
import { withAuth, type AuthUser } from "@/lib/auth/middleware";
import {
  handleError,
  NotFoundError,
  paginatedResponse,
  successResponse,
} from "@/lib/error-handler";
import { logger } from "@/lib/logger";
import {
  WorkOrderUpdateSchema,
  validateRequest,
} from "@/lib/validation/schemas";
import {
  auditUpdate,
  auditStatusChange,
  auditDelete,
} from "@/lib/audit/route-audit";
import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";

// GET - Get work order details (requires authentication + permission)
export const GET = withAuth(
  async (
    request: NextRequest,
    { params, user }: { params: { id: string }; user: AuthUser },
  ) => {
    // Rate limiting
    const rateLimitResult = await checkReadEndpointLimit(request);
    if (rateLimitResult) return rateLimitResult;

    try {
      const { id } = await params;

      logger.info("Fetching work order", { workOrderId: id, userId: user.id });

      const workOrder = await prisma.workOrder.findUnique({
        where: { id },
        include: {
          product: true,
          salesOrder: {
            include: { customer: true },
          },
          allocations: {
            include: { part: true },
          },
          productionReceipt: true,
        },
      });

      if (!workOrder) {
        throw new NotFoundError("Work order", id);
      }

      // Backward-compat: if no ProductionReceipt but has legacy LotTransaction PRODUCED
      const responseData: Record<string, unknown> = { ...workOrder };
      if (!workOrder.productionReceipt) {
        const legacyTx = await prisma.lotTransaction.findFirst({
          where: { transactionType: "PRODUCED", workOrderId: id },
        });
        if (legacyTx) {
          responseData.productionReceipt = {
            id: legacyTx.id,
            receiptNumber: `LEGACY-${legacyTx.lotNumber}`,
            quantity: legacyTx.quantity,
            lotNumber: legacyTx.lotNumber,
            status: "CONFIRMED",
            requestedAt: legacyTx.createdAt,
            confirmedAt: legacyTx.createdAt,
            rejectedAt: null,
            rejectedReason: null,
          };
        }
      }

      logger.audit("read", "workOrder", id, { userId: user.id });

      return successResponse(responseData);
    } catch (error) {
      return handleError(error);
    }
  },
  { permission: "production:read" },
);

// PATCH - Update work order (requires authentication + write permission)
export const PATCH = withAuth(
  async (
    request: NextRequest,
    { params, user }: { params: { id: string }; user: AuthUser },
  ) => {
    // Rate limiting
    const rlResult = await checkWriteEndpointLimit(request);
    if (rlResult) return rlResult;

    try {
      const { id } = await params;
      const body = await request.json();

      // Validate input
      const validation = validateRequest(WorkOrderUpdateSchema, {
        ...body,
        id,
      });
      if (!validation.success) {
        return validation.error;
      }

      const {
        status,
        completedQty,
        scrapQty,
        plannedStart,
        plannedEnd,
        ...updateData
      } = validation.data;

      logger.info("Updating work order", {
        workOrderId: id,
        userId: user.id,
        status,
      });

      // Optimistic locking: check if record was modified since client last read it
      if (body.expectedUpdatedAt) {
        const existing = await prisma.workOrder.findUnique({
          where: { id },
          select: { updatedAt: true },
        });
        if (existing) {
          const expectedDate = new Date(body.expectedUpdatedAt);
          if (existing.updatedAt.getTime() !== expectedDate.getTime()) {
            return NextResponse.json(
              {
                success: false,
                error:
                  "Dữ liệu đã bị thay đổi bởi người dùng khác. Vui lòng tải lại và thử lại.",
              },
              { status: 409 },
            );
          }
        }
      }

      let workOrder;

      if (status) {
        workOrder = await updateWorkOrderStatus(
          id,
          status,
          completedQty,
          scrapQty,
        );
      } else {
        const data: Prisma.WorkOrderUpdateInput = { ...updateData };
        if (completedQty !== undefined) data.completedQty = completedQty;
        if (scrapQty !== undefined) data.scrapQty = scrapQty;
        if (plannedStart !== undefined)
          data.plannedStart = plannedStart ? new Date(plannedStart) : null;
        if (plannedEnd !== undefined)
          data.plannedEnd = plannedEnd ? new Date(plannedEnd) : null;

        workOrder = await prisma.workOrder.update({
          where: { id },
          data,
          include: {
            product: true,
            allocations: { include: { part: true } },
          },
        });
      }

      logger.audit("update", "workOrder", id, { userId: user.id, status });

      // Audit trail
      if (status) {
        auditStatusChange(request, user, "WorkOrder", id, "previous", status);
      } else {
        auditUpdate(
          request,
          user,
          "WorkOrder",
          id,
          {} as Record<string, unknown>,
          updateData as Record<string, unknown>,
        );
      }

      return successResponse(workOrder);
    } catch (error) {
      return handleError(error);
    }
  },
  { permission: "production:write" },
);

// DELETE - Delete work order (requires admin role)
export const DELETE = withAuth(
  async (
    request: NextRequest,
    { params, user }: { params: { id: string }; user: AuthUser },
  ) => {
    // Rate limiting
    const rlResult2 = await checkWriteEndpointLimit(request);
    if (rlResult2) return rlResult2;

    try {
      const { id } = await params;

      logger.warn("Deleting work order", { workOrderId: id, userId: user.id });

      // Check if work order exists
      const existing = await prisma.workOrder.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundError("Work order", id);
      }

      // Only allow deletion of draft or cancelled orders (case-insensitive)
      if (!["draft", "cancelled"].includes(existing.status.toLowerCase())) {
        return NextResponse.json(
          {
            success: false,
            error: "Can only delete DRAFT or CANCELLED work orders",
          },
          { status: 400 },
        );
      }

      await prisma.workOrder.delete({ where: { id } });

      logger.audit("delete", "workOrder", id, { userId: user.id });
      auditDelete(request, user, "WorkOrder", id, {
        woNumber: existing.woNumber,
      });

      return NextResponse.json({
        success: true,
        message: "Work order deleted",
      });
    } catch (error) {
      return handleError(error);
    }
  },
  { role: "manager" }, // Only managers and above can delete
);
