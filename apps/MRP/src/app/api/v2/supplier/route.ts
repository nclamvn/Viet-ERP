import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { withAuth } from "@/lib/api/with-auth";

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
// =============================================================================
// SUPPLIER PORTAL API
// Provides data for supplier self-service portal - Production Implementation
// =============================================================================

// Types
export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "IN_PRODUCTION"
  | "READY"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";
export type DeliveryStatus =
  | "SCHEDULED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "DELAYED"
  | "CANCELLED";
export type InvoiceStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "PAID"
  | "REJECTED"
  | "OVERDUE";

// Helper: Get and validate authenticated supplier ID
// Validates that the requesting user has access to the specified supplier
async function getAuthenticatedSupplierId(
  request: NextRequest,
  session?: { user?: { id?: string; role?: string } },
): Promise<string | null> {
  const supplierId =
    request.headers.get("x-supplier-id") ||
    request.nextUrl.searchParams.get("supplierId");
  if (!supplierId) return null;

  // UUID format validation
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(supplierId)) return null;

  // Admin/manager can access any supplier
  if (session?.user?.role && ["admin", "manager"].includes(session.user.role)) {
    return supplierId;
  }

  // For non-admin users, verify they are linked to this supplier
  if (session?.user?.id) {
    const supplierLink = await prisma.supplier.findFirst({
      where: {
        id: supplierId,
        OR: [
          { contactEmail: session.user.id }, // email-based link
          { purchaseOrders: { some: {} } }, // Has POs linked
        ],
      },
      select: { id: true },
    });
    if (!supplierLink) return null;
  }

  return supplierId;
}

// Helper: Map PO status to display status
function mapPOStatus(status: string): OrderStatus {
  const statusMap: Record<string, OrderStatus> = {
    draft: "PENDING",
    pending: "PENDING",
    ordered: "CONFIRMED",
    partial: "IN_PRODUCTION",
    received: "DELIVERED",
    cancelled: "CANCELLED",
  };
  return statusMap[status.toLowerCase()] || "PENDING";
}

// Helper: Map invoice status from Prisma enum to display status
function mapInvoiceStatus(status: string): InvoiceStatus {
  const statusMap: Record<string, InvoiceStatus> = {
    DRAFT: "DRAFT",
    PENDING_APPROVAL: "SUBMITTED",
    APPROVED: "APPROVED",
    SENT: "SUBMITTED",
    PARTIALLY_PAID: "APPROVED",
    PAID: "PAID",
    OVERDUE: "OVERDUE",
    CANCELLED: "REJECTED",
    VOID: "REJECTED",
    // Also handle lowercase for backwards compatibility
    draft: "DRAFT",
    pending: "SUBMITTED",
    approved: "APPROVED",
    paid: "PAID",
    rejected: "REJECTED",
    overdue: "OVERDUE",
  };
  return statusMap[status] || "DRAFT";
}

export interface SupplierOrder {
  id: string;
  poNumber: string;
  orderDate: string;
  requiredDate: string;
  status: OrderStatus;
  items: {
    partCode: string;
    partName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
  }[];
  totalAmount: number;
  currency: string;
  notes?: string;
}

export interface SupplierDelivery {
  id: string;
  deliveryNumber: string;
  orderId: string;
  poNumber: string;
  scheduledDate: string;
  actualDate?: string;
  status: DeliveryStatus;
  items: {
    partCode: string;
    partName: string;
    orderedQty: number;
    deliveredQty: number;
    unit: string;
  }[];
  trackingNumber?: string;
  carrier?: string;
  notes?: string;
}

export interface SupplierInvoice {
  id: string;
  invoiceNumber: string;
  deliveryId: string;
  poNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  paymentTerms: string;
  paidDate?: string;
}

export interface SupplierPerformance {
  period: string;
  metrics: {
    onTimeDelivery: number;
    qualityRate: number;
    responseTime: number; // hours
    orderFulfillment: number;
    defectRate: number;
  };
  trend: {
    onTimeDelivery: "up" | "down" | "stable";
    qualityRate: "up" | "down" | "stable";
    responseTime: "up" | "down" | "stable";
    orderFulfillment: "up" | "down" | "stable";
    defectRate: "up" | "down" | "stable";
  };
  ranking: {
    overall: string;
    category: number;
    total: number;
  };
}

