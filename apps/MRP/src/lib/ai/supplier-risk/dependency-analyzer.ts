// =============================================================================
// DEPENDENCY ANALYZER
// Analyzes supplier dependencies and concentration risks
// =============================================================================

import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/mrp-client";

// =============================================================================
// PRISMA RESULT TYPES
// =============================================================================

/** Purchase order with supplier and lines (including part) */
type PurchaseOrderWithDetails = Prisma.PurchaseOrderGetPayload<{
  include: {
    supplier: true;
    lines: { include: { part: true } };
  };
}>;

/** Part with active partSuppliers (including supplier) */
type PartWithSuppliers = Prisma.PartGetPayload<{
  include: {
    partSuppliers: { include: { supplier: true } };
  };
}>;

/** Supplier metrics aggregated from purchase orders */
interface SupplierMetrics {
  supplierId: string;
  supplierName: string;
  country: string;
  rating: number | null;
  totalSpend: number;
  totalVolume: number;
  partIds: Set<string>;
}

// =============================================================================
// TYPES
// =============================================================================

export interface DependencyAnalysis {
  generatedAt: Date;
  periodMonths: number;
  summary: DependencySummary;
  singleSourceParts: SingleSourcePart[];
  concentrationRisk: ConcentrationRisk;
  geographicRisk: GeographicRisk;
  criticalDependencies: CriticalDependency[];
  recommendations: DependencyRecommendation[];
}

export interface DependencySummary {
  totalActiveParts: number;
  totalActiveSuppliers: number;
  singleSourcePartCount: number;
  singleSourcePercent: number;
  avgSuppliersPerPart: number;
  criticalPartsAtRisk: number;
  overallDependencyScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface SingleSourcePart {
  partId: string;
  partSku: string;
  partName: string;
  category: string;
  isCritical: boolean;
  supplierId: string;
  supplierName: string;
  supplierCountry: string;
  supplierRating: number | null;
  monthlySpend: number;
  monthlyVolume: number;
  leadTimeDays: number;
  riskScore: number;
  alternativeSuppliers: AlternativeSupplier[];
}

export interface AlternativeSupplier {
  supplierId: string;
  supplierName: string;
  country: string;
  rating: number | null;
  leadTimeDays: number;
  estimatedPrice: number | null;
  qualified: boolean;
}

export interface ConcentrationRisk {
  overallScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  spendConcentration: SpendConcentration;
  volumeConcentration: VolumeConcentration;
  partConcentration: PartConcentration;
  topSuppliers: TopSupplierDependency[];
}

export interface SpendConcentration {
  top1SupplierPercent: number;
  top3SuppliersPercent: number;
  top5SuppliersPercent: number;
  herfindahlIndex: number;
  diversificationScore: number;
}

export interface VolumeConcentration {
  top1SupplierPercent: number;
  top3SuppliersPercent: number;
  top5SuppliersPercent: number;
}

export interface PartConcentration {
  avgPartsPerSupplier: number;
  maxPartsFromSingleSupplier: number;
  supplierWithMostParts: {
    supplierId: string;
    supplierName: string;
    partCount: number;
  } | null;
}

export interface TopSupplierDependency {
  supplierId: string;
  supplierName: string;
  country: string;
  spendPercent: number;
  volumePercent: number;
  partCount: number;
  criticalPartCount: number;
  riskScore: number;
  rating: number | null;
}

export interface GeographicRisk {
  overallScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  countryConcentration: CountryConcentration[];
  regionConcentration: RegionConcentration[];
  diversificationScore: number;
  recommendations: string[];
}

export interface CountryConcentration {
  country: string;
  supplierCount: number;
  spendPercent: number;
  partCount: number;
  criticalPartCount: number;
  riskFactors: string[];
}

export interface RegionConcentration {
  region: string;
  countries: string[];
  supplierCount: number;
  spendPercent: number;
  partCount: number;
}

export interface CriticalDependency {
  partId: string;
  partSku: string;
  partName: string;
  isCritical: boolean;
  category: string;
  dependencyType: "single_source" | "geographic" | "supplier_risk" | "volume";
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  primarySupplier: {
    supplierId: string;
    supplierName: string;
    country: string;
    rating: number | null;
  };
  impactDescription: string;
  mitigationOptions: string[];
}

export interface DependencyRecommendation {
  priority: "critical" | "high" | "medium" | "low";
  type:
    | "dual_source"
    | "geographic_diversify"
    | "supplier_develop"
    | "inventory_buffer"
    | "qualify_alternate";
  title: string;
  description: string;
  affectedParts: string[];
  estimatedEffort: "low" | "medium" | "high";
  estimatedImpact: "low" | "medium" | "high";
}

// =============================================================================
// CONSTANTS
// =============================================================================

const COUNTRY_REGIONS: Record<string, string> = {
  USA: "North America",
  Canada: "North America",
  Mexico: "North America",
  China: "Asia Pacific",
  Japan: "Asia Pacific",
  "South Korea": "Asia Pacific",
  Taiwan: "Asia Pacific",
  Vietnam: "Asia Pacific",
  Thailand: "Asia Pacific",
  India: "Asia Pacific",
  Germany: "Europe",
  France: "Europe",
  Italy: "Europe",
  UK: "Europe",
  Spain: "Europe",
  Poland: "Europe",
  Brazil: "South America",
  Argentina: "South America",
};

const COUNTRY_RISK_FACTORS: Record<string, string[]> = {
  China: ["Trade tensions", "Long lead times", "IP concerns"],
  Vietnam: ["Developing infrastructure", "Quality consistency"],
  India: ["Infrastructure challenges", "Quality variability"],
  Mexico: ["Border delays", "Security concerns"],
  Taiwan: ["Geopolitical risk", "Natural disasters"],
};

// =============================================================================
// DEPENDENCY ANALYZER CLASS
// =============================================================================

export class DependencyAnalyzer {
  /**
   * Perform comprehensive dependency analysis
   */
  async analyzeDependencies(months: number = 12): Promise<DependencyAnalysis> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    // Get all active parts and their suppliers
    const parts = await prisma.part.findMany({
      where: { status: "active" },
      include: {
        partSuppliers: {
          include: { supplier: true },
          where: { status: "active" },
        },
      },
    });

