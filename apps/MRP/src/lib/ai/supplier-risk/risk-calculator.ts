// =============================================================================
// RISK CALCULATOR
// Multi-factor risk scoring for suppliers and supply chain
// =============================================================================

import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/mrp-client";
import {
  SupplierPerformanceScorer,
  getSupplierPerformanceScorer,
  SupplierScorecard,
} from "./supplier-performance-scorer";
import {
  DependencyAnalyzer,
  getDependencyAnalyzer,
  DependencyAnalysis,
} from "./dependency-analyzer";

// =============================================================================
// PRISMA RESULT TYPES
// =============================================================================

/** Supplier with partSuppliers (with nested part+partSuppliers), purchase orders, and risk score */
type SupplierWithDependencies = Prisma.SupplierGetPayload<{
  include: {
    partSuppliers: {
      include: {
        part: {
          include: { partSuppliers: true };
        };
      };
    };
    purchaseOrders: true;
    riskScore: true;
  };
}>;

/** PartSupplier with nested part that has partSuppliers */
type PartSupplierWithPartAndSuppliers =
  SupplierWithDependencies["partSuppliers"][number];

/** A purchase order from the supplier context */
type SupplierPurchaseOrder = SupplierWithDependencies["purchaseOrders"][number];

/** Supplier with partSuppliers and purchase orders but no riskScore (for scenario analysis) */
type SupplierWithoutRiskScore = Prisma.SupplierGetPayload<{
  include: {
    partSuppliers: {
      include: {
        part: {
          include: { partSuppliers: true };
        };
      };
    };
    purchaseOrders: true;
  };
}>;

// =============================================================================
// TYPES
// =============================================================================

export interface SupplierRiskAssessment {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  country: string;
  category: string | null;
  assessmentDate: Date;
  overallRiskScore: number;
  riskLevel: RiskLevel;
  riskFactors: RiskFactorBreakdown;
  performanceScore: number;
  dependencyScore: number;
  externalRiskScore: number;
  trend: RiskTrend;
  historicalRisk: RiskHistoryPoint[];
  mitigationStatus: MitigationStatus;
  recommendations: RiskRecommendation[];
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskFactorBreakdown {
  performance: {
    score: number;
    weight: number;
    factors: RiskFactor[];
  };
  dependency: {
    score: number;
    weight: number;
    factors: RiskFactor[];
  };
  external: {
    score: number;
    weight: number;
    factors: RiskFactor[];
  };
  financial: {
    score: number;
    weight: number;
    factors: RiskFactor[];
  };
}

export interface RiskFactor {
  name: string;
  score: number;
  impact: "low" | "medium" | "high";
  description: string;
}

export interface RiskTrend {
  direction: "improving" | "stable" | "declining";
  changePercent: number;
  previousScore: number | null;
  projectedScore: number;
}

export interface RiskHistoryPoint {
  period: string;
  riskScore: number;
  riskLevel: RiskLevel;
  keyEvents: string[];
}

export interface MitigationStatus {
  hasAlternateSupplier: boolean;
  hasSafetyStock: boolean;
  hasLongTermContract: boolean;
  lastAuditDate: Date | null;
  auditScore: number | null;
  mitigationScore: number;
}

export interface RiskRecommendation {
  priority: "critical" | "high" | "medium" | "low";
  category: "immediate" | "short_term" | "long_term";
  action: string;
  expectedImpact: number;
  estimatedCost: "low" | "medium" | "high";
  deadline: string;
}

export interface SupplyChainRiskProfile {
  generatedAt: Date;
  periodMonths: number;
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  riskBreakdown: {
    supplierPerformance: number;
    concentration: number;
    geographic: number;
    singleSource: number;
    external: number;
  };
  criticalSuppliers: CriticalSupplierRisk[];
  riskTrend: { period: string; score: number }[];
  topRisks: SupplyChainRisk[];
  mitigationPlan: MitigationPlanItem[];
  metrics: SupplyChainMetrics;
}

export interface CriticalSupplierRisk {
  supplierId: string;
  supplierName: string;
  riskScore: number;
  riskLevel: RiskLevel;
  spendPercent: number;
  criticalParts: number;
  singleSourceParts: number;
  topRiskFactors: string[];
}

export interface SupplyChainRisk {
  id: string;
  title: string;
  description: string;
  riskScore: number;
  riskLevel: RiskLevel;
  category:
    | "supplier"
    | "geographic"
    | "concentration"
    | "quality"
    | "external";
  affectedParts: number;
  estimatedImpact: string;
  mitigationStatus: "not_started" | "in_progress" | "completed";
}

export interface MitigationPlanItem {
  id: string;
  riskId: string;
  action: string;
  owner: string | null;
  dueDate: Date | null;
  status: "pending" | "in_progress" | "completed" | "overdue";
  priority: "critical" | "high" | "medium" | "low";
  progress: number;
}

export interface SupplyChainMetrics {
  totalActiveSuppliers: number;
  avgSupplierRiskScore: number;
  suppliersAtRisk: number;
  singleSourcePartsPercent: number;
  geographicDiversityScore: number;
  overallResilienceScore: number;
}

export interface RiskScenario {
  name: string;
  description: string;
  probability: "low" | "medium" | "high";
  impact: "low" | "medium" | "high" | "critical";
  affectedSuppliers: string[];
  affectedParts: number;
  estimatedRecoveryDays: number;
  financialImpact: {
    minimum: number;
    maximum: number;
    expected: number;
  };
  mitigations: string[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const RISK_WEIGHTS = {
  performance: 0.35,
  dependency: 0.3,
  external: 0.2,
  financial: 0.15,
};

const EXTERNAL_RISK_FACTORS: Record<string, number> = {
  // Country risk scores (higher = more risk)
  China: 35,
  Vietnam: 25,
  India: 30,
  Mexico: 20,
  Taiwan: 40,
  "South Korea": 15,
  Japan: 10,
  Germany: 5,
  USA: 5,
  Canada: 5,
};

// =============================================================================
// RISK CALCULATOR CLASS
// =============================================================================

export class RiskCalculator {
  private performanceScorer: SupplierPerformanceScorer;
  private dependencyAnalyzer: DependencyAnalyzer;

  constructor() {
    this.performanceScorer = getSupplierPerformanceScorer();
    this.dependencyAnalyzer = getDependencyAnalyzer();
  }

  /**
   * Calculate comprehensive risk assessment for a supplier
   */
  async calculateSupplierRisk(
    supplierId: string,
    months: number = 12,
  ): Promise<SupplierRiskAssessment | null> {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        partSuppliers: {
          include: {
            part: {
              include: { partSuppliers: true },
            },
          },
        },
        purchaseOrders: {
          where: { orderDate: { gte: this.getStartDate(months) } },
        },
        riskScore: true,
      },
    });