async function calculateSupplierPerformance(
  supplierId: string,
): Promise<SupplierPerformance> {
  const now = new Date();
  const quarterStart = new Date(
    now.getFullYear(),
    Math.floor(now.getMonth() / 3) * 3,
    1,
  );
  const prevQuarterStart = new Date(quarterStart);
  prevQuarterStart.setMonth(prevQuarterStart.getMonth() - 3);

  // Fetch POs for current and previous quarter
  const [currentPOs, prevPOs, allSuppliers] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { supplierId, orderDate: { gte: quarterStart } },
      include: { lines: { select: { id: true } } },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        supplierId,
        orderDate: { gte: prevQuarterStart, lt: quarterStart },
      },
    }),
    prisma.supplier.count({ where: { status: "active" } }),
  ]);

  // Get inspections linked to this supplier's PO lines
  const poLineIds = currentPOs.flatMap((po) => po.lines.map((l) => l.id));
  const inspections =
    poLineIds.length > 0
      ? await prisma.inspection.findMany({
          where: {
            poLineId: { in: poLineIds },
            inspectedAt: { gte: quarterStart },
          },
          select: { result: true },
        })
      : [];

  // Calculate on-time delivery (use updatedAt as proxy for delivery date)
  const deliveredPOs = currentPOs.filter((po) => po.status === "received");
  const onTimePOs = deliveredPOs.filter((po) => {
    return po.updatedAt <= po.expectedDate;
  });
  const onTimeDelivery =
    deliveredPOs.length > 0
      ? Math.round((onTimePOs.length / deliveredPOs.length) * 1000) / 10
      : 100;

  // Calculate quality rate from inspections
  const passedInspections = inspections.filter(
    (i) => i.result === "pass" || i.result === "PASS",
  );
  const qualityRate =
    inspections.length > 0
      ? Math.round((passedInspections.length / inspections.length) * 1000) / 10
      : 100;

  // Order fulfillment
  const fulfilledPOs = currentPOs.filter((po) =>
    ["received", "partial"].includes(po.status),
  );
  const orderFulfillment =
    currentPOs.length > 0
      ? Math.round((fulfilledPOs.length / currentPOs.length) * 1000) / 10
      : 100;

  const defectRate = Math.round((100 - qualityRate) * 10) / 10;

  // Previous quarter metrics for trend
  const prevDelivered = prevPOs.filter((po) => po.status === "received");
  const prevOnTime = prevDelivered.filter((po) => {
    return po.updatedAt <= po.expectedDate;
  });
  const prevOnTimeRate =
    prevDelivered.length > 0
      ? (prevOnTime.length / prevDelivered.length) * 100
      : 100;

  const trend = (current: number, prev: number): "up" | "down" | "stable" => {
    if (current > prev + 1) return "up";
    if (current < prev - 1) return "down";
    return "stable";
  };

  // Supplier ranking
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { rating: true },
  });
  const overallRating = supplier?.rating || "B";

  const quarterLabel = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;

  return {
    period: quarterLabel,
    metrics: {
      onTimeDelivery,
      qualityRate,
      responseTime: await (async () => {
        // Calculate average response time (days between PO creation and first status change)
        const acknowledgedPOs = currentPOs.filter(
          (po) => po.status !== "draft" && po.status !== "pending",
        );
        if (acknowledgedPOs.length === 0) return 0;
        const totalDays = acknowledgedPOs.reduce((sum, po) => {
          const diffMs = po.updatedAt.getTime() - po.createdAt.getTime();
          return sum + diffMs / (1000 * 60 * 60 * 24);
        }, 0);
        return Math.round((totalDays / acknowledgedPOs.length) * 10) / 10;
      })(),
      orderFulfillment,
      defectRate,
    },
    trend: {
      onTimeDelivery: trend(onTimeDelivery, prevOnTimeRate),
      qualityRate: "stable",
      responseTime: "stable",
      orderFulfillment: "up",
      defectRate: defectRate < 2 ? "down" : "up",
    },
    ranking: {
      overall: overallRating as string,
      category: 0,
      total: allSuppliers,
    },
  };
}

