// =============================================================================
// EARLY WARNING SYSTEM
// Proactive monitoring and alerting for supplier risks
// =============================================================================

import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/mrp-client";
import {
  SupplierDataExtractor,
  getSupplierDataExtractor,
} from "./supplier-data-extractor";
import { RiskCalculator, getRiskCalculator } from "./risk-calculator";

// =============================================================================
// PRISMA RESULT TYPES
// =============================================================================

/** Supplier with riskScore and partSuppliers (including parts) */
type SupplierWithRiskAndParts = Prisma.SupplierGetPayload<{
  include: {
    riskScore: true;
    partSuppliers: { include: { part: true } };
  };
}>;

/** PartSupplier entry from the supplier include */
type SupplierPartEntry = SupplierWithRiskAndParts["partSuppliers"][number];

// =============================================================================
// TYPES
// =============================================================================

export type AlertSeverity = "info" | "warning" | "critical" | "emergency";
export type AlertCategory =
  | "delivery"
  | "quality"
  | "financial"
  | "dependency"
  | "external"
  | "performance";
export type AlertStatus =
  | "active"
  | "acknowledged"
  | "resolved"
  | "escalated"
  | "dismissed";

export interface SupplierAlert {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  category: AlertCategory;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string;
  detectedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  acknowledgedBy: string | null;
  resolvedBy: string | null;
  metrics: AlertMetric[];
  affectedParts: {
    partId: string;
    partSku: string;
    partName: string;
    isCritical: boolean;
  }[];
  recommendedActions: string[];
  escalationPath: string[];
  relatedAlerts: string[];
}

export interface AlertMetric {
  name: string;
  currentValue: number;
  threshold: number;
  unit: string;
  trend: "improving" | "stable" | "declining";
  historicalValues: { date: Date; value: number }[];
}

export interface EarlyWarningSignal {
  type: string;
  description: string;
  severity: AlertSeverity;
  confidence: number;
  indicators: string[];
  timeframe: string;
}

export interface AlertSummary {
  generatedAt: Date;
  totalActiveAlerts: number;
  alertsBySeverity: Record<AlertSeverity, number>;
  alertsByCategory: Record<AlertCategory, number>;
  recentAlerts: SupplierAlert[];
  criticalSuppliers: {
    supplierId: string;
    supplierName: string;
    alertCount: number;
    highestSeverity: AlertSeverity;
  }[];
  trendAnalysis: {
    direction: "improving" | "stable" | "worsening";
    weeklyChange: number;
    monthlyChange: number;
  };
}

export interface MonitoringConfig {
  deliveryThresholds: {
    lateDeliveryPercent: number;
    onTimeRateDecline: number;
    consecutiveLateOrders: number;
  };
  qualityThresholds: {
    ncrCountPerMonth: number;
    acceptanceRateDecline: number;
    ppmThreshold: number;
    openNcrCount: number;
  };
  financialThresholds: {
    priceIncreasePercent: number;
    leadTimeIncreasePercent: number;
    orderFrequencyDecline: number;
  };
  performanceThresholds: {
    scoreDeclinePercent: number;
    gradeDropLevels: number;
  };
}

export interface WatchlistSupplier {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  country: string;
  watchReason: string;
  addedAt: Date;
  riskScore: number;
  activeAlerts: number;
  latestAlert: SupplierAlert | null;
  monitoringLevel: "standard" | "enhanced" | "critical";
  reviewDate: Date;
}

// =============================================================================
// DEFAULT THRESHOLDS
// =============================================================================

const DEFAULT_THRESHOLDS: MonitoringConfig = {
  deliveryThresholds: {
    lateDeliveryPercent: 15,
    onTimeRateDecline: 10,
    consecutiveLateOrders: 3,
  },
  qualityThresholds: {
    ncrCountPerMonth: 2,
    acceptanceRateDecline: 5,
    ppmThreshold: 2000,
    openNcrCount: 5,
  },
  financialThresholds: {
    priceIncreasePercent: 10,
    leadTimeIncreasePercent: 25,
    orderFrequencyDecline: 50,
  },
  performanceThresholds: {
    scoreDeclinePercent: 15,
    gradeDropLevels: 2,
  },
};