    if (!supplier) return null;

    // Get performance scorecard
    const scorecard = await this.performanceScorer.generateScorecard(
      supplierId,
      months,
    );

    // Calculate component scores
    const performanceRisk = this.calculatePerformanceRisk(scorecard);
    const dependencyRisk = this.calculateDependencyRisk(supplier);
    const externalRisk = this.calculateExternalRisk(supplier);
    const financialRisk = this.calculateFinancialRisk(supplier, months);

    // Calculate overall risk score
    const overallRiskScore =
      performanceRisk.score * RISK_WEIGHTS.performance +
      dependencyRisk.score * RISK_WEIGHTS.dependency +
      externalRisk.score * RISK_WEIGHTS.external +
      financialRisk.score * RISK_WEIGHTS.financial;

    const riskLevel = this.determineRiskLevel(overallRiskScore);

    // Get trend
    const trend = this.calculateRiskTrend(supplier.riskScore, overallRiskScore);

    // Get historical risk
    const historicalRisk = this.generateRiskHistory(overallRiskScore, months);

    // Calculate mitigation status
    const mitigationStatus = this.calculateMitigationStatus(supplier);

    // Generate recommendations
    const recommendations = this.generateRiskRecommendations(
      performanceRisk,
      dependencyRisk,
      externalRisk,
      financialRisk,
      riskLevel,
    );

    return {
      supplierId,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      country: supplier.country,
      category: supplier.category,
      assessmentDate: new Date(),
      overallRiskScore: Math.round(overallRiskScore),
      riskLevel,
      riskFactors: {
        performance: performanceRisk,
        dependency: dependencyRisk,
        external: externalRisk,
        financial: financialRisk,
      },
      performanceScore: 100 - performanceRisk.score,
      dependencyScore: 100 - dependencyRisk.score,
      externalRiskScore: externalRisk.score,
      trend,
      historicalRisk,
      mitigationStatus,
      recommendations,
    };
  }