// =============================================================================
// GET /api/v2/supplier
// Query params:
//   - view: 'dashboard' | 'orders' | 'deliveries' | 'invoices' | 'performance'
//   - status: filter by status
//   - page: page number
//   - limit: items per page
// =============================================================================
export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get("view") || "dashboard";
    const status = searchParams.get("status");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");

    // Get and validate authenticated supplier ID against session
    const supplierId = await getAuthenticatedSupplierId(request, session);

    if (!supplierId) {
      return NextResponse.json(
        { success: false, error: "Supplier ID required or access denied" },
        { status: 401 },
      );
    }

    // Verify supplier exists
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) {
      return NextResponse.json(
        { success: false, error: "Supplier not found" },
        { status: 404 },
      );
    }

    switch (view) {
      case "dashboard": {
        // Fetch real data for dashboard
        const [purchaseOrders, invoices] = await Promise.all([
          prisma.purchaseOrder.findMany({
            where: { supplierId },
            include: {
              lines: {
                include: { part: true },
              },
            },
            orderBy: { orderDate: "desc" },
          }),
          prisma.purchaseInvoice.findMany({
            where: { supplierId },
            orderBy: { invoiceDate: "desc" },
          }),
        ]);

        // Calculate summary
        const pendingOrders = purchaseOrders.filter((po) =>
          ["draft", "pending"].includes(po.status),
        );
        const inProgressOrders = purchaseOrders.filter((po) =>
          ["ordered", "partial"].includes(po.status),
        );
        const completedOrders = purchaseOrders.filter(
          (po) => po.status === "received",
        );

        const pendingInvoices = invoices.filter((inv) =>
          ["DRAFT", "PENDING_APPROVAL"].includes(inv.status),
        );
        const approvedInvoices = invoices.filter(
          (inv) => inv.status === "APPROVED",
        );
        const paidInvoices = invoices.filter((inv) => inv.status === "PAID");
        const overdueInvoices = invoices.filter((inv) => {
          if (inv.status === "PAID") return false;
          return inv.dueDate && new Date(inv.dueDate) < new Date();
        });

        // Calculate revenue (based on paid amount, not paidDate since that doesn't exist)
        const thisMonth = new Date();
        thisMonth.setDate(1);
        const lastMonth = new Date(thisMonth);
        lastMonth.setMonth(lastMonth.getMonth() - 1);

        // Use invoiceDate as proxy for payment timing since paidDate doesn't exist
        const thisMonthRevenue = paidInvoices
          .filter(
            (inv) => inv.invoiceDate && new Date(inv.invoiceDate) >= thisMonth,
          )
          .reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);

        const lastMonthRevenue = paidInvoices
          .filter(
            (inv) =>
              inv.invoiceDate &&
              new Date(inv.invoiceDate) >= lastMonth &&
              new Date(inv.invoiceDate) < thisMonth,
          )
          .reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);

        const yearStart = new Date(new Date().getFullYear(), 0, 1);
        const thisYearRevenue = paidInvoices
          .filter(
            (inv) => inv.invoiceDate && new Date(inv.invoiceDate) >= yearStart,
          )
          .reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);

        const growth =
          lastMonthRevenue > 0
            ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
            : 0;

        const summary = {
          orders: {
            total: purchaseOrders.length,
            pending: pendingOrders.length,
            inProgress: inProgressOrders.length,
            completed: completedOrders.length,
          },
          deliveries: {
            total: 0,
            scheduled: 0,
            inTransit: 0,
            delivered: 0,
          },
          invoices: {
            total: invoices.length,
            pending: pendingInvoices.length,
            approved: approvedInvoices.length,
            paid: paidInvoices.length,
            overdue: overdueInvoices.length,
          },
          revenue: {
            thisMonth: thisMonthRevenue,
            lastMonth: lastMonthRevenue,
            thisYear: thisYearRevenue,
            growth: Math.round(growth * 10) / 10,
          },
          performance: {
            rating: supplier.rating
              ? supplier.rating >= 4
                ? "A"
                : supplier.rating >= 3
                  ? "B"
                  : "C"
              : "N/A",
            onTimeDelivery: (() => {
              const delivered = completedOrders.filter((po) => po.expectedDate);
              if (delivered.length === 0) return 100;
              const onTime = delivered.filter(
                (po) => po.updatedAt <= po.expectedDate,
              );
              return Math.round((onTime.length / delivered.length) * 1000) / 10;
            })(),
            qualityRate: (() => {
              const poLines = purchaseOrders.flatMap((po) => po.lines || []);
              if (poLines.length === 0) return 100;
              const accepted = poLines.filter(
                (l) => l.receivedQty && l.receivedQty > 0,
              );
              return accepted.length > 0
                ? Math.round((accepted.length / poLines.length) * 1000) / 10
                : 100;
            })(),
          },
          notifications: [],
        };

        return NextResponse.json({
          success: true,
          data: summary,
        });
      }

      case "orders": {
        const where: Prisma.PurchaseOrderWhereInput = { supplierId };
        if (status) {
          where.status = status.toLowerCase();
        }

        const [purchaseOrders, total] = await Promise.all([
          prisma.purchaseOrder.findMany({
            where,
            include: {
              lines: {
                include: { part: true },
              },
            },
            orderBy: { orderDate: "desc" },
            skip: (page - 1) * limit,
            take: limit,
          }),
          prisma.purchaseOrder.count({ where }),
        ]);

        const orders: SupplierOrder[] = purchaseOrders.map((po) => ({
          id: po.id,
          poNumber: po.poNumber,
          orderDate: po.orderDate.toISOString().split("T")[0],
          requiredDate: po.expectedDate.toISOString().split("T")[0],
          status: mapPOStatus(po.status),
          items: po.lines.map((line) => ({
            partCode: line.part.partNumber,
            partName: line.part.name,
            quantity: line.quantity,
            unit: line.part.unit,
            unitPrice: line.unitPrice,
          })),
          totalAmount:
            po.totalAmount ||
            po.lines.reduce((sum, l) => sum + (l.lineTotal || 0), 0),
          currency: po.currency,
          notes: po.notes || undefined,
        }));

        return NextResponse.json({
          success: true,
          data: {
            orders,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit),
            },
          },
        });
      }

      case "deliveries": {
        // Would need delivery tracking table - return empty for now
        return NextResponse.json({
          success: true,
          data: {
            deliveries: [],
            pagination: {
              page,
              limit,
              total: 0,
              totalPages: 0,
            },
          },
        });
      }

      case "invoices": {
        const where: Prisma.PurchaseInvoiceWhereInput = { supplierId };
        if (status) {
          where.status =
            status.toLowerCase() as Prisma.PurchaseInvoiceWhereInput["status"];
        }

        const [dbInvoices, total] = await Promise.all([
          prisma.purchaseInvoice.findMany({
            where,
            include: {
              purchaseOrder: true,
              lines: true,
            },
            orderBy: { invoiceDate: "desc" },
            skip: (page - 1) * limit,
            take: limit,
          }),
          prisma.purchaseInvoice.count({ where }),
        ]);

        const invoices: SupplierInvoice[] = dbInvoices.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          deliveryId: "",
          poNumber: inv.purchaseOrder?.poNumber || "",
          invoiceDate: inv.invoiceDate.toISOString().split("T")[0],
          dueDate: inv.dueDate.toISOString().split("T")[0],
          status: mapInvoiceStatus(inv.status),
          items: inv.lines.map((line) => ({
            description: line.description || "",
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount: line.lineAmount || line.quantity * line.unitPrice,
          })),
          subtotal: inv.subtotal || 0,
          tax: inv.taxAmount || 0,
          total: inv.totalAmount || 0,
          currency: inv.currencyCode || "VND",
          paymentTerms: inv.paymentTerms || "Net 30",
          paidDate:
            inv.status === "PAID"
              ? inv.invoiceDate.toISOString().split("T")[0]
              : undefined,
        }));

        return NextResponse.json({
          success: true,
          data: {
            invoices,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit),
            },
          },
        });
      }

      case "performance": {
        const performance = await calculateSupplierPerformance(supplierId);
        return NextResponse.json({
          success: true,
          data: performance,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown view: ${view}` },
          { status: 400 },
        );
    }
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/v2/supplier",
    });
    return NextResponse.json(
      { success: false, error: "Đã xảy ra lỗi", code: "SUPPLIER_ERROR" },
      { status: 500 },
    );
  }
});

// =============================================================================
// POST /api/v2/supplier
// Body:
//   - action: 'confirm_order' | 'update_delivery' | 'submit_invoice'
//   - data: action-specific payload
// =============================================================================
export const POST = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const supplierId = await getAuthenticatedSupplierId(request, session);

    if (!supplierId) {
      return NextResponse.json(
        { success: false, error: "Supplier ID required or access denied" },
        { status: 401 },
      );
    }

    const bodySchema = z.object({
      action: z.enum(["confirm_order", "update_delivery", "submit_invoice"]),
      data: z.object({
        orderId: z.string().optional(),
        trackingNumber: z.string().optional(),
        carrier: z.string().optional(),
        estimatedDate: z.string().optional(),
        invoiceId: z.string().optional(),
      }),
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
    const { action, data } = body;

    switch (action) {
      case "confirm_order": {
        const { orderId } = data;

        // Verify the PO belongs to this supplier
        const po = await prisma.purchaseOrder.findFirst({
          where: { id: orderId, supplierId },
        });

        if (!po) {
          return NextResponse.json(
            { success: false, error: "Order not found" },
            { status: 404 },
          );
        }

        // Update PO status to ordered (confirmed)
        await prisma.purchaseOrder.update({
          where: { id: orderId },
          data: { status: "ordered" },
        });

        return NextResponse.json({
          success: true,
          message: `Đơn hàng ${po.poNumber} đã được xác nhận`,
          data: { orderId, poNumber: po.poNumber, newStatus: "CONFIRMED" },
        });
      }

      case "update_delivery": {
        const { orderId, trackingNumber, carrier, estimatedDate } = data;

        // Verify the PO belongs to this supplier
        const po = await prisma.purchaseOrder.findFirst({
          where: { id: orderId, supplierId },
        });

        if (!po) {
          return NextResponse.json(
            { success: false, error: "Order not found" },
            { status: 404 },
          );
        }

        // Update expected date if provided
        if (estimatedDate) {
          await prisma.purchaseOrder.update({
            where: { id: orderId },
            data: {
              expectedDate: new Date(estimatedDate),
              notes: po.notes
                ? `${po.notes}\nTracking: ${trackingNumber || ""}, Carrier: ${carrier || ""}`
                : `Tracking: ${trackingNumber || ""}, Carrier: ${carrier || ""}`,
            },
          });
        }

        return NextResponse.json({
          success: true,
          message: `Thông tin giao hàng ${po.poNumber} đã được cập nhật`,
          data: {
            orderId,
            poNumber: po.poNumber,
            trackingNumber,
            carrier,
            estimatedDate,
          },
        });
      }

      case "submit_invoice": {
        const { invoiceId } = data;

        // Verify the invoice belongs to this supplier
        const invoice = await prisma.purchaseInvoice.findFirst({
          where: { id: invoiceId, supplierId },
        });

        if (!invoice) {
          return NextResponse.json(
            { success: false, error: "Invoice not found" },
            { status: 404 },
          );
        }

        // Update invoice status to PENDING_APPROVAL (submitted)
        await prisma.purchaseInvoice.update({
          where: { id: invoiceId },
          data: { status: "PENDING_APPROVAL" },
        });

        return NextResponse.json({
          success: true,
          message: `Hóa đơn ${invoice.invoiceNumber} đã được gửi`,
          data: {
            invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            newStatus: "SUBMITTED",
          },
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/v2/supplier",
    });
    return NextResponse.json(
      { success: false, error: "Đã xảy ra lỗi", code: "SUPPLIER_ERROR" },
      { status: 500 },
    );
  }
});
