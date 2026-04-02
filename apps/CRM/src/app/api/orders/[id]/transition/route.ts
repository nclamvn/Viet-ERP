import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerOrRole, isErrorResponse } from "@/lib/auth/rbac";
import { validateRequest, orderTransitionSchema } from "@/lib/validations";
import { handleApiError } from "@/lib/api/errors";
import { BadRequest } from "@/lib/api/errors";
import {
  canTransition,
  getTimestampField,
  getStatusLabelKey,
} from "@/lib/orders/state-machine";
import { eventBus, CRM_EVENTS } from "@/lib/events";
import type { OrderStatus } from ".prisma/crm-client";

// POST /api/orders/[id]/transition — Transition order status
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { id } = params;

    const existing = await prisma.salesOrder.findUnique({
      where: { id },
      select: {
        createdById: true,
        status: true,
        total: true,
        orderNumber: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const result = await requireOwnerOrRole(existing.createdById, [
      "ADMIN",
      "MANAGER",
    ]);
    if (isErrorResponse(result)) return result;
    const user = result;

    const body = await req.json();
    const data = validateRequest(orderTransitionSchema, body);

    const fromStatus = existing.status as OrderStatus;
    const toStatus = data.toStatus as OrderStatus;

    // Validate state machine transition
    if (!canTransition(fromStatus, toStatus)) {
      throw BadRequest(
        `Không thể chuyển trạng thái từ ${fromStatus} sang ${toStatus}`,
      );
    }

    // Validate refund amount doesn't exceed order total
    if (toStatus === "REFUNDED" && data.refundAmount) {
      if (data.refundAmount > Number(existing.total)) {
        throw BadRequest("Số tiền hoàn không được vượt quá tổng đơn hàng");
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      status: toStatus,
    };

    // Set timestamp
    const tsField = getTimestampField(toStatus);
    if (tsField) {
      updateData[tsField] = new Date();
    }

    // Set extra fields based on transition
    if (toStatus === "CANCELLED" && data.cancellationReason) {
      updateData.cancellationReason = data.cancellationReason;
    }
    if (toStatus === "REFUNDED" && data.refundAmount !== undefined) {
      updateData.refundAmount = data.refundAmount;
    }
    if (toStatus === "SHIPPED") {
      if (data.trackingNumber) updateData.trackingNumber = data.trackingNumber;
      if (data.shippingProvider)
        updateData.shippingProvider = data.shippingProvider;
    }

    // Transaction: update order + create history entry
    const order = await prisma.$transaction(async (tx) => {
      const updated = await tx.salesOrder.update({
        where: { id },
        data: updateData,
        include: {
          items: { include: { product: true } },
          company: { select: { id: true, name: true } },
          deal: { select: { id: true, title: true } },
          createdBy: { select: { id: true, name: true } },
          statusHistory: {
            orderBy: { createdAt: "desc" },
            include: { user: { select: { id: true, name: true } } },
          },
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: fromStatus as string,
          toStatus: toStatus as string,
          note: data.note || null,
          userId: user.id,
        },
      });

      // Re-fetch with history to include the new entry
      return tx.salesOrder.findUnique({
        where: { id },
        include: {
          items: { include: { product: true } },
          company: { select: { id: true, name: true } },
          deal: { select: { id: true, title: true } },
          createdBy: { select: { id: true, name: true } },
          statusHistory: {
            orderBy: { createdAt: "desc" },
            include: { user: { select: { id: true, name: true } } },
          },
        },
      });
    });

    // Fire-and-forget: emit order status changed event
    const statusLabelKey = getStatusLabelKey(toStatus);
    const STATUS_LABELS: Record<string, string> = {
      "orderStatus.pending": "Chờ xác nhận",
      "orderStatus.confirmed": "Đã xác nhận",
      "orderStatus.inProduction": "Đang sản xuất",
      "orderStatus.shipped": "Đã giao",
      "orderStatus.delivered": "Đã nhận",
      "orderStatus.cancelled": "Đã hủy",
      "orderStatus.refunded": "Hoàn tiền",
    };
    const statusLabel = STATUS_LABELS[statusLabelKey] || toStatus;
    eventBus
      .emit(CRM_EVENTS.ORDER_STATUS_CHANGED, {
        timestamp: new Date().toISOString(),
        userId: user.id,
        orderId: id,
        order: {
          orderNumber: existing.orderNumber,
          total: Number(existing.total),
          status: toStatus,
        },
        ownerId: existing.createdById,
        fromStatus: fromStatus as string,
        toStatus: toStatus as string,
        statusLabel,
      })
      .catch(() => {});

    return NextResponse.json(order);
  } catch (error) {
    return handleApiError(error, "/api/orders/[id]/transition");
  }
}