  /**
   * Calculate supply chain-wide risk profile
   */
  async calculateSupplyChainRisk(
    months: number = 12,
  ): Promise<SupplyChainRiskProfile> {
    // Get dependency analysis
    const dependencyAnalysis =
      await this.dependencyAnalyzer.analyzeDependencies(months);

    // Get all active suppliers
    const suppliers = await prisma.supplier.findMany({
      where: { status: "active" },
      include: {
        riskScore: true,
        partSuppliers: {
          include: { part: { include: { partSuppliers: true } } },
        },
        purchaseOrders: {
          where: { orderDate: { gte: this.getStartDate(months) } },
        },
      },
    });

    // Calculate risk for each supplier
    const supplierRisks: CriticalSupplierRisk[] = [];
    let totalRiskScore = 0;
    let suppliersAtRisk = 0;

    for (const supplier of suppliers) {
      const assessment = await this.calculateSupplierRisk(supplier.id, months);
      if (assessment) {
        totalRiskScore += assessment.overallRiskScore;
        if (
          assessment.riskLevel === "high" ||
          assessment.riskLevel === "critical"
        ) {
          suppliersAtRisk++;
        }

        // Calculate spend percent
        const totalSpend = suppliers.reduce(
          (sum, s) =>
            sum +
            s.purchaseOrders.reduce(
              (pSum, po) => pSum + (po.totalAmount || 0),
              0,
            ),
          0,
        );
        const supplierSpend = supplier.purchaseOrders.reduce(
          (sum, po) => sum + (po.totalAmount || 0),
          0,
        );
        const spendPercent =
          totalSpend > 0 ? (supplierSpend / totalSpend) * 100 : 0;

        // Count critical and single-source parts
        const criticalParts = supplier.partSuppliers.filter(
          (ps) => ps.part.isCritical,
        ).length;
        const singleSourceParts = supplier.partSuppliers.filter(
          (ps) => ps.part.partSuppliers.length === 1,
        ).length;

        if (
          assessment.riskLevel !== "low" ||
          criticalParts > 0 ||
          spendPercent > 10
        ) {
          supplierRisks.push({
            supplierId: supplier.id,
            supplierName: supplier.name,
            riskScore: assessment.overallRiskScore,
            riskLevel: assessment.riskLevel,
            spendPercent: Math.round(spendPercent * 10) / 10,
            criticalParts,
            singleSourceParts,
            topRiskFactors: this.extractTopRiskFactors(assessment),
          });
        }
      }
    }

    // Sort by risk score
    supplierRisks.sort((a, b) => b.riskScore - a.riskScore);

    // Calculate overall metrics
    const avgSupplierRiskScore =
      suppliers.length > 0 ? totalRiskScore / suppliers.length : 0;
    const singleSourcePartsPercent =
      dependencyAnalysis.summary.singleSourcePercent;
    const geographicDiversityScore =
      100 - dependencyAnalysis.geographicRisk.overallScore;

    // Calculate overall supply chain risk
    const overallRiskScore = this.calculateOverallSupplyChainRisk(
      avgSupplierRiskScore,
      dependencyAnalysis.concentrationRisk.overallScore,
      dependencyAnalysis.geographicRisk.overallScore,
      singleSourcePartsPercent,
    );

    // Generate top risks
    const topRisks = this.generateTopSupplyChainRisks(
      dependencyAnalysis,
      supplierRisks,
    );

    // Generate mitigation plan
    const mitigationPlan = this.generateMitigationPlan(topRisks);

    // Generate risk trend
    const riskTrend = this.generateSupplyChainRiskTrend(
      overallRiskScore,
      months,
    );

    return {
      generatedAt: new Date(),
      periodMonths: months,
      overallRiskScore: Math.round(overallRiskScore),
      overallRiskLevel: this.determineRiskLevel(overallRiskScore),
      riskBreakdown: {
        supplierPerformance: Math.round(avgSupplierRiskScore),
        concentration: Math.round(
          dependencyAnalysis.concentrationRisk.overallScore,
        ),
        geographic: Math.round(dependencyAnalysis.geographicRisk.overallScore),
        singleSource: Math.round(singleSourcePartsPercent),
        external: Math.round(this.calculateAverageExternalRisk(suppliers)),
      },
      criticalSuppliers: supplierRisks.slice(0, 10),
      riskTrend,
      topRisks,
      mitigationPlan,
      metrics: {
        totalActiveSuppliers: suppliers.length,
        avgSupplierRiskScore: Math.round(avgSupplierRiskScore),
        suppliersAtRisk,
        singleSourcePartsPercent:
          Math.round(singleSourcePartsPercent * 10) / 10,
        geographicDiversityScore: Math.round(geographicDiversityScore),
        overallResilienceScore: Math.round(100 - overallRiskScore),
      },
    };
  }