// =============================================================================
// EARLY WARNING SYSTEM CLASS
// =============================================================================

export class EarlyWarningSystem {
  private dataExtractor: SupplierDataExtractor;
  private riskCalculator: RiskCalculator;
  private config: MonitoringConfig;
  private alertCounter: number = 0;

  constructor(config?: Partial<MonitoringConfig>) {
    this.dataExtractor = getSupplierDataExtractor();
    this.riskCalculator = getRiskCalculator();
    this.config = { ...DEFAULT_THRESHOLDS, ...config };
  }

  /**
   * Run full monitoring scan for all active suppliers
   */
  async runMonitoringScan(): Promise<AlertSummary> {
    const suppliers = await prisma.supplier.findMany({
      where: { status: "active" },
      include: {
        riskScore: true,
        partSuppliers: {
          include: { part: true },
        },
      },
    });

    const allAlerts: SupplierAlert[] = [];

    for (const supplier of suppliers) {
      const alerts = await this.monitorSupplier(supplier.id);
      allAlerts.push(...alerts);
    }

    // Generate summary
    return this.generateAlertSummary(allAlerts);
  }

  /**
   * Monitor a specific supplier for warning signs
   */
  async monitorSupplier(supplierId: string): Promise<SupplierAlert[]> {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        riskScore: true,
        partSuppliers: {
          include: { part: true },
        },
      },
    });

    if (!supplier) return [];

    const alerts: SupplierAlert[] = [];

    // Check delivery performance
    const deliveryAlerts = await this.checkDeliveryWarnings(supplier);
    alerts.push(...deliveryAlerts);

    // Check quality metrics
    const qualityAlerts = await this.checkQualityWarnings(supplier);
    alerts.push(...qualityAlerts);

    // Check financial/pricing signals
    const financialAlerts = await this.checkFinancialWarnings(supplier);
    alerts.push(...financialAlerts);

    // Check dependency risks
    const dependencyAlerts = await this.checkDependencyWarnings(supplier);
    alerts.push(...dependencyAlerts);

    // Check performance trends
    const performanceAlerts = await this.checkPerformanceWarnings(supplier);
    alerts.push(...performanceAlerts);

    return alerts;
  }

  /**
   * Get early warning signals for a supplier
   */
  async getEarlyWarningSignals(
    supplierId: string,
  ): Promise<EarlyWarningSignal[]> {
    const signals: EarlyWarningSignal[] = [];

    // Get supplier data
    const [delivery, quality, pricing, leadTime] = await Promise.all([
      this.dataExtractor.extractDeliveryPerformance(supplierId, 3),
      this.dataExtractor.extractQualityHistory(supplierId, 3),
      this.dataExtractor.extractPricingTrends(supplierId, 6),
      this.dataExtractor.extractLeadTimeHistory(supplierId, 3),
    ]);

    // Analyze delivery signals
    if (delivery) {
      const recentTrend = delivery.trend.slice(-3);
      const avgOnTimeRate =
        recentTrend.reduce((sum, t) => sum + t.onTimeRate, 0) /
        recentTrend.length;

      if (
        avgOnTimeRate < 85 &&
        recentTrend[recentTrend.length - 1]?.onTimeRate <
          recentTrend[0]?.onTimeRate
      ) {
        signals.push({
          type: "delivery_decline",
          description: "Declining on-time delivery performance",
          severity: avgOnTimeRate < 75 ? "warning" : "info",
          confidence: 0.8,
          indicators: [
            `Current on-time rate: ${Math.round(avgOnTimeRate)}%`,
            "Downward trend over last 3 months",
          ],
          timeframe: "Next 30 days",
        });
      }
    }

    // Analyze quality signals
    if (quality) {
      const recentTrend = quality.qualityTrend.slice(-3);
      const avgAcceptance =
        recentTrend.reduce((sum, t) => sum + t.acceptanceRate, 0) /
        recentTrend.length;

      if (quality.summary.openNCRs > 3) {
        signals.push({
          type: "quality_backlog",
          description: "Growing backlog of open NCRs",
          severity: quality.summary.openNCRs > 5 ? "warning" : "info",
          confidence: 0.9,
          indicators: [
            `${quality.summary.openNCRs} open NCRs`,
            `Avg resolution: ${quality.summary.avgDaysToResolveNCR} days`,
          ],
          timeframe: "Immediate attention needed",
        });
      }

      if (avgAcceptance < 95 && quality.summary.ppm > 1000) {
        signals.push({
          type: "quality_deterioration",
          description: "Quality metrics showing deterioration",
          severity: quality.summary.ppm > 3000 ? "critical" : "warning",
          confidence: 0.85,
          indicators: [
            `Acceptance rate: ${Math.round(avgAcceptance)}%`,
            `PPM: ${quality.summary.ppm}`,
          ],
          timeframe: "Next 60 days",
        });
      }
    }

    // Analyze pricing signals
    if (pricing && pricing.summary.priceChangePercent > 5) {
      signals.push({
        type: "price_pressure",
        description: "Significant price increases detected",
        severity: pricing.summary.priceChangePercent > 15 ? "warning" : "info",
        confidence: 0.75,
        indicators: [
          `Price change: +${Math.round(pricing.summary.priceChangePercent)}%`,
          `${pricing.recentChanges.filter((c) => c.type === "increase").length} price increases`,
        ],
        timeframe: "Next 90 days",
      });
    }

    // Analyze lead time signals
    if (leadTime && leadTime.summary.leadTimeVariancePercent > 20) {
      signals.push({
        type: "lead_time_volatility",
        description: "Increasing lead time variance",
        severity:
          leadTime.summary.leadTimeVariancePercent > 40 ? "warning" : "info",
        confidence: 0.7,
        indicators: [
          `Variance: ${Math.round(leadTime.summary.leadTimeVariancePercent)}%`,
          `Quoted: ${leadTime.summary.quotedLeadTimeDays} days, Actual: ${Math.round(leadTime.summary.avgActualLeadTime)} days`,
        ],
        timeframe: "Next 30 days",
      });
    }

    return signals.sort((a, b) => {
      const severityOrder = { emergency: 0, critical: 1, warning: 2, info: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Get current alert summary
   */
  async getAlertSummary(): Promise<AlertSummary> {
    const allAlerts = await this.runMonitoringScan();
    return allAlerts;
  }

  /**
   * Get suppliers on watchlist
   */
  async getWatchlist(): Promise<WatchlistSupplier[]> {
    const suppliers = await prisma.supplier.findMany({
      where: { status: "active" },
      include: {
        riskScore: true,
        partSuppliers: {
          include: { part: true },
        },
      },
    });

    const watchlist: WatchlistSupplier[] = [];

    for (const supplier of suppliers) {
      const alerts = await this.monitorSupplier(supplier.id);
      const riskScore = supplier.riskScore?.overallScore || 70;

      // Add to watchlist if has alerts or low score
      if (alerts.length > 0 || riskScore < 60) {
        const criticalAlerts = alerts.filter(
          (a) => a.severity === "critical" || a.severity === "emergency",
        );
        const warningAlerts = alerts.filter((a) => a.severity === "warning");

        let monitoringLevel: WatchlistSupplier["monitoringLevel"] = "standard";
        if (criticalAlerts.length > 0 || riskScore < 50) {
          monitoringLevel = "critical";
        } else if (warningAlerts.length > 0 || riskScore < 70) {
          monitoringLevel = "enhanced";
        }

        const reviewDate = new Date();
        reviewDate.setDate(
          reviewDate.getDate() +
            (monitoringLevel === "critical"
              ? 7
              : monitoringLevel === "enhanced"
                ? 14
                : 30),
        );

        watchlist.push({
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierCode: supplier.code,
          country: supplier.country,
          watchReason: this.determineWatchReason(alerts, riskScore),
          addedAt: new Date(),
          riskScore: 100 - riskScore, // Convert score to risk
          activeAlerts: alerts.length,
          latestAlert: alerts[0] || null,
          monitoringLevel,
          reviewDate,
        });
      }
    }

    return watchlist.sort((a, b) => b.riskScore - a.riskScore);
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(
    alertId: string,
    acknowledgedBy: string,
  ): Promise<SupplierAlert | null> {
    // In production, this would update a database record
    // For now, we return a mock updated alert
    return null;
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(
    alertId: string,
    resolvedBy: string,
    resolution: string,
  ): Promise<SupplierAlert | null> {
    // In production, this would update a database record
    return null;
  }

  // =============================================================================
  // PRIVATE METHODS - WARNING CHECKS
  // =============================================================================

  private async checkDeliveryWarnings(
    supplier: SupplierWithRiskAndParts,
  ): Promise<SupplierAlert[]> {
    const alerts: SupplierAlert[] = [];
    const delivery = await this.dataExtractor.extractDeliveryPerformance(
      supplier.id,
      3,
    );

    if (!delivery) return alerts;

    // Check late delivery rate
    const lateRate =
      (delivery.summary.lateOrders /
        Math.max(delivery.summary.totalOrders, 1)) *
      100;
    if (lateRate > this.config.deliveryThresholds.lateDeliveryPercent) {
      alerts.push(
        this.createAlert(
          supplier,
          "delivery",
          lateRate > 30 ? "critical" : "warning",
          "High Late Delivery Rate",
          `${Math.round(lateRate)}% of deliveries are late (threshold: ${this.config.deliveryThresholds.lateDeliveryPercent}%)`,
          [
            {
              name: "Late Delivery Rate",
              currentValue: Math.round(lateRate),
              threshold: this.config.deliveryThresholds.lateDeliveryPercent,
              unit: "%",
              trend: "declining",
              historicalValues: [],
            },
          ],
          [
            "Expedite pending orders",
            "Review logistics arrangements",
            "Schedule supplier meeting",
          ],
        ),
      );
    }

    // Check on-time rate decline
    const recentTrend = delivery.trend.slice(-3);
    if (recentTrend.length >= 2) {
      const decline =
        recentTrend[0].onTimeRate -
        recentTrend[recentTrend.length - 1].onTimeRate;
      if (decline > this.config.deliveryThresholds.onTimeRateDecline) {
        alerts.push(
          this.createAlert(
            supplier,
            "delivery",
            decline > 20 ? "critical" : "warning",
            "Declining On-Time Performance",
            `On-time rate dropped by ${Math.round(decline)}% over last 3 months`,
            [
              {
                name: "On-Time Rate Decline",
                currentValue: Math.round(decline),
                threshold: this.config.deliveryThresholds.onTimeRateDecline,
                unit: "%",
                trend: "declining",
                historicalValues: recentTrend.map((t) => ({
                  date: new Date(),
                  value: t.onTimeRate,
                })),
              },
            ],
            [
              "Investigate root causes",
              "Review capacity constraints",
              "Develop improvement plan",
            ],
          ),
        );
      }
    }

    return alerts;
  }

  private async checkQualityWarnings(
    supplier: SupplierWithRiskAndParts,
  ): Promise<SupplierAlert[]> {
    const alerts: SupplierAlert[] = [];
    const quality = await this.dataExtractor.extractQualityHistory(
      supplier.id,
      3,
    );

    if (!quality) return alerts;

    // Check NCR count
    const monthlyNCRs = quality.summary.totalNCRs / 3;
    if (monthlyNCRs > this.config.qualityThresholds.ncrCountPerMonth) {
      alerts.push(
        this.createAlert(
          supplier,
          "quality",
          monthlyNCRs > 5 ? "critical" : "warning",
          "High NCR Rate",
          `Averaging ${Math.round(monthlyNCRs * 10) / 10} NCRs per month (threshold: ${this.config.qualityThresholds.ncrCountPerMonth})`,
          [
            {
              name: "Monthly NCR Rate",
              currentValue: Math.round(monthlyNCRs * 10) / 10,
              threshold: this.config.qualityThresholds.ncrCountPerMonth,
              unit: "NCRs/month",
              trend: "declining",
              historicalValues: [],
            },
          ],
          [
            "Conduct quality audit",
            "Review inspection criteria",
            "Request corrective action plan",
          ],
        ),
      );
    }

    // Check open NCRs
    if (quality.summary.openNCRs > this.config.qualityThresholds.openNcrCount) {
      alerts.push(
        this.createAlert(
          supplier,
          "quality",
          quality.summary.openNCRs > 8 ? "critical" : "warning",
          "Open NCR Backlog",
          `${quality.summary.openNCRs} open NCRs pending resolution`,
          [
            {
              name: "Open NCRs",
              currentValue: quality.summary.openNCRs,
              threshold: this.config.qualityThresholds.openNcrCount,
              unit: "NCRs",
              trend: "declining",
              historicalValues: [],
            },
          ],
          [
            "Expedite NCR resolution",
            "Escalate to supplier management",
            "Review disposition process",
          ],
        ),
      );
    }

    // Check PPM
    if (quality.summary.ppm > this.config.qualityThresholds.ppmThreshold) {
      alerts.push(
        this.createAlert(
          supplier,
          "quality",
          quality.summary.ppm > 5000 ? "critical" : "warning",
          "High Defect PPM",
          `PPM at ${quality.summary.ppm} (threshold: ${this.config.qualityThresholds.ppmThreshold})`,
          [
            {
              name: "Defect PPM",
              currentValue: quality.summary.ppm,
              threshold: this.config.qualityThresholds.ppmThreshold,
              unit: "ppm",
              trend: "declining",
              historicalValues: [],
            },
          ],
          [
            "Root cause analysis required",
            "Implement enhanced inspection",
            "Consider supplier qualification review",
          ],
        ),
      );
    }

    return alerts;
  }

  private async checkFinancialWarnings(
    supplier: SupplierWithRiskAndParts,
  ): Promise<SupplierAlert[]> {
    const alerts: SupplierAlert[] = [];
    const pricing = await this.dataExtractor.extractPricingTrends(
      supplier.id,
      6,
    );
    const leadTime = await this.dataExtractor.extractLeadTimeHistory(
      supplier.id,
      6,
    );

    // Check price increases
    if (
      pricing &&
      pricing.summary.priceChangePercent >
        this.config.financialThresholds.priceIncreasePercent
    ) {
      alerts.push(
        this.createAlert(
          supplier,
          "financial",
          pricing.summary.priceChangePercent > 20 ? "critical" : "warning",
          "Significant Price Increase",
          `Prices increased by ${Math.round(pricing.summary.priceChangePercent)}% over 6 months`,
          [
            {
              name: "Price Change",
              currentValue: Math.round(pricing.summary.priceChangePercent),
              threshold: this.config.financialThresholds.priceIncreasePercent,
              unit: "%",
              trend: "declining",
              historicalValues: [],
            },
          ],
          [
            "Negotiate pricing terms",
            "Evaluate alternative suppliers",
            "Review contract terms",
          ],
        ),
      );
    }

    // Check lead time increase
    if (
      leadTime &&
      leadTime.summary.leadTimeVariancePercent >
        this.config.financialThresholds.leadTimeIncreasePercent
    ) {
      alerts.push(
        this.createAlert(
          supplier,
          "financial",
          leadTime.summary.leadTimeVariancePercent > 50
            ? "critical"
            : "warning",
          "Lead Time Increase",
          `Lead time variance at ${Math.round(leadTime.summary.leadTimeVariancePercent)}% above quoted`,
          [
            {
              name: "Lead Time Variance",
              currentValue: Math.round(
                leadTime.summary.leadTimeVariancePercent,
              ),
              threshold:
                this.config.financialThresholds.leadTimeIncreasePercent,
              unit: "%",
              trend: "declining",
              historicalValues: [],
            },
          ],
          [
            "Review logistics arrangements",
            "Negotiate updated lead times",
            "Adjust safety stock",
          ],
        ),
      );
    }

    return alerts;
  }

  private async checkDependencyWarnings(
    supplier: SupplierWithRiskAndParts,
  ): Promise<SupplierAlert[]> {
    const alerts: SupplierAlert[] = [];

    // Count single-source critical parts
    const singleSourceCritical = supplier.partSuppliers.filter(
      (ps: SupplierPartEntry) => ps.part.isCritical,
    );

    if (singleSourceCritical.length > 0) {
      const affectedParts = singleSourceCritical.map(
        (ps: SupplierPartEntry) => ({
          partId: ps.partId,
          partSku: ps.part.partNumber,
          partName: ps.part.name,
          isCritical: ps.part.isCritical,
        }),
      );

      alerts.push(
        this.createAlert(
          supplier,
          "dependency",
          singleSourceCritical.length > 3 ? "critical" : "warning",
          "Single Source Critical Parts",
          `${singleSourceCritical.length} critical parts have no alternate supplier`,
          [],
          [
            "Qualify alternate suppliers",
            "Increase safety stock",
            "Develop contingency plan",
          ],
          affectedParts,
        ),
      );
    }

    // Check high part count concentration
    const totalParts = supplier.partSuppliers.length;
    if (totalParts > 15) {
      alerts.push(
        this.createAlert(
          supplier,
          "dependency",
          totalParts > 25 ? "warning" : "info",
          "High Part Concentration",
          `Supplier provides ${totalParts} parts - high concentration risk`,
          [
            {
              name: "Part Count",
              currentValue: totalParts,
              threshold: 15,
              unit: "parts",
              trend: "stable",
              historicalValues: [],
            },
          ],
          [
            "Develop alternate sources for key parts",
            "Assess business continuity risk",
          ],
        ),
      );
    }

    return alerts;
  }

  private async checkPerformanceWarnings(
    supplier: SupplierWithRiskAndParts,
  ): Promise<SupplierAlert[]> {
    const alerts: SupplierAlert[] = [];

    if (!supplier.riskScore) return alerts;

    const currentScore = supplier.riskScore.overallScore;
    const previousScore = supplier.riskScore.previousScore;

    // Check score decline
    if (previousScore) {
      const decline = previousScore - currentScore;
      const declinePercent = (decline / previousScore) * 100;

      if (
        declinePercent > this.config.performanceThresholds.scoreDeclinePercent
      ) {
        alerts.push(
          this.createAlert(
            supplier,
            "performance",
            declinePercent > 25 ? "critical" : "warning",
            "Performance Score Decline",
            `Score dropped from ${previousScore} to ${currentScore} (${Math.round(declinePercent)}% decline)`,
            [
              {
                name: "Score Decline",
                currentValue: Math.round(declinePercent),
                threshold:
                  this.config.performanceThresholds.scoreDeclinePercent,
                unit: "%",
                trend: "declining",
                historicalValues: [],
              },
            ],
            [
              "Conduct supplier performance review",
              "Identify improvement areas",
              "Develop action plan",
            ],
          ),
        );
      }
    }

    // Check if score is in critical range
    if (currentScore < 60) {
      alerts.push(
        this.createAlert(
          supplier,
          "performance",
          currentScore < 50 ? "critical" : "warning",
          "Low Performance Score",
          `Overall score at ${currentScore} - below acceptable threshold`,
          [
            {
              name: "Performance Score",
              currentValue: currentScore,
              threshold: 60,
              unit: "pts",
              trend: "declining",
              historicalValues: [],
            },
          ],
          [
            "Urgent supplier review required",
            "Develop improvement plan",
            "Consider alternate sourcing",
          ],
        ),
      );
    }

    return alerts;
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  private createAlert(
    supplier: SupplierWithRiskAndParts,
    category: AlertCategory,
    severity: AlertSeverity,
    title: string,
    description: string,
    metrics: AlertMetric[],
    recommendedActions: string[],
    affectedParts?: {
      partId: string;
      partSku: string;
      partName: string;
      isCritical: boolean;
    }[],
  ): SupplierAlert {
    this.alertCounter++;
    return {
      id: `alert-${Date.now()}-${this.alertCounter}`,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      category,
      severity,
      status: "active",
      title,
      description,
      detectedAt: new Date(),
      acknowledgedAt: null,
      resolvedAt: null,
      acknowledgedBy: null,
      resolvedBy: null,
      metrics,
      affectedParts: affectedParts || [],
      recommendedActions,
      escalationPath: this.getEscalationPath(severity),
      relatedAlerts: [],
    };
  }

  private getEscalationPath(severity: AlertSeverity): string[] {
    switch (severity) {
      case "emergency":
        return ["Supply Chain Manager", "VP Operations", "CEO"];
      case "critical":
        return ["Supply Chain Manager", "VP Operations"];
      case "warning":
        return ["Procurement Lead", "Supply Chain Manager"];
      case "info":
      default:
        return ["Procurement Lead"];
    }
  }

  private generateAlertSummary(alerts: SupplierAlert[]): AlertSummary {
    const activeAlerts = alerts.filter((a) => a.status === "active");

    // Count by severity
    const alertsBySeverity: Record<AlertSeverity, number> = {
      emergency: 0,
      critical: 0,
      warning: 0,
      info: 0,
    };
    activeAlerts.forEach((a) => {
      alertsBySeverity[a.severity]++;
    });

    // Count by category
    const alertsByCategory: Record<AlertCategory, number> = {
      delivery: 0,
      quality: 0,
      financial: 0,
      dependency: 0,
      external: 0,
      performance: 0,
    };
    activeAlerts.forEach((a) => {
      alertsByCategory[a.category]++;
    });

    // Group by supplier for critical suppliers
    const supplierAlerts = new Map<
      string,
      { name: string; alerts: SupplierAlert[] }
    >();
    activeAlerts.forEach((a) => {
      const existing = supplierAlerts.get(a.supplierId) || {
        name: a.supplierName,
        alerts: [],
      };
      existing.alerts.push(a);
      supplierAlerts.set(a.supplierId, existing);
    });

    const criticalSuppliers = Array.from(supplierAlerts.entries())
      .map(([supplierId, data]) => {
        const severities = data.alerts.map((a) => a.severity);
        let highestSeverity: AlertSeverity = "info";
        if (severities.includes("emergency")) highestSeverity = "emergency";
        else if (severities.includes("critical")) highestSeverity = "critical";
        else if (severities.includes("warning")) highestSeverity = "warning";

        return {
          supplierId,
          supplierName: data.name,
          alertCount: data.alerts.length,
          highestSeverity,
        };
      })
      .sort((a, b) => {
        const severityOrder = {
          emergency: 0,
          critical: 1,
          warning: 2,
          info: 3,
        };
        return (
          severityOrder[a.highestSeverity] - severityOrder[b.highestSeverity]
        );
      })
      .slice(0, 10);

    return {
      generatedAt: new Date(),
      totalActiveAlerts: activeAlerts.length,
      alertsBySeverity,
      alertsByCategory,
      recentAlerts: activeAlerts.slice(0, 20),
      criticalSuppliers,
      trendAnalysis: {
        direction: "stable",
        weeklyChange: 0,
        monthlyChange: 0,
      },
    };
  }

  private determineWatchReason(
    alerts: SupplierAlert[],
    riskScore: number,
  ): string {
    if (
      alerts.some(
        (a) => a.severity === "emergency" || a.severity === "critical",
      )
    ) {
      return "Critical alerts active";
    }
    if (riskScore < 50) {
      return "Very low performance score";
    }
    if (alerts.some((a) => a.category === "dependency")) {
      return "Single source dependency";
    }
    if (alerts.some((a) => a.category === "quality")) {
      return "Quality concerns";
    }
    if (riskScore < 70) {
      return "Below average performance";
    }
    return "Active warnings";
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let systemInstance: EarlyWarningSystem | null = null;

export function getEarlyWarningSystem(
  config?: Partial<MonitoringConfig>,
): EarlyWarningSystem {
  if (!systemInstance) {
    systemInstance = new EarlyWarningSystem(config);
  }
  return systemInstance;
}
