import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api/with-auth";
import { logger } from "@/lib/logger";
import { generateInspectionNumber } from "@/lib/quality/inspection-engine";
import { buildSearchQuery, parsePaginationParams } from "@/lib/pagination";
import { z } from "zod";
import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";

// Validation schema for Inspection creation
const InspectionCreateSchema = z.object({
  type: z.preprocess(
    (v) => (typeof v === "string" ? v.toUpperCase() : v),
    z.enum(["RECEIVING", "IN_PROCESS", "FINAL"]),
  ),
  sourceType: z.enum(["PO", "NON_PO", "PRODUCTION"]).optional(),
  planId: z.string().optional().nullable(),
  partId: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  poLineId: z.string().optional().nullable(),
  workOrderId: z.string().optional().nullable(),
  salesOrderId: z.string().optional().nullable(),
  lotNumber: z.string().optional().nullable(),
  quantityReceived: z.number().int().min(0).optional(),
  quantityInspected: z.number().int().min(0).optional(),
  warehouseId: z.string().optional().nullable(),
  workCenter: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const GET = withAuth(async (request, _context, _session) => {
  try {
    // Rate limiting
    const rateLimitResult = await checkReadEndpointLimit(request);
    if (rateLimitResult) return rateLimitResult;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const { page, pageSize } = parsePaginationParams(request);

    const searchQuery = buildSearchQuery(search, [
      "inspectionNumber",
      "lotNumber",
      "notes",
    ]);
    const where: Prisma.InspectionWhereInput = {
      ...searchQuery,
    };
    if (type) where.type = type;
    if (status) where.status = status;

    const [inspections, total] = await Promise.all([
      prisma.inspection.findMany({
        where,
        include: {
          plan: { select: { planNumber: true, name: true } },
          part: { select: { partNumber: true, name: true } },
          product: { select: { sku: true, name: true } },
          workOrder: { select: { woNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.inspection.count({ where }),
    ]);

    return NextResponse.json({
      data: inspections,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/quality/inspections",
    });
    return NextResponse.json(
      { error: "Lỗi tải danh sách kiểm tra" },
      { status: 500 },
    );
  }
});

export const POST = withAuth(async (request, context, session) => {
  try {
    // Rate limiting
    const rateLimitResult = await checkWriteEndpointLimit(request);
    if (rateLimitResult) return rateLimitResult;

    const body = await request.json();

    // Validate request body
    const validationResult = InspectionCreateSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Dữ liệu không hợp lệ",
          details: validationResult.error.issues,
        },
        { status: 400 },
      );
    }

    const data = validationResult.data;
    const sourceType = data.sourceType || "PO";

    // Branch validation by source type for RECEIVING inspections
    if (data.type === "RECEIVING") {
      if (sourceType === "PO") {
        // PO source: require poLineId (existing logic)
        if (!data.poLineId) {
          return NextResponse.json(
            { error: "Phải chọn dòng PO (poLineId) cho kiểm tra nhận hàng" },
            { status: 400 },
          );
        }

        const poLine = await prisma.purchaseOrderLine.findUnique({
          where: { id: data.poLineId },
          include: { po: { select: { id: true, status: true } } },
        });

        if (!poLine) {
          return NextResponse.json(
            { error: "Dòng PO không tồn tại" },
            { status: 400 },
          );
        }

        if (poLine.po.status !== "received") {
          return NextResponse.json(
            { error: "PO phải ở trạng thái Đã nhận hàng" },
            { status: 400 },
          );
        }

        const existingCompleted = await prisma.inspection.findFirst({
          where: {
            poLineId: data.poLineId,
            type: "RECEIVING",
            status: "completed",
          },
        });
        if (existingCompleted) {
          return NextResponse.json(
            {
              error: `Dòng PO này đã có inspection hoàn thành (${existingCompleted.inspectionNumber}). Không thể tạo thêm.`,
            },
            { status: 409 },
          );
        }

        const remaining = poLine.quantity - poLine.receivedQty;
        if (
          data.quantityReceived !== undefined &&
          data.quantityReceived > remaining
        ) {
          return NextResponse.json(
            {
              error: `Số lượng nhận (${data.quantityReceived}) vượt quá số lượng còn lại (${remaining})`,
            },
            { status: 400 },
          );
        }
      } else if (sourceType === "NON_PO") {
        // Non-PO source: require partId + quantityReceived
        if (!data.partId) {
          return NextResponse.json(
            { error: "Phải chọn linh kiện (partId) cho nhận hàng ngoài PO" },
            { status: 400 },
          );
        }
        if (!data.quantityReceived || data.quantityReceived <= 0) {
          return NextResponse.json(
            { error: "Số lượng nhận phải lớn hơn 0" },
            { status: 400 },
          );
        }
      } else if (sourceType === "PRODUCTION") {
        // Production source: require workOrderId
        if (!data.workOrderId) {
          return NextResponse.json(
            {
              error:
                "Phải chọn lệnh sản xuất (workOrderId) cho nhận hàng từ sản xuất",
            },
            { status: 400 },
          );
        }

        const wo = await prisma.workOrder.findUnique({
          where: { id: data.workOrderId },
          include: { product: { select: { id: true, sku: true, name: true } } },
        });
        if (!wo) {
          return NextResponse.json(
            { error: "Lệnh sản xuất không tồn tại" },
            { status: 400 },
          );
        }

        const woStatus = wo.status.toLowerCase();
        if (woStatus !== "completed" && woStatus !== "in_progress") {
          return NextResponse.json(
            {
              error:
                "Lệnh sản xuất phải ở trạng thái Hoàn thành hoặc Đang thực hiện",
            },
            { status: 400 },
          );
        }

        // Prevent duplicate completed inspection on same WO
        const existingWOInspection = await prisma.inspection.findFirst({
          where: {
            workOrderId: data.workOrderId,
            type: "RECEIVING",
            sourceType: "PRODUCTION",
            status: "completed",
          },
        });
        if (existingWOInspection) {
          return NextResponse.json(
            {
              error: `WO này đã có inspection hoàn thành (${existingWOInspection.inspectionNumber}). Không thể tạo thêm.`,
            },
            { status: 409 },
          );
        }

        // Auto-populate productId from WO
        data.productId = wo.productId;
      }
    }

    // Validate entity references exist
    if (data.planId) {
      const plan = await prisma.inspectionPlan.findUnique({
        where: { id: data.planId },
      });
      if (!plan) {
        return NextResponse.json(
          { error: "Kế hoạch kiểm tra không tồn tại" },
          { status: 400 },
        );
      }
    }

    if (data.partId) {
      const part = await prisma.part.findUnique({ where: { id: data.partId } });
      if (!part) {
        return NextResponse.json(
          { error: "Linh kiện không tồn tại" },
          { status: 400 },
        );
      }
    }

    if (data.productId) {
      const product = await prisma.product.findUnique({
        where: { id: data.productId },
      });
      if (!product) {
        return NextResponse.json(
          { error: "Sản phẩm không tồn tại" },
          { status: 400 },
        );
      }
    }

    if (data.workOrderId && sourceType !== "PRODUCTION") {
      const wo = await prisma.workOrder.findUnique({
        where: { id: data.workOrderId },
      });
      if (!wo) {
        return NextResponse.json(
          { error: "Lệnh sản xuất không tồn tại" },
          { status: 400 },
        );
      }
    }

    if (data.warehouseId) {
      const warehouse = await prisma.warehouse.findUnique({
        where: { id: data.warehouseId },
      });
      if (!warehouse) {
        return NextResponse.json(
          { error: "Kho không tồn tại" },
          { status: 400 },
        );
      }
    }

    const inspectionNumber = await generateInspectionNumber(data.type);

    const inspection = await prisma.inspection.create({
      data: {
        inspectionNumber,
        type: data.type,
        sourceType: data.type === "RECEIVING" ? sourceType : null,
        planId: data.planId || null,
        partId: data.partId || null,
        productId: data.productId || null,
        poLineId: data.poLineId || null,
        workOrderId: data.workOrderId || null,
        salesOrderId: data.salesOrderId || null,
        lotNumber: data.lotNumber || null,
        quantityReceived: data.quantityReceived || 0,
        quantityInspected: data.quantityInspected || 0,
        inspectedBy: session.user.id,
        warehouseId: data.warehouseId || null,
        workCenter: data.workCenter || null,
        notes: data.notes || null,
        status: "pending",
      },
    });

    // For PRODUCTION source: create RECEIVING inventory record + PRODUCED lot transaction
    if (
      data.type === "RECEIVING" &&
      sourceType === "PRODUCTION" &&
      data.partId &&
      data.quantityReceived
    ) {
      const receivingWarehouse = await prisma.warehouse.findFirst({
        where: { type: "RECEIVING" },
      });
      // Fallback to default warehouse if no RECEIVING warehouse exists
      const targetWarehouse =
        receivingWarehouse ||
        (await prisma.warehouse.findFirst({
          where: { isDefault: true },
        }));

      if (targetWarehouse) {
        const lotNumber = data.lotNumber || `LOT-WO-${inspectionNumber}`;

        const existingInv = await prisma.inventory.findFirst({
          where: {
            partId: data.partId,
            warehouseId: targetWarehouse.id,
            lotNumber: lotNumber,
          },
        });

        if (existingInv) {
          await prisma.inventory.update({
            where: { id: existingInv.id },
            data: { quantity: existingInv.quantity + data.quantityReceived },
          });
        } else {
          await prisma.inventory.create({
            data: {
              partId: data.partId,
              warehouseId: targetWarehouse.id,
              quantity: data.quantityReceived,
              reservedQty: 0,
              lotNumber: lotNumber,
              locationCode: "RECEIVING",
            },
          });
        }

        await prisma.lotTransaction.create({
          data: {
            lotNumber: lotNumber,
            transactionType: "PRODUCED",
            partId: data.partId,
            quantity: data.quantityReceived,
            previousQty: existingInv?.quantity ?? 0,
            newQty: (existingInv?.quantity ?? 0) + data.quantityReceived,
            workOrderId: data.workOrderId,
            inspectionId: inspection.id,
            toWarehouseId: targetWarehouse.id,
            toLocation: "RECEIVING",
            userId: session.user.id,
            notes: `Production output from WO → Inspection ${inspectionNumber}`,
          },
        });
      }
    }

    return NextResponse.json(inspection, { status: 201 });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "POST /api/quality/inspections",
    });
    return NextResponse.json({ error: "Lỗi tạo kiểm tra" }, { status: 500 });
  }
});