    // Get purchase orders for spend analysis
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        orderDate: { gte: startDate },
        status: { in: ["received", "completed", "partial", "pending"] },
      },
      include: {
        supplier: true,
        lines: {
          include: { part: true },
        },
      },
    });

    // Calculate supplier spend and volume
    const supplierMetrics = this.calculateSupplierMetrics(orders);

    // Identify single-source parts
    const singleSourceParts = await this.identifySingleSourceParts(
      parts,
      supplierMetrics,
      months,
    );

    // Analyze concentration risk
    const concentrationRisk = this.analyzeConcentrationRisk(
      supplierMetrics,
      parts,
    );

    // Analyze geographic risk
    const geographicRisk = this.analyzeGeographicRisk(supplierMetrics, parts);

    // Identify critical dependencies
    const criticalDependencies = this.identifyCriticalDependencies(
      parts,
      singleSourceParts,
      concentrationRisk,
      geographicRisk,
    );

    // Generate summary
    const summary = this.generateSummary(
      parts,
      singleSourceParts,
      concentrationRisk,
      geographicRisk,
      supplierMetrics,
    );

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      singleSourceParts,
      concentrationRisk,
      geographicRisk,
      criticalDependencies,
    );

    return {
      generatedAt: new Date(),
      periodMonths: months,
      summary,
      singleSourceParts,
      concentrationRisk,
      geographicRisk,
      criticalDependencies,
      recommendations,
    };
  }

  /**
   * Analyze single-source risk for a specific part
   */
  async analyzePartDependency(partId: string): Promise<{
    part: {
      partId: string;
      partSku: string;
      partName: string;
      category: string;
      isCritical: boolean;
    };
    supplierCount: number;
    suppliers: {
      supplierId: string;
      supplierName: string;
      country: string;
      isPreferred: boolean;
      qualified: boolean;
      leadTimeDays: number;
      rating: number | null;
      spendPercent: number;
    }[];
    isSingleSource: boolean;
    riskScore: number;
    riskLevel: "low" | "medium" | "high" | "critical";
    recommendations: string[];
  } | null> {
    const part = await prisma.part.findUnique({
      where: { id: partId },
      include: {
        partSuppliers: {
          include: {
            supplier: {
              include: { riskScore: true },
            },
          },
          where: { status: "active" },
        },
      },
    });

    if (!part) return null;

    const supplierCount = part.partSuppliers.length;
    const isSingleSource = supplierCount === 1;

    // Calculate risk score
    let riskScore = 0;
    if (isSingleSource) riskScore += 40;
    if (part.isCritical) riskScore += 20;
    if (supplierCount === 0) riskScore += 50;

    // Factor in supplier quality
    const suppliers = part.partSuppliers.map((ps) => {
      const supplierRating = ps.supplier.rating || 70;
      if (supplierRating < 60) riskScore += 10;

      return {
        supplierId: ps.supplierId,
        supplierName: ps.supplier.name,
        country: ps.supplier.country,
        isPreferred: ps.isPreferred,
        qualified: ps.qualified,
        leadTimeDays: ps.leadTimeDays,
        rating: ps.supplier.rating,
        spendPercent: ps.isPreferred ? 100 : 100 / supplierCount,
      };
    });

    // Determine risk level
    let riskLevel: "low" | "medium" | "high" | "critical";
    if (riskScore >= 70) riskLevel = "critical";
    else if (riskScore >= 50) riskLevel = "high";
    else if (riskScore >= 30) riskLevel = "medium";
    else riskLevel = "low";

    // Generate recommendations
    const recommendations: string[] = [];
    if (isSingleSource) {
      recommendations.push("Qualify at least one alternate supplier");
      if (part.isCritical) {
        recommendations.push("Consider strategic safety stock increase");
      }
    }
    if (supplierCount === 0) {
      recommendations.push("Urgently identify and qualify suppliers");
    }

    return {
      part: {
        partId: part.id,
        partSku: part.partNumber,
        partName: part.name,
        category: part.category,
        isCritical: part.isCritical,
      },
      supplierCount,
      suppliers,
      isSingleSource,
      riskScore: Math.min(100, riskScore),
      riskLevel,
      recommendations,
    };
  }

  /**
   * Get supplier dependency breakdown
   */
  async getSupplierDependencyBreakdown(supplierId: string): Promise<{
    supplier: {
      supplierId: string;
      supplierName: string;
      country: string;
      rating: number | null;
    };
    dependentParts: {
      partId: string;
      partSku: string;
      partName: string;
      isCritical: boolean;
      isPreferred: boolean;
      alternateCount: number;
      monthlySpend: number;
    }[];
    totalPartsSupplied: number;
    criticalPartsSupplied: number;
    soleSourceParts: number;
    totalMonthlySpend: number;
    dependencyScore: number;
    riskIfRemoved: "low" | "medium" | "high" | "critical";
  } | null> {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        partSuppliers: {
          include: {
            part: {
              include: {
                partSuppliers: true,
              },
            },
          },
          where: { status: "active" },
        },
      },
    });

    if (!supplier) return null;

    // Analyze dependent parts
    const dependentParts = supplier.partSuppliers.map((ps) => {
      const alternateCount = ps.part.partSuppliers.filter(
        (alt) => alt.supplierId !== supplierId && alt.status === "active",
      ).length;

      return {
        partId: ps.partId,
        partSku: ps.part.partNumber,
        partName: ps.part.name,
        isCritical: ps.part.isCritical,
        isPreferred: ps.isPreferred,
        alternateCount,
        monthlySpend: ps.unitPrice * 100, // Estimate
      };
    });

    const totalPartsSupplied = dependentParts.length;
    const criticalPartsSupplied = dependentParts.filter(
      (p) => p.isCritical,
    ).length;
    const soleSourceParts = dependentParts.filter(
      (p) => p.alternateCount === 0,
    ).length;
    const totalMonthlySpend = dependentParts.reduce(
      (sum, p) => sum + p.monthlySpend,
      0,
    );

    // Calculate dependency score
    let dependencyScore = 0;
    dependencyScore += (soleSourceParts / Math.max(totalPartsSupplied, 1)) * 40;
    dependencyScore +=
      (criticalPartsSupplied / Math.max(totalPartsSupplied, 1)) * 30;
    dependencyScore += Math.min((totalPartsSupplied / 10) * 30, 30);

    // Determine risk if removed
    let riskIfRemoved: "low" | "medium" | "high" | "critical";
    if (soleSourceParts > 5 || criticalPartsSupplied > 3) {
      riskIfRemoved = "critical";
    } else if (soleSourceParts > 2 || criticalPartsSupplied > 1) {
      riskIfRemoved = "high";
    } else if (soleSourceParts > 0 || criticalPartsSupplied > 0) {
      riskIfRemoved = "medium";
    } else {
      riskIfRemoved = "low";
    }

    return {
      supplier: {
        supplierId: supplier.id,
        supplierName: supplier.name,
        country: supplier.country,
        rating: supplier.rating,
      },
      dependentParts,
      totalPartsSupplied,
      criticalPartsSupplied,
      soleSourceParts,
      totalMonthlySpend,
      dependencyScore: Math.round(dependencyScore),
      riskIfRemoved,
    };
  }

  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  private calculateSupplierMetrics(
    orders: PurchaseOrderWithDetails[],
  ): Map<string, SupplierMetrics> {
    const metrics = new Map<string, SupplierMetrics>();

    orders.forEach((order) => {
      const supplierId = order.supplierId;
      const existing = metrics.get(supplierId) || {
        supplierId,
        supplierName: order.supplier.name,
        country: order.supplier.country,
        rating: order.supplier.rating,
        totalSpend: 0,
        totalVolume: 0,
        partIds: new Set<string>(),
      };

      existing.totalSpend += order.totalAmount ? Number(order.totalAmount) : 0;
      order.lines.forEach((line) => {
        existing.totalVolume += line.quantity;
        if (line.partId) {
          existing.partIds.add(line.partId);
        }
      });

      metrics.set(supplierId, existing);
    });

    return metrics;
  }

  private async identifySingleSourceParts(
    parts: PartWithSuppliers[],
    supplierMetrics: Map<string, SupplierMetrics>,
    months: number,
  ): Promise<SingleSourcePart[]> {
    const singleSourceParts: SingleSourcePart[] = [];

    for (const part of parts) {
      if (part.partSuppliers.length === 1) {
        const ps = part.partSuppliers[0];
        const supplier = ps.supplier;
        const metrics = supplierMetrics.get(supplier.id);

        // Calculate risk score for single source
        let riskScore = 50; // Base risk for single source
        if (part.isCritical) riskScore += 20;
        if (!supplier.rating || supplier.rating < 70) riskScore += 15;
        if (ps.leadTimeDays > 30) riskScore += 10;

        // Find potential alternatives
        const alternatives = await this.findAlternativeSuppliers(
          part.id,
          supplier.id,
        );

        singleSourceParts.push({
          partId: part.id,
          partSku: part.partNumber,
          partName: part.name,
          category: part.category,
          isCritical: part.isCritical,
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierCountry: supplier.country,
          supplierRating: supplier.rating,
          monthlySpend: metrics ? metrics.totalSpend / months : 0,
          monthlyVolume: metrics ? metrics.totalVolume / months : 0,
          leadTimeDays: ps.leadTimeDays,
          riskScore: Math.min(100, riskScore),
          alternativeSuppliers: alternatives,
        });
      }
    }

    // Sort by risk score descending
    return singleSourceParts.sort((a, b) => b.riskScore - a.riskScore);
  }

  private async findAlternativeSuppliers(
    partId: string,
    currentSupplierId: string,
  ): Promise<AlternativeSupplier[]> {
    // Find suppliers in the same category that could potentially supply this part
    const part = await prisma.part.findUnique({
      where: { id: partId },
    });

    if (!part) return [];

    const potentialSuppliers = await prisma.supplier.findMany({
      where: {
        id: { not: currentSupplierId },
        status: "active",
        category: part.category,
      },
      take: 5,
    });

    return potentialSuppliers.map((s) => ({
      supplierId: s.id,
      supplierName: s.name,
      country: s.country,
      rating: s.rating,
      leadTimeDays: s.leadTimeDays,
      estimatedPrice: null,
      qualified: false,
    }));
  }

  private analyzeConcentrationRisk(
    supplierMetrics: Map<string, SupplierMetrics>,
    parts: PartWithSuppliers[],
  ): ConcentrationRisk {
    const suppliers = Array.from(supplierMetrics.values());
    const totalSpend = suppliers.reduce((sum, s) => sum + s.totalSpend, 0);
    const totalVolume = suppliers.reduce((sum, s) => sum + s.totalVolume, 0);

    // Sort by spend
    const bySpend = [...suppliers].sort((a, b) => b.totalSpend - a.totalSpend);
    const byVolume = [...suppliers].sort(
      (a, b) => b.totalVolume - a.totalVolume,
    );

    // Calculate spend concentration
    const top1SpendPercent =
      totalSpend > 0 ? ((bySpend[0]?.totalSpend || 0) / totalSpend) * 100 : 0;
    const top3SpendPercent =
      totalSpend > 0
        ? (bySpend.slice(0, 3).reduce((sum, s) => sum + s.totalSpend, 0) /
            totalSpend) *
          100
        : 0;
    const top5SpendPercent =
      totalSpend > 0
        ? (bySpend.slice(0, 5).reduce((sum, s) => sum + s.totalSpend, 0) /
            totalSpend) *
          100
        : 0;

    // Calculate Herfindahl Index (market concentration)
    const herfindahlIndex =
      suppliers.reduce((sum, s) => {
        const share = totalSpend > 0 ? s.totalSpend / totalSpend : 0;
        return sum + Math.pow(share, 2);
      }, 0) * 10000;

    // Diversification score (inverse of concentration)
    const diversificationScore = Math.max(0, 100 - herfindahlIndex / 100);

    // Calculate volume concentration
    const top1VolumePercent =
      totalVolume > 0
        ? ((byVolume[0]?.totalVolume || 0) / totalVolume) * 100
        : 0;
    const top3VolumePercent =
      totalVolume > 0
        ? (byVolume.slice(0, 3).reduce((sum, s) => sum + s.totalVolume, 0) /
            totalVolume) *
          100
        : 0;
    const top5VolumePercent =
      totalVolume > 0
        ? (byVolume.slice(0, 5).reduce((sum, s) => sum + s.totalVolume, 0) /
            totalVolume) *
          100
        : 0;

    // Calculate part concentration
    const supplierPartCounts = suppliers.map((s) => ({
      ...s,
      partCount: s.partIds.size,
    }));
    const maxPartsSupplier = supplierPartCounts.reduce<
      (typeof supplierPartCounts)[number] | null
    >((max, s) => (s.partCount > (max?.partCount || 0) ? s : max), null);

    // Calculate risk score
    let riskScore = 0;
    if (top1SpendPercent > 40) riskScore += 30;
    else if (top1SpendPercent > 25) riskScore += 15;
    if (top3SpendPercent > 70) riskScore += 20;
    if (herfindahlIndex > 2500) riskScore += 25;
    else if (herfindahlIndex > 1500) riskScore += 10;

    const riskLevel = this.determineRiskLevel(riskScore);

    // Top suppliers
    const topSuppliers: TopSupplierDependency[] = bySpend
      .slice(0, 10)
      .map((s) => {
        const criticalParts = parts.filter(
          (p) =>
            p.isCritical &&
            p.partSuppliers.some((ps) => ps.supplierId === s.supplierId),
        );

        return {
          supplierId: s.supplierId,
          supplierName: s.supplierName,
          country: s.country,
          spendPercent:
            totalSpend > 0
              ? Math.round((s.totalSpend / totalSpend) * 100 * 10) / 10
              : 0,
          volumePercent:
            totalVolume > 0
              ? Math.round((s.totalVolume / totalVolume) * 100 * 10) / 10
              : 0,
          partCount: s.partIds.size,
          criticalPartCount: criticalParts.length,
          riskScore: this.calculateSupplierRiskScore(s, totalSpend),
          rating: s.rating,
        };
      });

    return {
      overallScore: Math.min(100, riskScore),
      riskLevel,
      spendConcentration: {
        top1SupplierPercent: Math.round(top1SpendPercent * 10) / 10,
        top3SuppliersPercent: Math.round(top3SpendPercent * 10) / 10,
        top5SuppliersPercent: Math.round(top5SpendPercent * 10) / 10,
        herfindahlIndex: Math.round(herfindahlIndex),
        diversificationScore: Math.round(diversificationScore),
      },
      volumeConcentration: {
        top1SupplierPercent: Math.round(top1VolumePercent * 10) / 10,
        top3SuppliersPercent: Math.round(top3VolumePercent * 10) / 10,
        top5SuppliersPercent: Math.round(top5VolumePercent * 10) / 10,
      },
      partConcentration: {
        avgPartsPerSupplier:
          suppliers.length > 0
            ? Math.round(
                (supplierPartCounts.reduce((sum, s) => sum + s.partCount, 0) /
                  suppliers.length) *
                  10,
              ) / 10
            : 0,
        maxPartsFromSingleSupplier: maxPartsSupplier?.partCount || 0,
        supplierWithMostParts: maxPartsSupplier
          ? {
              supplierId: maxPartsSupplier.supplierId,
              supplierName: maxPartsSupplier.supplierName,
              partCount: maxPartsSupplier.partCount,
            }
          : null,
      },
      topSuppliers,
    };
  }

  private analyzeGeographicRisk(
    supplierMetrics: Map<string, SupplierMetrics>,
    parts: PartWithSuppliers[],
  ): GeographicRisk {
    const suppliers = Array.from(supplierMetrics.values());
    const totalSpend = suppliers.reduce((sum, s) => sum + s.totalSpend, 0);

    // Group by country
    const countryMap = new Map<
      string,
      {
        suppliers: SupplierMetrics[];
        totalSpend: number;
        partIds: Set<string>;
      }
    >();

    suppliers.forEach((s) => {
      const existing = countryMap.get(s.country) || {
        suppliers: [],
        totalSpend: 0,
        partIds: new Set<string>(),
      };
      existing.suppliers.push(s);
      existing.totalSpend += s.totalSpend;
      s.partIds.forEach((id: string) => existing.partIds.add(id));
      countryMap.set(s.country, existing);
    });

    // Country concentration
    const countryConcentration: CountryConcentration[] = Array.from(
      countryMap.entries(),
    )
      .map(([country, data]) => {
        const criticalParts = parts.filter(
          (p) =>
            p.isCritical &&
            p.partSuppliers.some((ps) =>
              data.suppliers.some((s) => s.supplierId === ps.supplierId),
            ),
        );

        return {
          country,
          supplierCount: data.suppliers.length,
          spendPercent:
            totalSpend > 0
              ? Math.round((data.totalSpend / totalSpend) * 100 * 10) / 10
              : 0,
          partCount: data.partIds.size,
          criticalPartCount: criticalParts.length,
          riskFactors: COUNTRY_RISK_FACTORS[country] || [],
        };
      })
      .sort((a, b) => b.spendPercent - a.spendPercent);

    // Region concentration
    const regionMap = new Map<
      string,
      {
        countries: Set<string>;
        supplierCount: number;
        totalSpend: number;
        partIds: Set<string>;
      }
    >();

    countryConcentration.forEach((cc) => {
      const region = COUNTRY_REGIONS[cc.country] || "Other";
      const existing = regionMap.get(region) || {
        countries: new Set<string>(),
        supplierCount: 0,
        totalSpend: 0,
        partIds: new Set<string>(),
      };
      existing.countries.add(cc.country);
      existing.supplierCount += cc.supplierCount;
      const countryData = countryMap.get(cc.country);
      if (countryData) {
        existing.totalSpend += countryData.totalSpend;
        countryData.partIds.forEach((id) => existing.partIds.add(id));
      }
      regionMap.set(region, existing);
    });

    const regionConcentration: RegionConcentration[] = Array.from(
      regionMap.entries(),
    )
      .map(([region, data]) => ({
        region,
        countries: Array.from(data.countries),
        supplierCount: data.supplierCount,
        spendPercent:
          totalSpend > 0
            ? Math.round((data.totalSpend / totalSpend) * 100 * 10) / 10
            : 0,
        partCount: data.partIds.size,
      }))
      .sort((a, b) => b.spendPercent - a.spendPercent);

    // Calculate risk score
    let riskScore = 0;
    const topCountry = countryConcentration[0];
    if (topCountry) {
      if (topCountry.spendPercent > 50) riskScore += 30;
      else if (topCountry.spendPercent > 30) riskScore += 15;
      if (topCountry.riskFactors.length > 0)
        riskScore += 10 * Math.min(topCountry.riskFactors.length, 3);
    }

    // Single region concentration
    const topRegion = regionConcentration[0];
    if (topRegion && topRegion.spendPercent > 70) {
      riskScore += 20;
    }

    const diversificationScore = Math.max(0, 100 - riskScore);
    const riskLevel = this.determineRiskLevel(riskScore);

    // Recommendations
    const recommendations: string[] = [];
    if (topCountry && topCountry.spendPercent > 40) {
      recommendations.push(
        `Diversify sourcing away from ${topCountry.country} (${topCountry.spendPercent}% of spend)`,
      );
    }
    if (countryConcentration.length < 3) {
      recommendations.push("Qualify suppliers in additional countries");
    }

    return {
      overallScore: Math.min(100, riskScore),
      riskLevel,
      countryConcentration,
      regionConcentration,
      diversificationScore,
      recommendations,
    };
  }

  private identifyCriticalDependencies(
    parts: PartWithSuppliers[],
    singleSourceParts: SingleSourcePart[],
    concentrationRisk: ConcentrationRisk,
    geographicRisk: GeographicRisk,
  ): CriticalDependency[] {
    const dependencies: CriticalDependency[] = [];

    // Single source critical parts
    singleSourceParts
      .filter((p) => p.riskScore >= 50)
      .forEach((part) => {
        dependencies.push({
          partId: part.partId,
          partSku: part.partSku,
          partName: part.partName,
          isCritical: part.isCritical,
          category: part.category,
          dependencyType: "single_source",
          riskScore: part.riskScore,
          riskLevel: this.determineRiskLevel(part.riskScore),
          primarySupplier: {
            supplierId: part.supplierId,
            supplierName: part.supplierName,
            country: part.supplierCountry,
            rating: part.supplierRating,
          },
          impactDescription: part.isCritical
            ? "Critical part with no alternate supplier - production stoppage risk"
            : "Single source dependency - supply disruption risk",
          mitigationOptions: [
            "Qualify alternate supplier",
            "Increase safety stock",
            "Develop long-term supply agreement",
          ],
        });
      });

    // High concentration suppliers
    concentrationRisk.topSuppliers
      .filter((s) => s.spendPercent > 25 && s.criticalPartCount > 0)
      .forEach((supplier) => {
        const supplierParts = parts.filter(
          (p) =>
            p.isCritical &&
            p.partSuppliers.some((ps) => ps.supplierId === supplier.supplierId),
        );

        supplierParts.forEach((part) => {
          if (!dependencies.some((d) => d.partId === part.id)) {
            dependencies.push({
              partId: part.id,
              partSku: part.partNumber,
              partName: part.name,
              isCritical: part.isCritical,
              category: part.category,
              dependencyType: "volume",
              riskScore: Math.min(100, supplier.riskScore + 20),
              riskLevel: this.determineRiskLevel(supplier.riskScore + 20),
              primarySupplier: {
                supplierId: supplier.supplierId,
                supplierName: supplier.supplierName,
                country: supplier.country,
                rating: supplier.rating,
              },
              impactDescription: `High volume concentration with ${supplier.supplierName} (${supplier.spendPercent}% of spend)`,
              mitigationOptions: [
                "Redistribute volume to alternate suppliers",
                "Negotiate better terms with backup suppliers",
              ],
            });
          }
        });
      });

    return dependencies.sort((a, b) => b.riskScore - a.riskScore).slice(0, 20);
  }

  private generateSummary(
    parts: PartWithSuppliers[],
    singleSourceParts: SingleSourcePart[],
    concentrationRisk: ConcentrationRisk,
    geographicRisk: GeographicRisk,
    supplierMetrics: Map<string, SupplierMetrics>,
  ): DependencySummary {
    const totalActiveParts = parts.length;
    const totalActiveSuppliers = supplierMetrics.size;
    const singleSourcePartCount = singleSourceParts.length;
    const singleSourcePercent =
      totalActiveParts > 0
        ? (singleSourcePartCount / totalActiveParts) * 100
        : 0;

    const avgSuppliersPerPart =
      totalActiveParts > 0
        ? parts.reduce((sum, p) => sum + p.partSuppliers.length, 0) /
          totalActiveParts
        : 0;

    const criticalPartsAtRisk = singleSourceParts.filter(
      (p) => p.isCritical,
    ).length;

    // Calculate overall dependency score
    const overallDependencyScore = Math.round(
      concentrationRisk.overallScore * 0.4 +
        geographicRisk.overallScore * 0.3 +
        singleSourcePercent * 0.3,
    );

    const riskLevel = this.determineRiskLevel(overallDependencyScore);

    return {
      totalActiveParts,
      totalActiveSuppliers,
      singleSourcePartCount,
      singleSourcePercent: Math.round(singleSourcePercent * 10) / 10,
      avgSuppliersPerPart: Math.round(avgSuppliersPerPart * 10) / 10,
      criticalPartsAtRisk,
      overallDependencyScore,
      riskLevel,
    };
  }

  private generateRecommendations(
    singleSourceParts: SingleSourcePart[],
    concentrationRisk: ConcentrationRisk,
    geographicRisk: GeographicRisk,
    criticalDependencies: CriticalDependency[],
  ): DependencyRecommendation[] {
    const recommendations: DependencyRecommendation[] = [];

    // Critical single source parts
    const criticalSingleSource = singleSourceParts.filter((p) => p.isCritical);
    if (criticalSingleSource.length > 0) {
      recommendations.push({
        priority: "critical",
        type: "dual_source",
        title: "Dual-Source Critical Parts",
        description: `${criticalSingleSource.length} critical parts have only one supplier. Qualify alternate suppliers immediately.`,
        affectedParts: criticalSingleSource.map((p) => p.partSku),
        estimatedEffort: "high",
        estimatedImpact: "high",
      });
    }

    // High concentration
    if (concentrationRisk.spendConcentration.top1SupplierPercent > 40) {
      const topSupplier = concentrationRisk.topSuppliers[0];
      recommendations.push({
        priority: "high",
        type: "supplier_develop",
        title: "Reduce Supplier Concentration",
        description: `${topSupplier.supplierName} represents ${topSupplier.spendPercent}% of spend. Develop alternative suppliers.`,
        affectedParts: [],
        estimatedEffort: "medium",
        estimatedImpact: "high",
      });
    }

    // Geographic diversification
    if (
      geographicRisk.riskLevel === "high" ||
      geographicRisk.riskLevel === "critical"
    ) {
      recommendations.push({
        priority: "medium",
        type: "geographic_diversify",
        title: "Geographic Diversification",
        description:
          "High geographic concentration risk. Qualify suppliers in different regions.",
        affectedParts: [],
        estimatedEffort: "high",
        estimatedImpact: "medium",
      });
    }

    // Safety stock for high risk parts
    const highRiskParts = criticalDependencies.filter(
      (d) => d.riskLevel === "high" || d.riskLevel === "critical",
    );
    if (highRiskParts.length > 0) {
      recommendations.push({
        priority: "medium",
        type: "inventory_buffer",
        title: "Increase Safety Stock",
        description: `Consider increasing safety stock for ${highRiskParts.length} high-risk parts while alternate sourcing is developed.`,
        affectedParts: highRiskParts.map((p) => p.partSku),
        estimatedEffort: "low",
        estimatedImpact: "medium",
      });
    }

    return recommendations;
  }

  private determineRiskLevel(
    score: number,
  ): "low" | "medium" | "high" | "critical" {
    if (score >= 75) return "critical";
    if (score >= 50) return "high";
    if (score >= 25) return "medium";
    return "low";
  }

  private calculateSupplierRiskScore(
    supplier: SupplierMetrics,
    totalSpend: number,
  ): number {
    let score = 0;
    const spendPercent =
      totalSpend > 0 ? (supplier.totalSpend / totalSpend) * 100 : 0;

    if (spendPercent > 30) score += 30;
    else if (spendPercent > 20) score += 20;
    else if (spendPercent > 10) score += 10;

    if (!supplier.rating || supplier.rating < 70) score += 20;
    if (COUNTRY_RISK_FACTORS[supplier.country]) score += 15;

    return Math.min(100, score);
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let analyzerInstance: DependencyAnalyzer | null = null;

export function getDependencyAnalyzer(): DependencyAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new DependencyAnalyzer();
  }
  return analyzerInstance;
}
