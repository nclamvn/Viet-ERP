// =============================================================================
// SUPPLIER DATA EXTRACTOR
// Extracts and prepares supplier data for risk analysis
// =============================================================================

import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/mrp-client";

// =============================================================================
// PRISMA RESULT TYPES
// =============================================================================

/** PurchaseOrder with lines and parts (from Prisma query) */
type PurchaseOrderWithLines = Prisma.PurchaseOrderGetPayload<{
  include: {
    lines: {
      include: { part: true };
    };
  };
}>;

/** PurchaseOrder base (without includes) */
type PurchaseOrderBase = Prisma.PurchaseOrderGetPayload<object>;

/** PartSupplier with part (from Prisma query) */
type PartSupplierWithPart = Prisma.PartSupplierGetPayload<{
  include: { part: true };
}>;

/** NCR with part (from Prisma query) */
type NCRWithPart = Prisma.NCRGetPayload<{
  include: { part: true };
}>;

/** Inspection with part (from Prisma query) */
type InspectionWithPart = Prisma.InspectionGetPayload<{
  include: { part: true };
}>;

/** PurchaseOrderLine with part */
type PurchaseOrderLineWithPart = Prisma.PurchaseOrderLineGetPayload<{
  include: { part: true };
}>;

// =============================================================================
// TYPES
// =============================================================================

export interface DeliveryPerformanceData {
  supplierId: string;
  supplierName: string;
  periodMonths: number;
  summary: {
    totalOrders: number;
    onTimeOrders: number;
    lateOrders: number;
    earlyOrders: number;
    onTimeRate: number;
    avgDaysLate: number;
    avgDaysEarly: number;
    perfectOrderRate: number;
  };
  trend: DeliveryTrendPoint[];
  worstPerformance: {
    poNumber: string;
    daysLate: number;
    expectedDate: Date;
    actualDate: Date;
  }[];
  leadTimeVariance: {
    quotedAvg: number;
    actualAvg: number;
    variance: number;
    variancePercent: number;
  };
}

export interface DeliveryTrendPoint {
  period: string;
  totalOrders: number;
  onTimeOrders: number;
  lateOrders: number;
  onTimeRate: number;
  avgDaysDeviation: number;
}

export interface QualityHistoryData {
  supplierId: string;
  supplierName: string;
  periodMonths: number;
  summary: {
    totalLotsReceived: number;
    acceptedLots: number;
    rejectedLots: number;
    acceptanceRate: number;
    totalNCRs: number;
    openNCRs: number;
    closedNCRs: number;
    totalCAPAs: number;
    openCAPAs: number;
    ppm: number;
    avgDaysToResolveNCR: number;
  };
  defectBreakdown: DefectCategoryData[];
  qualityTrend: QualityTrendPoint[];
  recentNCRs: NCRSummary[];
  lotQualityHistory: LotQualitySummary[];
}

export interface DefectCategoryData {
  category: string;
  count: number;
  percentage: number;
  avgQuantityAffected: number;
}

export interface QualityTrendPoint {
  period: string;
  lotsReceived: number;
  acceptanceRate: number;
  ncrCount: number;
  ppm: number;
}

export interface NCRSummary {
  id: string;
  ncrNumber: string;
  createdAt: Date;
  status: string;
  priority: string;
  defectCategory: string | null;
  quantityAffected: number;
  partSku: string | null;
  daysOpen: number;
  disposition: string | null;
}

export interface LotQualitySummary {
  lotNumber: string;
  receivedDate: Date;
  partSku: string | null;
  quantity: number;
  inspectionResult: string | null;
  defectCount: number;
}

export interface PricingTrendData {
  supplierId: string;
  supplierName: string;
  periodMonths: number;
  summary: {
    avgUnitPrice: number;
    minUnitPrice: number;
    maxUnitPrice: number;
    priceVariance: number;
    totalSpend: number;
    avgOrderValue: number;
    priceChangePercent: number;
    competitivenessScore: number;
  };
  priceHistory: PriceHistoryPoint[];
  partPricing: PartPricingData[];
  recentChanges: PriceChangeEvent[];
}

export interface PriceHistoryPoint {
  period: string;
  avgUnitPrice: number;
  totalSpend: number;
  orderCount: number;
}

export interface PartPricingData {
  partId: string;
  partSku: string;
  currentPrice: number;
  avgPrice: number;
  priceStability: number;
  lastPriceChange: Date | null;
  changePercent: number | null;
}

export interface PriceChangeEvent {
  date: Date;
  partSku: string;
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  type: "increase" | "decrease";
}

export interface OrderHistoryData {
  supplierId: string;
  supplierName: string;
  periodMonths: number;
  summary: {
    totalOrders: number;
    totalLineItems: number;
    totalQuantityOrdered: number;
    totalQuantityReceived: number;
    fulfillmentRate: number;
    avgOrderFrequencyDays: number;
    avgOrderValue: number;
    totalSpend: number;
    statusBreakdown: Record<string, number>;
  };
  orderHistory: OrderSummary[];
  partOrderDistribution: PartOrderData[];
  orderTrend: OrderTrendPoint[];
}

export interface OrderSummary {
  id: string;
  poNumber: string;
  orderDate: Date;
  expectedDate: Date;
  receivedDate: Date | null;
  status: string;
  totalAmount: number;
  lineCount: number;
  isLate: boolean;
  daysDeviation: number | null;
}

export interface PartOrderData {
  partId: string;
  partSku: string;
  orderCount: number;
  totalQuantity: number;
  avgQuantityPerOrder: number;
  totalSpend: number;
  lastOrderDate: Date;
}

export interface OrderTrendPoint {
  period: string;
  orderCount: number;
  totalSpend: number;
  avgOrderValue: number;
  fulfillmentRate: number;
}

export interface LeadTimeHistoryData {
  supplierId: string;
  supplierName: string;
  periodMonths: number;
  summary: {
    quotedLeadTimeDays: number;
    avgActualLeadTime: number;
    minActualLeadTime: number;
    maxActualLeadTime: number;
    leadTimeVariance: number;
    leadTimeVariancePercent: number;
    reliabilityScore: number;
    improvingTrend: boolean;
  };
  leadTimeHistory: LeadTimePoint[];
  partLeadTimes: PartLeadTimeData[];
  outliers: LeadTimeOutlier[];
}