  /**
   * Run risk scenarios analysis
   */
  async analyzeRiskScenarios(): Promise<RiskScenario[]> {
    const scenarios: RiskScenario[] = [];

    // Get current supply chain data
    const suppliers = await prisma.supplier.findMany({
      where: { status: "active" },
      include: {
        partSuppliers: {
          include: { part: { include: { partSuppliers: true } } },
        },
        purchaseOrders: {
          where: { orderDate: { gte: this.getStartDate(6) } },
        },
      },
    });

    // Scenario 1: Top supplier failure
    const topSupplier = this.findTopSupplier(suppliers);
    if (topSupplier) {
      const affectedParts = topSupplier.partSuppliers.length;
      const singleSourceParts = topSupplier.partSuppliers.filter(
        (ps: PartSupplierWithPartAndSuppliers) =>
          ps.part.partSuppliers.length === 1,
      ).length;

      scenarios.push({
        name: "Top Supplier Failure",
        description: `Complete loss of ${topSupplier.name} as a supplier`,
        probability: "low",
        impact: singleSourceParts > 0 ? "critical" : "high",
        affectedSuppliers: [topSupplier.id],
        affectedParts,
        estimatedRecoveryDays: singleSourceParts > 0 ? 90 : 30,
        financialImpact: this.estimateFinancialImpact(topSupplier, suppliers),
        mitigations: [
          "Qualify alternate suppliers for critical parts",
          "Maintain strategic safety stock",
          "Develop supplier relationship with backups",
        ],
      });
    }

    // Scenario 2: Regional disruption (Asia)
    const asiaSuppliers = suppliers.filter((s) =>
      [
        "China",
        "Vietnam",
        "Taiwan",
        "Japan",
        "South Korea",
        "Thailand",
      ].includes(s.country),
    );
    if (asiaSuppliers.length > 0) {
      const affectedParts = new Set(
        asiaSuppliers.flatMap((s) => s.partSuppliers.map((ps) => ps.partId)),
      ).size;

      scenarios.push({
        name: "Asia Pacific Regional Disruption",
        description:
          "Major supply chain disruption affecting Asia Pacific region",
        probability: "medium",
        impact: affectedParts > 10 ? "critical" : "high",
        affectedSuppliers: asiaSuppliers.map((s) => s.id),
        affectedParts,
        estimatedRecoveryDays: 60,
        financialImpact: {
          minimum: affectedParts * 1000,
          maximum: affectedParts * 10000,
          expected: affectedParts * 5000,
        },
        mitigations: [
          "Develop nearshore supply alternatives",
          "Increase safety stock for critical items",
          "Implement dual-sourcing strategy",
        ],
      });
    }

    // Scenario 3: Quality crisis
    scenarios.push({
      name: "Quality Crisis",
      description:
        "Major quality issue affecting multiple parts from key supplier",
      probability: "medium",
      impact: "high",
      affectedSuppliers: [],
      affectedParts: 5,
      estimatedRecoveryDays: 45,
      financialImpact: {
        minimum: 10000,
        maximum: 100000,
        expected: 50000,
      },
      mitigations: [
        "Implement rigorous incoming inspection",
        "Conduct regular supplier audits",
        "Maintain quality-focused supplier scorecards",
      ],
    });

    // Scenario 4: Transportation disruption
    scenarios.push({
      name: "Global Transportation Disruption",
      description: "Major shipping and logistics disruption",
      probability: "medium",
      impact: "medium",
      affectedSuppliers: suppliers
        .filter((s) => s.country !== "USA")
        .map((s) => s.id),
      affectedParts: suppliers
        .filter((s) => s.country !== "USA")
        .flatMap((s) => s.partSuppliers).length,
      estimatedRecoveryDays: 30,
      financialImpact: {
        minimum: 5000,
        maximum: 50000,
        expected: 20000,
      },
      mitigations: [
        "Maintain buffer inventory for imported parts",
        "Develop domestic sourcing alternatives",
        "Use multiple shipping routes/carriers",
      ],
    });

    return scenarios;
  }

  /**
   * Get batch risk assessment for multiple suppliers
   */
  async batchAssessRisk(
    supplierIds: string[],
    months: number = 12,
  ): Promise<SupplierRiskAssessment[]> {
    const assessments: SupplierRiskAssessment[] = [];

    for (const supplierId of supplierIds) {
      const assessment = await this.calculateSupplierRisk(supplierId, months);
      if (assessment) {
        assessments.push(assessment);
      }
    }

    return assessments.sort((a, b) => b.overallRiskScore - a.overallRiskScore);
  }