export interface LeadTimePoint {
  poNumber: string;
  orderDate: Date;
  expectedDate: Date;
  receivedDate: Date | null;
  quotedDays: number;
  actualDays: number | null;
  variance: number | null;
}

export interface PartLeadTimeData {
  partId: string;
  partSku: string;
  quotedLeadTime: number;
  avgActualLeadTime: number;
  variance: number;
  orderCount: number;
}

export interface LeadTimeOutlier {
  poNumber: string;
  partSku: string;
  quotedDays: number;
  actualDays: number;
  deviationDays: number;
  deviationPercent: number;
}

export interface ResponseMetricsData {
  supplierId: string;
  supplierName: string;
  periodMonths: number;
  summary: {
    avgResponseTimeDays: number;
    fastResponseRate: number;
    slowResponseRate: number;
    avgNCRResolutionDays: number;
    avgCAPAClosureDays: number;
    communicationScore: number;
  };
  ncrResolutionHistory: ResolutionHistoryPoint[];
  capaClosureHistory: ResolutionHistoryPoint[];
}

export interface ResolutionHistoryPoint {
  id: string;
  referenceNumber: string;
  openedDate: Date;
  closedDate: Date | null;
  daysToResolve: number;
  priority: string;
}

export interface ComprehensiveSupplierData {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  country: string;
  status: string;
  rating: number | null;
  category: string | null;
  contactInfo: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  delivery: DeliveryPerformanceData;
  quality: QualityHistoryData;
  pricing: PricingTrendData;
  orders: OrderHistoryData;
  leadTime: LeadTimeHistoryData;
  response: ResponseMetricsData;
  partsSupplied: {
    partId: string;
    partSku: string;
    partName: string;
    isPreferred: boolean;
    qualified: boolean;
  }[];
  lastActivityDate: Date | null;
  dataCompleteness: number;
}

// =============================================================================
// SUPPLIER DATA EXTRACTOR CLASS
// =============================================================================