  /**
   * Save risk assessment to database
   */
  async saveRiskAssessment(assessment: SupplierRiskAssessment): Promise<void> {
    await prisma.supplierRiskScore.upsert({
      where: { supplierId: assessment.supplierId },
      update: {
        overallScore: 100 - assessment.overallRiskScore, // Convert risk to score
        riskLevel: assessment.riskLevel.toUpperCase(),
        deliveryScore: 100 - assessment.riskFactors.performance.score,
        qualityScore: 100 - assessment.riskFactors.dependency.score,
        financialScore: 100 - assessment.riskFactors.financial.score,
        geographicScore: 100 - assessment.riskFactors.external.score,
        communicationScore: assessment.mitigationStatus.mitigationScore,
        trend: assessment.trend.direction.toUpperCase(),
        previousScore: assessment.trend.previousScore,
        risks: assessment.riskFactors.performance.factors.map(
          (f) => f.description,
        ),
        recommendations: assessment.recommendations.map((r) => r.action),
        lastCalculated: new Date(),
      },
      create: {
        supplierId: assessment.supplierId,
        overallScore: 100 - assessment.overallRiskScore,
        riskLevel: assessment.riskLevel.toUpperCase(),
        deliveryScore: 100 - assessment.riskFactors.performance.score,
        qualityScore: 100 - assessment.riskFactors.dependency.score,
        financialScore: 100 - assessment.riskFactors.financial.score,
        geographicScore: 100 - assessment.riskFactors.external.score,
        communicationScore: assessment.mitigationStatus.mitigationScore,
        trend: assessment.trend.direction.toUpperCase(),
        previousScore: assessment.trend.previousScore,
        risks: assessment.riskFactors.performance.factors.map(
          (f) => f.description,
        ),
        recommendations: assessment.recommendations.map((r) => r.action),
        lastCalculated: new Date(),
      },
    });
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private getStartDate(months: number): Date {
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date;
  }

  private calculatePerformanceRisk(
    scorecard: SupplierScorecard | null,
  ): RiskFactorBreakdown["performance"] {
    if (!scorecard) {
      return {
        score: 50,
        weight: RISK_WEIGHTS.performance,
        factors: [
          {
            name: "No Data",
            score: 50,
            impact: "medium",
            description: "No performance data available",
          },
        ],
      };
    }

    const factors: RiskFactor[] = [];
    let totalScore = 0;

    // Delivery risk
    const deliveryRisk = 100 - scorecard.dimensions.delivery.score;
    if (deliveryRisk > 30) {
      factors.push({
        name: "Delivery Issues",
        score: deliveryRisk,
        impact: deliveryRisk > 50 ? "high" : "medium",
        description: `On-time delivery rate below target (${scorecard.dimensions.delivery.score}%)`,
      });
    }
    totalScore += deliveryRisk * 0.3;

    // Quality risk
    const qualityRisk = 100 - scorecard.dimensions.quality.score;
    if (qualityRisk > 30) {
      factors.push({
        name: "Quality Concerns",
        score: qualityRisk,
        impact: qualityRisk > 50 ? "high" : "medium",
        description: `Quality score below target (${scorecard.dimensions.quality.score}%)`,
      });
    }
    totalScore += qualityRisk * 0.35;

    // Responsiveness risk
    const responsivenessRisk = 100 - scorecard.dimensions.responsiveness.score;
    if (responsivenessRisk > 30) {
      factors.push({
        name: "Responsiveness Issues",
        score: responsivenessRisk,
        impact: "medium",
        description: `Slow response to issues (score: ${scorecard.dimensions.responsiveness.score}%)`,
      });
    }
    totalScore += responsivenessRisk * 0.2;

    // Cost risk
    const costRisk = 100 - scorecard.dimensions.cost.score;
    totalScore += costRisk * 0.15;

    return {
      score: Math.round(totalScore),
      weight: RISK_WEIGHTS.performance,
      factors,
    };
  }

  private calculateDependencyRisk(
    supplier: SupplierWithDependencies,
  ): RiskFactorBreakdown["dependency"] {
    const factors: RiskFactor[] = [];
    let totalScore = 0;

    // Single source parts
    const singleSourceParts = supplier.partSuppliers.filter(
      (ps: PartSupplierWithPartAndSuppliers) =>
        ps.part.partSuppliers.length === 1,
    );
    if (singleSourceParts.length > 0) {
      const singleSourceScore = Math.min(100, singleSourceParts.length * 15);
      factors.push({
        name: "Single Source Parts",
        score: singleSourceScore,
        impact: singleSourceParts.length > 3 ? "high" : "medium",
        description: `${singleSourceParts.length} parts with no alternate supplier`,
      });
      totalScore += singleSourceScore * 0.4;
    }

    // Critical parts dependency
    const criticalParts = supplier.partSuppliers.filter(
      (ps: PartSupplierWithPartAndSuppliers) => ps.part.isCritical,
    );
    if (criticalParts.length > 0) {
      const criticalScore = Math.min(100, criticalParts.length * 20);
      factors.push({
        name: "Critical Parts Dependency",
        score: criticalScore,
        impact: "high",
        description: `Supplying ${criticalParts.length} critical parts`,
      });
      totalScore += criticalScore * 0.4;
    }

    // Volume concentration
    const totalParts = supplier.partSuppliers.length;
    if (totalParts > 10) {
      const concentrationScore = Math.min(100, totalParts * 3);
      factors.push({
        name: "Volume Concentration",
        score: concentrationScore,
        impact: "medium",
        description: `High part count (${totalParts} parts) creates concentration risk`,
      });
      totalScore += concentrationScore * 0.2;
    }

    return {
      score: Math.round(totalScore || 20),
      weight: RISK_WEIGHTS.dependency,
      factors,
    };
  }

  private calculateExternalRisk(
    supplier: SupplierWithDependencies,
  ): RiskFactorBreakdown["external"] {
    const factors: RiskFactor[] = [];
    let totalScore = 0;

    // Country risk
    const countryRisk = EXTERNAL_RISK_FACTORS[supplier.country] || 15;
    if (countryRisk > 20) {
      factors.push({
        name: "Geographic Risk",
        score: countryRisk,
        impact: countryRisk > 30 ? "high" : "medium",
        description: `Located in ${supplier.country} with elevated country risk`,
      });
    }
    totalScore += countryRisk * 0.5;

    // Lead time risk (longer lead times = higher risk)
    const leadTimeRisk = Math.min(100, supplier.leadTimeDays * 2);
    if (supplier.leadTimeDays > 30) {
      factors.push({
        name: "Lead Time Risk",
        score: leadTimeRisk,
        impact: "medium",
        description: `Long lead time (${supplier.leadTimeDays} days) increases exposure`,
      });
    }
    totalScore += leadTimeRisk * 0.3;

    // NDAA compliance
    if (!supplier.ndaaCompliant) {
      factors.push({
        name: "Compliance Risk",
        score: 50,
        impact: "high",
        description: "Not NDAA compliant",
      });
      totalScore += 50 * 0.2;
    }

    return {
      score: Math.round(totalScore),
      weight: RISK_WEIGHTS.external,
      factors,
    };
  }

  private calculateFinancialRisk(
    supplier: SupplierWithDependencies,
    months: number,
  ): RiskFactorBreakdown["financial"] {
    const factors: RiskFactor[] = [];
    let totalScore = 30; // Base financial risk

    // Order volume trend
    const recentOrders = supplier.purchaseOrders.length;
    if (recentOrders === 0) {
      factors.push({
        name: "No Recent Orders",
        score: 40,
        impact: "medium",
        description: "No purchase orders in recent period",
      });
      totalScore += 20;
    }

    // Rating-based risk
    if (!supplier.rating || supplier.rating < 60) {
      factors.push({
        name: "Low Supplier Rating",
        score: 40,
        impact: "medium",
        description: `Supplier rating (${supplier.rating || "N/A"}) indicates financial concerns`,
      });
      totalScore += 20;
    }

    return {
      score: Math.round(Math.min(100, totalScore)),
      weight: RISK_WEIGHTS.financial,
      factors,
    };
  }

  private determineRiskLevel(score: number): RiskLevel {
    if (score >= 75) return "critical";
    if (score >= 50) return "high";
    if (score >= 25) return "medium";
    return "low";
  }

  private calculateRiskTrend(
    previousRiskScore: SupplierWithDependencies["riskScore"],
    currentScore: number,
  ): RiskTrend {
    const previousScore = previousRiskScore
      ? 100 - previousRiskScore.overallScore
      : null;
    const changePercent = previousScore
      ? ((currentScore - previousScore) / previousScore) * 100
      : 0;

    let direction: RiskTrend["direction"] = "stable";
    if (changePercent > 5)
      direction = "declining"; // Risk increasing = declining
    else if (changePercent < -5) direction = "improving";

    // Project future score
    const projectedScore =
      currentScore + (changePercent > 0 ? 5 : changePercent < 0 ? -5 : 0);

    return {
      direction,
      changePercent: Math.round(changePercent * 10) / 10,
      previousScore,
      projectedScore: Math.max(0, Math.min(100, Math.round(projectedScore))),
    };
  }

  private generateRiskHistory(
    currentScore: number,
    months: number,
  ): RiskHistoryPoint[] {
    const history: RiskHistoryPoint[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const period = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;

      // Simulate historical scores with some variance
      const variance = (Math.random() - 0.5) * 15;
      const score = Math.max(
        0,
        Math.min(100, currentScore + variance - i * 0.5),
      );

      history.push({
        period,
        riskScore: Math.round(score),
        riskLevel: this.determineRiskLevel(score),
        keyEvents: [],
      });
    }

    // Ensure last entry matches current score
    if (history.length > 0) {
      history[history.length - 1].riskScore = currentScore;
      history[history.length - 1].riskLevel =
        this.determineRiskLevel(currentScore);
    }

    return history;
  }

  private calculateMitigationStatus(
    supplier: SupplierWithDependencies,
  ): MitigationStatus {
    // Check for alternate suppliers
    const hasAlternateSupplier = supplier.partSuppliers.every(
      (ps: PartSupplierWithPartAndSuppliers) =>
        ps.part.partSuppliers.length > 1,
    );

    // Check for long-term contracts (simplified check)
    const hasLongTermContract = supplier.purchaseOrders.length > 12;

    // Calculate mitigation score
    let mitigationScore = 50;
    if (hasAlternateSupplier) mitigationScore += 20;
    if (hasLongTermContract) mitigationScore += 15;
    if (supplier.rating && supplier.rating >= 80) mitigationScore += 15;

    return {
      hasAlternateSupplier,
      hasSafetyStock: false, // Would need inventory data
      hasLongTermContract,
      lastAuditDate: null,
      auditScore: null,
      mitigationScore: Math.min(100, mitigationScore),
    };
  }

  private generateRiskRecommendations(
    performance: RiskFactorBreakdown["performance"],
    dependency: RiskFactorBreakdown["dependency"],
    external: RiskFactorBreakdown["external"],
    financial: RiskFactorBreakdown["financial"],
    riskLevel: RiskLevel,
  ): RiskRecommendation[] {
    const recommendations: RiskRecommendation[] = [];

    // Performance-based recommendations
    if (performance.score > 50) {
      recommendations.push({
        priority: "high",
        category: "short_term",
        action: "Conduct performance review meeting with supplier",
        expectedImpact: 15,
        estimatedCost: "low",
        deadline: "30 days",
      });
    }

    // Dependency-based recommendations
    if (dependency.score > 50) {
      recommendations.push({
        priority: "critical",
        category: "immediate",
        action: "Qualify alternate suppliers for single-source parts",
        expectedImpact: 25,
        estimatedCost: "medium",
        deadline: "60 days",
      });
    }

    // External risk recommendations
    if (external.score > 40) {
      recommendations.push({
        priority: "medium",
        category: "long_term",
        action: "Develop nearshore supply alternatives",
        expectedImpact: 20,
        estimatedCost: "high",
        deadline: "180 days",
      });
    }

    // General risk level recommendations
    if (riskLevel === "critical") {
      recommendations.push({
        priority: "critical",
        category: "immediate",
        action: "Increase safety stock for all parts from this supplier",
        expectedImpact: 20,
        estimatedCost: "medium",
        deadline: "14 days",
      });
    }

    return recommendations;
  }

  private extractTopRiskFactors(assessment: SupplierRiskAssessment): string[] {
    const allFactors = [
      ...assessment.riskFactors.performance.factors,
      ...assessment.riskFactors.dependency.factors,
      ...assessment.riskFactors.external.factors,
      ...assessment.riskFactors.financial.factors,
    ];

    return allFactors
      .filter((f) => f.score > 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((f) => f.name);
  }

  private calculateOverallSupplyChainRisk(
    avgSupplierRisk: number,
    concentrationRisk: number,
    geographicRisk: number,
    singleSourcePercent: number,
  ): number {
    return (
      avgSupplierRisk * 0.3 +
      concentrationRisk * 0.25 +
      geographicRisk * 0.25 +
      singleSourcePercent * 0.2
    );
  }

  private generateTopSupplyChainRisks(
    dependencyAnalysis: DependencyAnalysis,
    supplierRisks: CriticalSupplierRisk[],
  ): SupplyChainRisk[] {
    const risks: SupplyChainRisk[] = [];

    // Single source risk
    if (dependencyAnalysis.summary.singleSourcePercent > 20) {
      risks.push({
        id: "single-source",
        title: "Single Source Dependency",
        description: `${dependencyAnalysis.summary.singleSourcePartCount} parts have only one supplier`,
        riskScore: dependencyAnalysis.summary.singleSourcePercent,
        riskLevel: this.determineRiskLevel(
          dependencyAnalysis.summary.singleSourcePercent,
        ),
        category: "supplier",
        affectedParts: dependencyAnalysis.summary.singleSourcePartCount,
        estimatedImpact: "Production stoppage risk for affected parts",
        mitigationStatus: "not_started",
      });
    }

    // Concentration risk
    if (dependencyAnalysis.concentrationRisk.overallScore > 40) {
      risks.push({
        id: "concentration",
        title: "Supplier Concentration",
        description: "High spend concentration with few suppliers",
        riskScore: dependencyAnalysis.concentrationRisk.overallScore,
        riskLevel: this.determineRiskLevel(
          dependencyAnalysis.concentrationRisk.overallScore,
        ),
        category: "concentration",
        affectedParts: 0,
        estimatedImpact: "Supply disruption if top suppliers fail",
        mitigationStatus: "not_started",
      });
    }

    // Geographic risk
    if (dependencyAnalysis.geographicRisk.overallScore > 40) {
      risks.push({
        id: "geographic",
        title: "Geographic Concentration",
        description: "High concentration in specific regions",
        riskScore: dependencyAnalysis.geographicRisk.overallScore,
        riskLevel: this.determineRiskLevel(
          dependencyAnalysis.geographicRisk.overallScore,
        ),
        category: "geographic",
        affectedParts: 0,
        estimatedImpact: "Regional disruption could affect multiple suppliers",
        mitigationStatus: "not_started",
      });
    }

    return risks.sort((a, b) => b.riskScore - a.riskScore);
  }

  private generateMitigationPlan(
    risks: SupplyChainRisk[],
  ): MitigationPlanItem[] {
    return risks.slice(0, 5).map((risk, index) => ({
      id: `mitigation-${index + 1}`,
      riskId: risk.id,
      action: `Develop mitigation plan for ${risk.title}`,
      owner: null,
      dueDate: null,
      status: "pending" as const,
      priority:
        risk.riskLevel === "critical"
          ? "critical"
          : risk.riskLevel === "high"
            ? "high"
            : ("medium" as const),
      progress: 0,
    }));
  }

  private generateSupplyChainRiskTrend(
    currentScore: number,
    months: number,
  ): { period: string; score: number }[] {
    const trend: { period: string; score: number }[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const period = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
      const variance = (Math.random() - 0.5) * 10;
      const score = Math.max(0, Math.min(100, currentScore + variance));

      trend.push({
        period,
        score: Math.round(score),
      });
    }

    if (trend.length > 0) {
      trend[trend.length - 1].score = currentScore;
    }

    return trend;
  }

  private calculateAverageExternalRisk(
    suppliers: SupplierWithDependencies[],
  ): number {
    if (suppliers.length === 0) return 0;

    const totalRisk = suppliers.reduce((sum, s) => {
      return sum + (EXTERNAL_RISK_FACTORS[s.country] || 15);
    }, 0);

    return totalRisk / suppliers.length;
  }

  private findTopSupplier(
    suppliers: SupplierWithoutRiskScore[],
  ): SupplierWithoutRiskScore | null {
    if (suppliers.length === 0) return null;

    return suppliers.reduce((top, current) => {
      const topSpend = top.purchaseOrders.reduce(
        (sum: number, po: SupplierPurchaseOrder) => sum + (po.totalAmount || 0),
        0,
      );
      const currentSpend = current.purchaseOrders.reduce(
        (sum: number, po: SupplierPurchaseOrder) => sum + (po.totalAmount || 0),
        0,
      );
      return currentSpend > topSpend ? current : top;
    }, suppliers[0]);
  }

  private estimateFinancialImpact(
    supplier: SupplierWithoutRiskScore,
    allSuppliers: SupplierWithoutRiskScore[],
  ): RiskScenario["financialImpact"] {
    const supplierSpend = supplier.purchaseOrders.reduce(
      (sum: number, po: SupplierPurchaseOrder) => sum + (po.totalAmount || 0),
      0,
    );

    return {
      minimum: Math.round(supplierSpend * 0.1),
      maximum: Math.round(supplierSpend * 2),
      expected: Math.round(supplierSpend * 0.5),
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let calculatorInstance: RiskCalculator | null = null;

export function getRiskCalculator(): RiskCalculator {
  if (!calculatorInstance) {
    calculatorInstance = new RiskCalculator();
  }
  return calculatorInstance;
}