export class SupplierDataExtractor {
  /**
   * Extract delivery performance data for a supplier
   */
  async extractDeliveryPerformance(
    supplierId: string,
    months: number = 12,
  ): Promise<DeliveryPerformanceData | null> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) return null;

    // Get completed/received purchase orders
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        supplierId,
        orderDate: { gte: startDate },
        status: { in: ["received", "completed", "partial"] },
      },
      orderBy: { orderDate: "desc" },
    });

    // Calculate delivery metrics
    let onTimeOrders = 0;
    let lateOrders = 0;
    let earlyOrders = 0;
    let totalDaysLate = 0;
    let totalDaysEarly = 0;
    let lateCount = 0;
    let earlyCount = 0;

    const worstPerformance: DeliveryPerformanceData["worstPerformance"] = [];

    for (const order of orders) {
      // Use updatedAt as proxy for received date if not explicitly tracked
      const receivedDate = order.updatedAt;
      const expectedDate = order.expectedDate;
      const daysDiff = Math.floor(
        (receivedDate.getTime() - expectedDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      if (daysDiff <= 0) {
        if (daysDiff < -1) {
          earlyOrders++;
          totalDaysEarly += Math.abs(daysDiff);
          earlyCount++;
        } else {
          onTimeOrders++;
        }
      } else {
        lateOrders++;
        totalDaysLate += daysDiff;
        lateCount++;

        if (daysDiff > 3) {
          worstPerformance.push({
            poNumber: order.poNumber,
            daysLate: daysDiff,
            expectedDate,
            actualDate: receivedDate,
          });
        }
      }
    }

    // Sort worst performance by days late
    worstPerformance.sort((a, b) => b.daysLate - a.daysLate);

    const totalOrders = orders.length;
    const onTimeRate =
      totalOrders > 0 ? (onTimeOrders / totalOrders) * 100 : 100;
    const avgDaysLate = lateCount > 0 ? totalDaysLate / lateCount : 0;
    const avgDaysEarly = earlyCount > 0 ? totalDaysEarly / earlyCount : 0;

    // Perfect order = on time and complete
    const perfectOrders = orders.filter((o) => {
      const receivedDate = o.updatedAt;
      const daysDiff = Math.floor(
        (receivedDate.getTime() - o.expectedDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      return daysDiff <= 0 && o.status === "completed";
    }).length;
    const perfectOrderRate =
      totalOrders > 0 ? (perfectOrders / totalOrders) * 100 : 100;

    // Calculate trend by month
    const trend = this.calculateDeliveryTrend(orders, months);

    // Lead time variance
    const quotedLeadTime = supplier.leadTimeDays;
    const avgActualLeadTime = this.calculateAverageLeadTime(orders);

    return {
      supplierId,
      supplierName: supplier.name,
      periodMonths: months,
      summary: {
        totalOrders,
        onTimeOrders,
        lateOrders,
        earlyOrders,
        onTimeRate: Math.round(onTimeRate * 10) / 10,
        avgDaysLate: Math.round(avgDaysLate * 10) / 10,
        avgDaysEarly: Math.round(avgDaysEarly * 10) / 10,
        perfectOrderRate: Math.round(perfectOrderRate * 10) / 10,
      },
      trend,
      worstPerformance: worstPerformance.slice(0, 5),
      leadTimeVariance: {
        quotedAvg: quotedLeadTime,
        actualAvg: Math.round(avgActualLeadTime * 10) / 10,
        variance: Math.round((avgActualLeadTime - quotedLeadTime) * 10) / 10,
        variancePercent:
          quotedLeadTime > 0
            ? Math.round(
                ((avgActualLeadTime - quotedLeadTime) / quotedLeadTime) *
                  100 *
                  10,
              ) / 10
            : 0,
      },
    };
  }

  /**
   * Extract quality history data for a supplier
   */
  async extractQualityHistory(
    supplierId: string,
    months: number = 12,
  ): Promise<QualityHistoryData | null> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) return null;

    // Get parts supplied by this supplier
    const partSuppliers = await prisma.partSupplier.findMany({
      where: { supplierId },
      select: { partId: true },
    });
    const partIds = partSuppliers.map((ps) => ps.partId);

    if (partIds.length === 0) {
      return this.createEmptyQualityHistory(supplierId, supplier.name, months);
    }

    // Get receiving inspections for these parts
    const inspections = await prisma.inspection.findMany({
      where: {
        partId: { in: partIds },
        type: "RECEIVING",
        status: "completed",
        createdAt: { gte: startDate },
      },
      include: {
        part: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Get NCRs for these parts
    const ncrs = await prisma.nCR.findMany({
      where: {
        partId: { in: partIds },
        createdAt: { gte: startDate },
      },
      include: {
        part: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Get CAPAs for these NCRs
    const ncrIds = ncrs.map((n) => n.id);
    const capas = await prisma.cAPA.findMany({
      where: {
        sourceReference: { in: ncrIds },
        source: "NCR",
      },
    });

    // Calculate metrics
    const totalLotsReceived = inspections.length;
    const acceptedLots = inspections.filter((i) => i.result === "PASS").length;
    const rejectedLots = inspections.filter((i) => i.result === "FAIL").length;
    const acceptanceRate =
      totalLotsReceived > 0 ? (acceptedLots / totalLotsReceived) * 100 : 100;

    const totalNCRs = ncrs.length;
    const openNCRs = ncrs.filter(
      (n) => !["closed", "voided"].includes(n.status),
    ).length;
    const closedNCRs = ncrs.filter((n) => n.status === "closed").length;

    const totalCAPAs = capas.length;
    const openCAPAs = capas.filter(
      (c) => !["closed", "completed"].includes(c.status),
    ).length;

    // Calculate PPM (Parts Per Million defective)
    const totalQuantityInspected = inspections.reduce(
      (sum, i) => sum + (i.quantityInspected || 0),
      0,
    );
    const totalQuantityRejected = inspections.reduce(
      (sum, i) => sum + (i.quantityRejected || 0),
      0,
    );
    const ppm =
      totalQuantityInspected > 0
        ? Math.round((totalQuantityRejected / totalQuantityInspected) * 1000000)
        : 0;

    // Avg days to resolve NCR
    const closedNCRsList = ncrs.filter((n) => n.status === "closed");
    const avgDaysToResolveNCR =
      closedNCRsList.length > 0
        ? closedNCRsList.reduce((sum, n) => {
            const days = Math.ceil(
              (n.updatedAt.getTime() - n.createdAt.getTime()) /
                (1000 * 60 * 60 * 24),
            );
            return sum + days;
          }, 0) / closedNCRsList.length
        : 0;

    // Defect breakdown
    const defectBreakdown = this.calculateDefectBreakdown(ncrs);

    // Quality trend
    const qualityTrend = this.calculateQualityTrend(inspections, ncrs, months);

    // Recent NCRs
    const recentNCRs: NCRSummary[] = ncrs.slice(0, 10).map((ncr) => ({
      id: ncr.id,
      ncrNumber: ncr.ncrNumber,
      createdAt: ncr.createdAt,
      status: ncr.status,
      priority: ncr.priority,
      defectCategory: ncr.defectCategory,
      quantityAffected: ncr.quantityAffected,
      partSku: ncr.part?.partNumber || null,
      daysOpen: Math.ceil(
        (Date.now() - ncr.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      ),
      disposition: ncr.disposition,
    }));

    // Lot quality history
    const lotQualityHistory: LotQualitySummary[] = inspections
      .slice(0, 20)
      .map((insp) => ({
        lotNumber: insp.lotNumber || "N/A",
        receivedDate: insp.createdAt,
        partSku: insp.part?.partNumber || null,
        quantity: insp.quantityInspected || 0,
        inspectionResult: insp.result,
        defectCount: ncrs.filter((n) => n.lotNumber === insp.lotNumber).length,
      }));

    return {
      supplierId,
      supplierName: supplier.name,
      periodMonths: months,
      summary: {
        totalLotsReceived,
        acceptedLots,
        rejectedLots,
        acceptanceRate: Math.round(acceptanceRate * 10) / 10,
        totalNCRs,
        openNCRs,
        closedNCRs,
        totalCAPAs,
        openCAPAs,
        ppm,
        avgDaysToResolveNCR: Math.round(avgDaysToResolveNCR * 10) / 10,
      },
      defectBreakdown,
      qualityTrend,
      recentNCRs,
      lotQualityHistory,
    };
  }

  /**
   * Extract pricing trend data for a supplier
   */
  async extractPricingTrends(
    supplierId: string,
    months: number = 12,
  ): Promise<PricingTrendData | null> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) return null;

    // Get purchase orders with line items
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        supplierId,
        orderDate: { gte: startDate },
      },
      include: {
        lines: {
          include: {
            part: true,
          },
        },
      },
      orderBy: { orderDate: "desc" },
    });

    // Get current part supplier pricing
    const partSuppliers = await prisma.partSupplier.findMany({
      where: { supplierId },
      include: { part: true },
    });

    // Calculate pricing metrics
    const allLineItems = orders.flatMap((o) => o.lines);
    const unitPrices = allLineItems.map((l) => l.unitPrice);
    const avgUnitPrice =
      unitPrices.length > 0
        ? unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length
        : 0;
    const minUnitPrice = unitPrices.length > 0 ? Math.min(...unitPrices) : 0;
    const maxUnitPrice = unitPrices.length > 0 ? Math.max(...unitPrices) : 0;

    const priceVariance = this.calculateStdDev(unitPrices);
    const totalSpend = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const avgOrderValue = orders.length > 0 ? totalSpend / orders.length : 0;

    // Calculate price change percent (first vs last period)
    const priceChangePercent = this.calculatePriceChangePercent(orders);

    // Competitiveness score (based on price stability and market positioning)
    const competitivenessScore = this.calculateCompetitivenessScore(
      priceVariance,
      avgUnitPrice,
    );

    // Price history by month
    const priceHistory = this.calculatePriceHistory(orders, months);

    // Part-level pricing data
    const partPricing = this.calculatePartPricing(partSuppliers, orders);

    // Recent price changes
    const recentChanges = this.detectPriceChanges(orders);

    return {
      supplierId,
      supplierName: supplier.name,
      periodMonths: months,
      summary: {
        avgUnitPrice: Math.round(avgUnitPrice * 100) / 100,
        minUnitPrice: Math.round(minUnitPrice * 100) / 100,
        maxUnitPrice: Math.round(maxUnitPrice * 100) / 100,
        priceVariance: Math.round(priceVariance * 100) / 100,
        totalSpend: Math.round(totalSpend * 100) / 100,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        priceChangePercent: Math.round(priceChangePercent * 10) / 10,
        competitivenessScore: Math.round(competitivenessScore),
      },
      priceHistory,
      partPricing,
      recentChanges: recentChanges.slice(0, 10),
    };
  }

  /**
   * Extract order history data for a supplier
   */
  async extractOrderHistory(
    supplierId: string,
    months: number = 12,
  ): Promise<OrderHistoryData | null> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) return null;

    // Get all purchase orders
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        supplierId,
        orderDate: { gte: startDate },
      },
      include: {
        lines: {
          include: {
            part: true,
          },
        },
      },
      orderBy: { orderDate: "desc" },
    });

    // Calculate summary metrics
    const totalOrders = orders.length;
    const totalLineItems = orders.reduce((sum, o) => sum + o.lines.length, 0);
    const totalQuantityOrdered = orders.reduce(
      (sum, o) => sum + o.lines.reduce((s, l) => s + l.quantity, 0),
      0,
    );
    const totalQuantityReceived = orders.reduce(
      (sum, o) => sum + o.lines.reduce((s, l) => s + l.receivedQty, 0),
      0,
    );
    const fulfillmentRate =
      totalQuantityOrdered > 0
        ? (totalQuantityReceived / totalQuantityOrdered) * 100
        : 0;

    // Average order frequency
    const avgOrderFrequencyDays = this.calculateOrderFrequency(orders);
    const avgOrderValue =
      totalOrders > 0
        ? orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0) / totalOrders
        : 0;
    const totalSpend = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    // Status breakdown
    const statusBreakdown: Record<string, number> = {};
    orders.forEach((o) => {
      statusBreakdown[o.status] = (statusBreakdown[o.status] || 0) + 1;
    });

    // Order history summary
    const orderHistory: OrderSummary[] = orders.slice(0, 20).map((order) => {
      const receivedDate = ["received", "completed"].includes(order.status)
        ? order.updatedAt
        : null;
      const isLate =
        receivedDate && receivedDate.getTime() > order.expectedDate.getTime();
      const daysDeviation = receivedDate
        ? Math.floor(
            (receivedDate.getTime() - order.expectedDate.getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : null;

      return {
        id: order.id,
        poNumber: order.poNumber,
        orderDate: order.orderDate,
        expectedDate: order.expectedDate,
        receivedDate,
        status: order.status,
        totalAmount: order.totalAmount || 0,
        lineCount: order.lines.length,
        isLate: isLate || false,
        daysDeviation,
      };
    });

    // Part order distribution
    const partOrderDistribution = this.calculatePartOrderDistribution(orders);

    // Order trend
    const orderTrend = this.calculateOrderTrend(orders, months);

    return {
      supplierId,
      supplierName: supplier.name,
      periodMonths: months,
      summary: {
        totalOrders,
        totalLineItems,
        totalQuantityOrdered,
        totalQuantityReceived,
        fulfillmentRate: Math.round(fulfillmentRate * 10) / 10,
        avgOrderFrequencyDays: Math.round(avgOrderFrequencyDays * 10) / 10,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        totalSpend: Math.round(totalSpend * 100) / 100,
        statusBreakdown,
      },
      orderHistory,
      partOrderDistribution,
      orderTrend,
    };
  }

  /**
   * Extract lead time history data for a supplier
   */
  async extractLeadTimeHistory(
    supplierId: string,
    months: number = 12,
  ): Promise<LeadTimeHistoryData | null> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        partSuppliers: {
          include: { part: true },
        },
      },
    });

    if (!supplier) return null;

    // Get completed purchase orders
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        supplierId,
        orderDate: { gte: startDate },
        status: { in: ["received", "completed"] },
      },
      include: {
        lines: {
          include: { part: true },
        },
      },
      orderBy: { orderDate: "asc" },
    });

    const quotedLeadTimeDays = supplier.leadTimeDays;

    // Calculate actual lead times
    const leadTimes: number[] = [];
    const leadTimeHistory: LeadTimePoint[] = [];
    const outliers: LeadTimeOutlier[] = [];

    for (const order of orders) {
      const receivedDate = order.updatedAt;
      const actualDays = Math.ceil(
        (receivedDate.getTime() - order.orderDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const quotedDays = Math.ceil(
        (order.expectedDate.getTime() - order.orderDate.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const variance = actualDays - quotedDays;

      leadTimes.push(actualDays);
      leadTimeHistory.push({
        poNumber: order.poNumber,
        orderDate: order.orderDate,
        expectedDate: order.expectedDate,
        receivedDate,
        quotedDays,
        actualDays,
        variance,
      });

      // Track outliers (>50% deviation)
      const deviationPercent =
        quotedDays > 0 ? (variance / quotedDays) * 100 : 0;
      if (Math.abs(deviationPercent) > 50) {
        const mainPart = order.lines[0]?.part;
        outliers.push({
          poNumber: order.poNumber,
          partSku: mainPart?.partNumber || "Unknown",
          quotedDays,
          actualDays,
          deviationDays: variance,
          deviationPercent: Math.round(deviationPercent),
        });
      }
    }

    // Calculate statistics
    const avgActualLeadTime =
      leadTimes.length > 0
        ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
        : 0;
    const minActualLeadTime = leadTimes.length > 0 ? Math.min(...leadTimes) : 0;
    const maxActualLeadTime = leadTimes.length > 0 ? Math.max(...leadTimes) : 0;
    const leadTimeVariance = avgActualLeadTime - quotedLeadTimeDays;
    const leadTimeVariancePercent =
      quotedLeadTimeDays > 0
        ? (leadTimeVariance / quotedLeadTimeDays) * 100
        : 0;

    // Reliability score (higher is better, based on variance)
    const reliabilityScore = Math.max(
      0,
      100 - Math.abs(leadTimeVariancePercent) - this.calculateStdDev(leadTimes),
    );

    // Check if trend is improving
    const improvingTrend = this.isLeadTimeImproving(leadTimeHistory);

    // Part-level lead times
    const partLeadTimes = this.calculatePartLeadTimes(
      supplier.partSuppliers,
      orders,
    );

    return {
      supplierId,
      supplierName: supplier.name,
      periodMonths: months,
      summary: {
        quotedLeadTimeDays,
        avgActualLeadTime: Math.round(avgActualLeadTime * 10) / 10,
        minActualLeadTime,
        maxActualLeadTime,
        leadTimeVariance: Math.round(leadTimeVariance * 10) / 10,
        leadTimeVariancePercent: Math.round(leadTimeVariancePercent * 10) / 10,
        reliabilityScore: Math.round(reliabilityScore),
        improvingTrend,
      },
      leadTimeHistory,
      partLeadTimes,
      outliers: outliers.slice(0, 10),
    };
  }

  /**
   * Extract response metrics for a supplier
   */
  async extractResponseMetrics(
    supplierId: string,
    months: number = 12,
  ): Promise<ResponseMetricsData | null> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) return null;

    // Get parts for this supplier
    const partSuppliers = await prisma.partSupplier.findMany({
      where: { supplierId },
      select: { partId: true },
    });
    const partIds = partSuppliers.map((ps) => ps.partId);

    // Get NCRs and their resolution times
    const ncrs = await prisma.nCR.findMany({
      where: {
        partId: { in: partIds },
        source: "RECEIVING",
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get CAPAs related to these NCRs
    const ncrIds = ncrs.map((n) => n.id);
    const capas = await prisma.cAPA.findMany({
      where: {
        sourceReference: { in: ncrIds },
        source: "NCR",
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate NCR resolution metrics
    const closedNCRs = ncrs.filter((n) => n.status === "closed");
    const ncrResolutionDays: number[] = closedNCRs.map((n) =>
      Math.ceil(
        (n.updatedAt.getTime() - n.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );
    const avgNCRResolutionDays =
      ncrResolutionDays.length > 0
        ? ncrResolutionDays.reduce((a, b) => a + b, 0) /
          ncrResolutionDays.length
        : 0;

    // Calculate CAPA closure metrics
    const closedCAPAs = capas.filter((c) =>
      ["closed", "completed"].includes(c.status),
    );
    const capaClosureDays: number[] = closedCAPAs.map((c) =>
      Math.ceil(
        (c.updatedAt.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );
    const avgCAPAClosureDays =
      capaClosureDays.length > 0
        ? capaClosureDays.reduce((a, b) => a + b, 0) / capaClosureDays.length
        : 0;

    // Response time analysis
    const avgResponseTimeDays =
      (avgNCRResolutionDays + avgCAPAClosureDays) / 2 || 0;
    const fastResponseRate =
      closedNCRs.length > 0
        ? (closedNCRs.filter((n) => {
            const days = Math.ceil(
              (n.updatedAt.getTime() - n.createdAt.getTime()) /
                (1000 * 60 * 60 * 24),
            );
            return days <= 7;
          }).length /
            closedNCRs.length) *
          100
        : 100;

    const slowResponseRate =
      closedNCRs.length > 0
        ? (closedNCRs.filter((n) => {
            const days = Math.ceil(
              (n.updatedAt.getTime() - n.createdAt.getTime()) /
                (1000 * 60 * 60 * 24),
            );
            return days > 30;
          }).length /
            closedNCRs.length) *
          100
        : 0;

    // Communication score (based on response times)
    const communicationScore = this.calculateCommunicationScore(
      avgNCRResolutionDays,
      avgCAPAClosureDays,
      fastResponseRate,
    );

    // Resolution history
    const ncrResolutionHistory: ResolutionHistoryPoint[] = closedNCRs
      .slice(0, 20)
      .map((n) => ({
        id: n.id,
        referenceNumber: n.ncrNumber,
        openedDate: n.createdAt,
        closedDate: n.updatedAt,
        daysToResolve: Math.ceil(
          (n.updatedAt.getTime() - n.createdAt.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
        priority: n.priority,
      }));

    const capaClosureHistory: ResolutionHistoryPoint[] = closedCAPAs
      .slice(0, 20)
      .map((c) => ({
        id: c.id,
        referenceNumber: c.capaNumber,
        openedDate: c.createdAt,
        closedDate: c.updatedAt,
        daysToResolve: Math.ceil(
          (c.updatedAt.getTime() - c.createdAt.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
        priority: c.priority,
      }));

    return {
      supplierId,
      supplierName: supplier.name,
      periodMonths: months,
      summary: {
        avgResponseTimeDays: Math.round(avgResponseTimeDays * 10) / 10,
        fastResponseRate: Math.round(fastResponseRate * 10) / 10,
        slowResponseRate: Math.round(slowResponseRate * 10) / 10,
        avgNCRResolutionDays: Math.round(avgNCRResolutionDays * 10) / 10,
        avgCAPAClosureDays: Math.round(avgCAPAClosureDays * 10) / 10,
        communicationScore: Math.round(communicationScore),
      },
      ncrResolutionHistory,
      capaClosureHistory,
    };
  }

  /**
   * Extract comprehensive supplier data for risk analysis
   */
  async extractComprehensiveData(
    supplierId: string,
    months: number = 12,
  ): Promise<ComprehensiveSupplierData | null> {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        partSuppliers: {
          include: { part: true },
        },
        purchaseOrders: {
          orderBy: { orderDate: "desc" },
          take: 1,
        },
      },
    });

    if (!supplier) return null;

    // Extract all data categories in parallel
    const [delivery, quality, pricing, orders, leadTime, response] =
      await Promise.all([
        this.extractDeliveryPerformance(supplierId, months),
        this.extractQualityHistory(supplierId, months),
        this.extractPricingTrends(supplierId, months),
        this.extractOrderHistory(supplierId, months),
        this.extractLeadTimeHistory(supplierId, months),
        this.extractResponseMetrics(supplierId, months),
      ]);

    // Parts supplied
    const partsSupplied = supplier.partSuppliers.map((ps) => ({
      partId: ps.partId,
      partSku: ps.part.partNumber,
      partName: ps.part.name,
      isPreferred: ps.isPreferred,
      qualified: ps.qualified,
    }));

    // Last activity date
    const lastActivityDate = supplier.purchaseOrders[0]?.orderDate || null;

    // Data completeness score
    const dataCompleteness = this.calculateDataCompleteness(
      delivery,
      quality,
      pricing,
      orders,
      leadTime,
      response,
    );

    return {
      supplierId,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      country: supplier.country,
      status: supplier.status,
      rating: supplier.rating,
      category: supplier.category,
      contactInfo: {
        name: supplier.contactName,
        email: supplier.contactEmail,
        phone: supplier.contactPhone,
      },
      delivery: delivery!,
      quality: quality!,
      pricing: pricing!,
      orders: orders!,
      leadTime: leadTime!,
      response: response!,
      partsSupplied,
      lastActivityDate,
      dataCompleteness,
    };
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  private calculateDeliveryTrend(
    orders: PurchaseOrderBase[],
    months: number,
  ): DeliveryTrendPoint[] {
    const trend: DeliveryTrendPoint[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const period = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;

      const monthOrders = orders.filter((o) => {
        const date = new Date(o.orderDate);
        return date >= monthStart && date <= monthEnd;
      });

      let onTimeOrders = 0;
      let lateOrders = 0;
      let totalDeviation = 0;

      monthOrders.forEach((order) => {
        const receivedDate = order.updatedAt;
        const daysDiff = Math.floor(
          (receivedDate.getTime() - order.expectedDate.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        totalDeviation += daysDiff;

        if (daysDiff <= 0) {
          onTimeOrders++;
        } else {
          lateOrders++;
        }
      });

      const totalOrders = monthOrders.length;
      const onTimeRate =
        totalOrders > 0 ? (onTimeOrders / totalOrders) * 100 : 100;
      const avgDaysDeviation =
        totalOrders > 0 ? totalDeviation / totalOrders : 0;

      trend.push({
        period,
        totalOrders,
        onTimeOrders,
        lateOrders,
        onTimeRate: Math.round(onTimeRate * 10) / 10,
        avgDaysDeviation: Math.round(avgDaysDeviation * 10) / 10,
      });
    }

    return trend;
  }

  private calculateAverageLeadTime(orders: PurchaseOrderBase[]): number {
    if (orders.length === 0) return 0;

    const leadTimes = orders.map((o) =>
      Math.ceil(
        (o.updatedAt.getTime() - o.orderDate.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );

    return leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length;
  }

  private createEmptyQualityHistory(
    supplierId: string,
    supplierName: string,
    months: number,
  ): QualityHistoryData {
    return {
      supplierId,
      supplierName,
      periodMonths: months,
      summary: {
        totalLotsReceived: 0,
        acceptedLots: 0,
        rejectedLots: 0,
        acceptanceRate: 100,
        totalNCRs: 0,
        openNCRs: 0,
        closedNCRs: 0,
        totalCAPAs: 0,
        openCAPAs: 0,
        ppm: 0,
        avgDaysToResolveNCR: 0,
      },
      defectBreakdown: [],
      qualityTrend: [],
      recentNCRs: [],
      lotQualityHistory: [],
    };
  }

  private calculateDefectBreakdown(ncrs: NCRWithPart[]): DefectCategoryData[] {
    const categoryMap = new Map<string, { count: number; totalQty: number }>();

    ncrs.forEach((ncr) => {
      const category = ncr.defectCategory || "Unknown";
      const existing = categoryMap.get(category) || { count: 0, totalQty: 0 };
      categoryMap.set(category, {
        count: existing.count + 1,
        totalQty: existing.totalQty + ncr.quantityAffected,
      });
    });

    const total = ncrs.length;
    return Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        count: data.count,
        percentage:
          total > 0 ? Math.round((data.count / total) * 100 * 10) / 10 : 0,
        avgQuantityAffected: Math.round((data.totalQty / data.count) * 10) / 10,
      }))
      .sort((a, b) => b.count - a.count);
  }

  private calculateQualityTrend(
    inspections: InspectionWithPart[],
    ncrs: NCRWithPart[],
    months: number,
  ): QualityTrendPoint[] {
    const trend: QualityTrendPoint[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const period = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;

      const monthInspections = inspections.filter((insp) => {
        const date = new Date(insp.createdAt);
        return date >= monthStart && date <= monthEnd;
      });

      const monthNCRs = ncrs.filter((ncr) => {
        const date = new Date(ncr.createdAt);
        return date >= monthStart && date <= monthEnd;
      });

      const lotsReceived = monthInspections.length;
      const acceptedLots = monthInspections.filter(
        (i) => i.result === "PASS",
      ).length;
      const acceptanceRate =
        lotsReceived > 0 ? (acceptedLots / lotsReceived) * 100 : 100;

      const totalQtyInspected = monthInspections.reduce(
        (sum, i) => sum + (i.quantityInspected || 0),
        0,
      );
      const totalQtyRejected = monthInspections.reduce(
        (sum, i) => sum + (i.quantityRejected || 0),
        0,
      );
      const ppm =
        totalQtyInspected > 0
          ? Math.round((totalQtyRejected / totalQtyInspected) * 1000000)
          : 0;

      trend.push({
        period,
        lotsReceived,
        acceptanceRate: Math.round(acceptanceRate * 10) / 10,
        ncrCount: monthNCRs.length,
        ppm,
      });
    }

    return trend;
  }

  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculatePriceChangePercent(
    orders: PurchaseOrderWithLines[],
  ): number {
    if (orders.length < 2) return 0;

    // Compare first 3 months vs last 3 months average
    const sortedOrders = [...orders].sort(
      (a, b) =>
        new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime(),
    );

    const totalOrders = sortedOrders.length;
    const splitIndex = Math.floor(totalOrders / 2);

    const firstHalfOrders = sortedOrders.slice(0, splitIndex);
    const secondHalfOrders = sortedOrders.slice(splitIndex);

    const firstHalfAvg = this.calculateAvgOrderPrice(firstHalfOrders);
    const secondHalfAvg = this.calculateAvgOrderPrice(secondHalfOrders);

    if (firstHalfAvg === 0) return 0;
    return ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;
  }

  private calculateAvgOrderPrice(orders: PurchaseOrderWithLines[]): number {
    const allLines = orders.flatMap((o) => o.lines || []);
    if (allLines.length === 0) return 0;
    return (
      allLines.reduce((sum, l) => sum + (l.unitPrice || 0), 0) / allLines.length
    );
  }

  private calculateCompetitivenessScore(
    priceVariance: number,
    avgPrice: number,
  ): number {
    // Lower variance = more stable pricing = higher score
    const stabilityScore = Math.max(0, 100 - priceVariance * 10);
    return Math.min(100, stabilityScore);
  }

  private calculatePriceHistory(
    orders: PurchaseOrderWithLines[],
    months: number,
  ): PriceHistoryPoint[] {
    const history: PriceHistoryPoint[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const period = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;

      const monthOrders = orders.filter((o) => {
        const date = new Date(o.orderDate);
        return date >= monthStart && date <= monthEnd;
      });

      const allLines = monthOrders.flatMap((o) => o.lines || []);
      const avgUnitPrice =
        allLines.length > 0
          ? allLines.reduce((sum, l) => sum + (l.unitPrice || 0), 0) /
            allLines.length
          : 0;
      const totalSpend = monthOrders.reduce(
        (sum, o) => sum + (o.totalAmount || 0),
        0,
      );

      history.push({
        period,
        avgUnitPrice: Math.round(avgUnitPrice * 100) / 100,
        totalSpend: Math.round(totalSpend * 100) / 100,
        orderCount: monthOrders.length,
      });
    }

    return history;
  }

  private calculatePartPricing(
    partSuppliers: PartSupplierWithPart[],
    orders: PurchaseOrderWithLines[],
  ): PartPricingData[] {
    return partSuppliers.map((ps) => {
      const partLines = orders.flatMap((o) =>
        (o.lines || []).filter(
          (l: PurchaseOrderLineWithPart) => l.partId === ps.partId,
        ),
      );

      const prices = partLines.map(
        (l: PurchaseOrderLineWithPart) => l.unitPrice,
      );
      const avgPrice =
        prices.length > 0
          ? prices.reduce((a, b) => a + b, 0) / prices.length
          : 0;
      const priceStability = 100 - this.calculateStdDev(prices) * 10;

      // Find price changes
      let lastPriceChange: Date | null = null;
      let changePercent: number | null = null;
      if (partLines.length >= 2) {
        const sortedLines = [...partLines].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        const latestPrice = sortedLines[0].unitPrice;
        const previousPrice = sortedLines[1].unitPrice;
        if (previousPrice !== latestPrice) {
          lastPriceChange = new Date(sortedLines[0].createdAt);
          changePercent = ((latestPrice - previousPrice) / previousPrice) * 100;
        }
      }

      return {
        partId: ps.partId,
        partSku: ps.part.partNumber,
        currentPrice: ps.unitPrice,
        avgPrice: Math.round(avgPrice * 100) / 100,
        priceStability: Math.max(0, Math.round(priceStability)),
        lastPriceChange,
        changePercent: changePercent
          ? Math.round(changePercent * 10) / 10
          : null,
      };
    });
  }

  private detectPriceChanges(
    orders: PurchaseOrderWithLines[],
  ): PriceChangeEvent[] {
    const changes: PriceChangeEvent[] = [];
    const partPriceHistory = new Map<
      string,
      { date: Date; price: number; partSku: string }[]
    >();

    // Build price history per part
    orders.forEach((order) => {
      (order.lines || []).forEach((line: PurchaseOrderLineWithPart) => {
        const history = partPriceHistory.get(line.partId) || [];
        history.push({
          date: new Date(order.orderDate),
          price: line.unitPrice,
          partSku: line.part?.partNumber || "Unknown",
        });
        partPriceHistory.set(line.partId, history);
      });
    });

    // Detect changes
    partPriceHistory.forEach((history) => {
      if (history.length < 2) return;

      const sorted = history.sort(
        (a, b) => a.date.getTime() - b.date.getTime(),
      );
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (prev.price !== curr.price) {
          const changePercent = ((curr.price - prev.price) / prev.price) * 100;
          changes.push({
            date: curr.date,
            partSku: curr.partSku,
            oldPrice: prev.price,
            newPrice: curr.price,
            changePercent: Math.round(changePercent * 10) / 10,
            type: changePercent > 0 ? "increase" : "decrease",
          });
        }
      }
    });

    return changes.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  private calculateOrderFrequency(orders: PurchaseOrderWithLines[]): number {
    if (orders.length < 2) return 0;

    const sortedOrders = [...orders].sort(
      (a, b) =>
        new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime(),
    );

    let totalDays = 0;
    for (let i = 1; i < sortedOrders.length; i++) {
      const days = Math.ceil(
        (new Date(sortedOrders[i].orderDate).getTime() -
          new Date(sortedOrders[i - 1].orderDate).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      totalDays += days;
    }

    return totalDays / (sortedOrders.length - 1);
  }

  private calculatePartOrderDistribution(
    orders: PurchaseOrderWithLines[],
  ): PartOrderData[] {
    const partData = new Map<
      string,
      {
        partSku: string;
        orderCount: number;
        totalQuantity: number;
        totalSpend: number;
        lastOrderDate: Date;
      }
    >();

    orders.forEach((order) => {
      (order.lines || []).forEach((line: PurchaseOrderLineWithPart) => {
        const existing = partData.get(line.partId) || {
          partSku: line.part?.partNumber || "Unknown",
          orderCount: 0,
          totalQuantity: 0,
          totalSpend: 0,
          lastOrderDate: new Date(0),
        };

        existing.orderCount++;
        existing.totalQuantity += line.quantity;
        existing.totalSpend += line.lineTotal || line.quantity * line.unitPrice;
        if (new Date(order.orderDate) > existing.lastOrderDate) {
          existing.lastOrderDate = new Date(order.orderDate);
        }

        partData.set(line.partId, existing);
      });
    });

    return Array.from(partData.entries())
      .map(([partId, data]) => ({
        partId,
        partSku: data.partSku,
        orderCount: data.orderCount,
        totalQuantity: data.totalQuantity,
        avgQuantityPerOrder: Math.round(data.totalQuantity / data.orderCount),
        totalSpend: Math.round(data.totalSpend * 100) / 100,
        lastOrderDate: data.lastOrderDate,
      }))
      .sort((a, b) => b.orderCount - a.orderCount);
  }

  private calculateOrderTrend(
    orders: PurchaseOrderWithLines[],
    months: number,
  ): OrderTrendPoint[] {
    const trend: OrderTrendPoint[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const period = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;

      const monthOrders = orders.filter((o) => {
        const date = new Date(o.orderDate);
        return date >= monthStart && date <= monthEnd;
      });

      const totalSpend = monthOrders.reduce(
        (sum, o) => sum + (o.totalAmount || 0),
        0,
      );
      const avgOrderValue =
        monthOrders.length > 0 ? totalSpend / monthOrders.length : 0;

      // Calculate fulfillment for completed orders
      const completedOrders = monthOrders.filter((o) =>
        ["received", "completed"].includes(o.status),
      );
      const totalOrdered = completedOrders.reduce(
        (sum, o) =>
          sum +
          (o.lines || []).reduce(
            (s: number, l: PurchaseOrderLineWithPart) => s + l.quantity,
            0,
          ),
        0,
      );
      const totalReceived = completedOrders.reduce(
        (sum, o) =>
          sum +
          (o.lines || []).reduce(
            (s: number, l: PurchaseOrderLineWithPart) => s + l.receivedQty,
            0,
          ),
        0,
      );
      const fulfillmentRate =
        totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 100;

      trend.push({
        period,
        orderCount: monthOrders.length,
        totalSpend: Math.round(totalSpend * 100) / 100,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        fulfillmentRate: Math.round(fulfillmentRate * 10) / 10,
      });
    }

    return trend;
  }

  private isLeadTimeImproving(history: LeadTimePoint[]): boolean {
    if (history.length < 4) return false;

    // Compare first half vs second half variance
    const midpoint = Math.floor(history.length / 2);
    const firstHalf = history.slice(0, midpoint);
    const secondHalf = history.slice(midpoint);

    const firstHalfVariance =
      firstHalf.reduce((sum, h) => sum + Math.abs(h.variance || 0), 0) /
      firstHalf.length;
    const secondHalfVariance =
      secondHalf.reduce((sum, h) => sum + Math.abs(h.variance || 0), 0) /
      secondHalf.length;

    return secondHalfVariance < firstHalfVariance;
  }

  private calculatePartLeadTimes(
    partSuppliers: PartSupplierWithPart[],
    orders: PurchaseOrderWithLines[],
  ): PartLeadTimeData[] {
    return partSuppliers.map((ps) => {
      const partOrders = orders.filter((o) =>
        (o.lines || []).some(
          (l: PurchaseOrderLineWithPart) => l.partId === ps.partId,
        ),
      );

      const actualLeadTimes = partOrders.map((o) =>
        Math.ceil(
          (o.updatedAt.getTime() - o.orderDate.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );

      const avgActualLeadTime =
        actualLeadTimes.length > 0
          ? actualLeadTimes.reduce((a, b) => a + b, 0) / actualLeadTimes.length
          : ps.leadTimeDays;

      return {
        partId: ps.partId,
        partSku: ps.part.partNumber,
        quotedLeadTime: ps.leadTimeDays,
        avgActualLeadTime: Math.round(avgActualLeadTime * 10) / 10,
        variance: Math.round((avgActualLeadTime - ps.leadTimeDays) * 10) / 10,
        orderCount: partOrders.length,
      };
    });
  }

  private calculateCommunicationScore(
    avgNCRDays: number,
    avgCAPADays: number,
    fastResponseRate: number,
  ): number {
    // Base score from fast response rate
    let score = fastResponseRate;

    // Adjust for NCR resolution time (target: < 14 days)
    if (avgNCRDays <= 7) score += 10;
    else if (avgNCRDays <= 14) score += 5;
    else if (avgNCRDays > 30) score -= 10;

    // Adjust for CAPA closure time (target: < 30 days)
    if (avgCAPADays <= 14) score += 10;
    else if (avgCAPADays <= 30) score += 5;
    else if (avgCAPADays > 60) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  private calculateDataCompleteness(
    delivery: DeliveryPerformanceData | null,
    quality: QualityHistoryData | null,
    pricing: PricingTrendData | null,
    orders: OrderHistoryData | null,
    leadTime: LeadTimeHistoryData | null,
    response: ResponseMetricsData | null,
  ): number {
    let score = 0;
    let maxScore = 0;

    // Delivery data completeness
    maxScore += 20;
    if (delivery && delivery.summary.totalOrders > 0) {
      score += 20;
    } else if (delivery) {
      score += 5;
    }

    // Quality data completeness
    maxScore += 20;
    if (quality && quality.summary.totalLotsReceived > 0) {
      score += 20;
    } else if (quality) {
      score += 5;
    }

    // Pricing data completeness
    maxScore += 20;
    if (pricing && pricing.summary.totalSpend > 0) {
      score += 20;
    } else if (pricing) {
      score += 5;
    }

    // Order data completeness
    maxScore += 20;
    if (orders && orders.summary.totalOrders > 0) {
      score += 20;
    } else if (orders) {
      score += 5;
    }

    // Lead time data completeness
    maxScore += 10;
    if (leadTime && leadTime.leadTimeHistory.length > 0) {
      score += 10;
    } else if (leadTime) {
      score += 2;
    }

    // Response metrics completeness
    maxScore += 10;
    if (response && response.ncrResolutionHistory.length > 0) {
      score += 10;
    } else if (response) {
      score += 2;
    }

    return Math.round((score / maxScore) * 100);
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let extractorInstance: SupplierDataExtractor | null = null;

export function getSupplierDataExtractor(): SupplierDataExtractor {
  if (!extractorInstance) {
    extractorInstance = new SupplierDataExtractor();
  }
  return extractorInstance;
}
