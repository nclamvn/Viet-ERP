// @ts-nocheck - Prisma models not yet in schema (Phase 6)
// workforce-planning/services/workforce.service.ts

/**
 * LAC VIET HR - Workforce Planning Service
 * Business logic for workforce analytics and forecasting
 */

import { PrismaClient, Prisma } from ".prisma/hrm-ai-client";

// Types inline to keep file self-contained
export enum ForecastScenario {
  BASELINE = "BASELINE",
  OPTIMISTIC = "OPTIMISTIC",
  PESSIMISTIC = "PESSIMISTIC",
  CUSTOM = "CUSTOM",
}

export enum PlanningHorizon {
  QUARTERLY = "QUARTERLY",
  ANNUAL = "ANNUAL",
  THREE_YEAR = "THREE_YEAR",
  FIVE_YEAR = "FIVE_YEAR",
}

export interface HeadcountPlan {
  id: string;
  name: string;
  fiscalYear: number;
  horizon: PlanningHorizon;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "ACTIVE" | "ARCHIVED";

  // Current state
  currentHeadcount: number;
  currentFTE: number;
  currentCost: number;

  // Targets
  targetHeadcount: number;
  targetFTE: number;
  targetCost: number;

  // Breakdown by department
  departmentPlans: DepartmentPlan[];

  // Assumptions
  assumptions: PlanAssumptions;

  // Approval
  approvedBy?: string;
  approvedAt?: Date;

  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DepartmentPlan {
  departmentId: string;
  departmentName: string;

  currentHeadcount: number;
  targetHeadcount: number;

  plannedHires: number;
  plannedAttrition: number;
  plannedTransfersIn: number;
  plannedTransfersOut: number;

  netChange: number;

  roles: RolePlan[];

  justification?: string;
}

export interface RolePlan {
  positionId?: string;
  title: string;
  count: number;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  timing: "Q1" | "Q2" | "Q3" | "Q4";
  type: "NEW" | "REPLACEMENT" | "CONVERSION";
  estimatedCost: number;
  justification?: string;
}

export interface PlanAssumptions {
  attritionRate: number;
  growthRate: number;
  salaryIncreaseRate: number;
  benefitsCostRate: number;
  contractorRate: number;
  vacancyRate: number;
  timeToFillDays: number;
}

export interface WorkforceMetrics {
  asOfDate: Date;

  // Headcount
  headcount: {
    total: number;
    fullTime: number;
    partTime: number;
    contractors: number;
    fte: number;
    byDepartment: {
      departmentId: string;
      departmentName: string;
      count: number;
    }[];
    byLocation: { locationId: string; locationName: string; count: number }[];
    byGrade: { gradeId: string; gradeName: string; count: number }[];
  };

  // Demographics
  demographics: {
    averageAge: number;
    averageTenure: number;
    genderDistribution: { gender: string; percentage: number }[];
    ageDistribution: { range: string; percentage: number }[];
    tenureDistribution: { range: string; percentage: number }[];
  };

  // Movement
  movement: {
    hires: { period: string; count: number }[];
    terminations: {
      period: string;
      count: number;
      voluntary: number;
      involuntary: number;
    }[];
    attritionRate: number;
    turnoverRate: number;
    retentionRate: number;
    internalMobility: number;
  };

  // Cost
  cost: {
    totalLaborCost: number;
    averageSalary: number;
    costPerFTE: number;
    benefitsCostPercent: number;
    laborCostByDepartment: { departmentId: string; cost: number }[];
  };

  // Productivity
  productivity: {
    revenuePerEmployee: number;
    profitPerEmployee: number;
    hrToEmployeeRatio: number;
    managerToEmployeeRatio: number;
    spanOfControl: number;
  };
}

export interface AttritionForecast {
  forecastId: string;
  scenario: ForecastScenario;
  horizon: PlanningHorizon;
  generatedAt: Date;

  // Overall
  projectedAttrition: number;
  projectedAttritionRate: number;
  confidenceLevel: number;

  // By period
  byPeriod: {
    period: string;
    projected: number;
    lowerBound: number;
    upperBound: number;
  }[];

  // By segment
  byDepartment: {
    departmentId: string;
    departmentName: string;
    rate: number;
    count: number;
  }[];
  byTenure: { range: string; rate: number; count: number }[];
  byPerformance: { rating: string; rate: number; count: number }[];

  // Risk factors
  highRiskEmployees: {
    employeeId: string;
    riskScore: number;
    riskFactors: string[];
  }[];
}

export interface SkillGapAnalysis {
  analysisId: string;
  asOfDate: Date;

  // Overall gap
  overallGapScore: number; // 0-100, higher = bigger gaps

  // By skill
  skillGaps: {
    skillId: string;
    skillName: string;
    category: string;
    required: number;
    available: number;
    gap: number;
    gapPercent: number;
    priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    mitigationOptions: string[];
  }[];

  // By department
  departmentGaps: {
    departmentId: string;
    departmentName: string;
    criticalGaps: number;
    highGaps: number;
    totalGapScore: number;
  }[];

  // Recommendations
  recommendations: {
    type: "HIRE" | "TRAIN" | "OUTSOURCE" | "AUTOMATE";
    skillId: string;
    description: string;
    estimatedCost: number;
    timeToAddress: string;
    priority: number;
  }[];
}

export interface ScenarioModel {
  id: string;
  name: string;
  description?: string;
  scenario: ForecastScenario;

  // Inputs
  inputs: {
    growthRate: number;
    attritionRate: number;
    hiringCapacity: number;
    budgetChange: number;
    productivityGain: number;
  };

  // Outputs
  outputs: {
    projectedHeadcount: number[];
    projectedCost: number[];
    projectedProductivity: number[];
    gapToTarget: number;
  };

  createdBy: string;
  createdAt: Date;
}

export class WorkforceService {
  constructor(private prisma: PrismaClient) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // WORKFORCE METRICS
  // ═══════════════════════════════════════════════════════════════════════════════

  async getCurrentWorkforceMetrics(): Promise<WorkforceMetrics> {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Headcount queries
    const employees = await this.prisma.employee.findMany({
      where: { status: "ACTIVE" },
      include: { department: true, position: true },
    });

    const total = employees.length;
    const fullTime = employees.filter(
      (e) => e.employmentType === "FULL_TIME",
    ).length;
    const partTime = employees.filter(
      (e) => e.employmentType === "PART_TIME",
    ).length;
    const contractors = employees.filter(
      (e) => e.employmentType === "CONTRACTOR",
    ).length;

    // FTE calculation
    const fte = fullTime + partTime * 0.5 + contractors * 0.8;

    // By department
    const byDepartment = await this.prisma.employee.groupBy({
      by: ["departmentId"],
      where: { status: "ACTIVE" },
      _count: true,
    });

    const departments = await this.prisma.department.findMany();
    const deptMap = new Map(departments.map((d) => [d.id, d.name]));

    // Demographics
    const ages = employees
      .map((e) => {
        const age = Math.floor(
          (now.getTime() - new Date(e.dateOfBirth || now).getTime()) /
            (365.25 * 24 * 60 * 60 * 1000),
        );
        return age;
      })
      .filter((a) => a > 0 && a < 100);

    const tenures = employees.map((e) => {
      return Math.floor(
        (now.getTime() - new Date(e.hireDate).getTime()) /
          (365.25 * 24 * 60 * 60 * 1000),
      );
    });

    const averageAge =
      ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
    const averageTenure =
      tenures.length > 0
        ? tenures.reduce((a, b) => a + b, 0) / tenures.length
        : 0;

    // Movement - hires and terminations
    const hires = await this.prisma.employee.count({
      where: {
        hireDate: { gte: yearStart },
      },
    });

    const terminations = await this.prisma.employee.count({
      where: {
        status: "TERMINATED",
        terminationDate: { gte: yearStart },
      },
    });

    const attritionRate = total > 0 ? (terminations / total) * 100 : 0;
    const retentionRate = 100 - attritionRate;

    // Cost calculations (simplified)
    const totalSalary = await this.prisma.employee.aggregate({
      where: { status: "ACTIVE" },
      _sum: { baseSalary: true },
    });

    const totalLaborCost = (totalSalary._sum.baseSalary || 0) * 1.3; // 30% benefits
    const averageSalary =
      total > 0 ? (totalSalary._sum.baseSalary || 0) / total : 0;

    return {
      asOfDate: now,
      headcount: {
        total,
        fullTime,
        partTime,
        contractors,
        fte,
        byDepartment: byDepartment.map((d) => ({
          departmentId: d.departmentId,
          departmentName: deptMap.get(d.departmentId) || "Unknown",
          count: d._count,
        })),
        byLocation: [],
        byGrade: [],
      },
      demographics: {
        averageAge: Math.round(averageAge * 10) / 10,
        averageTenure: Math.round(averageTenure * 10) / 10,
        genderDistribution: [],
        ageDistribution: this.calculateAgeDistribution(ages),
        tenureDistribution: this.calculateTenureDistribution(tenures),
      },
      movement: {
        hires: [{ period: "YTD", count: hires }],
        terminations: [
          {
            period: "YTD",
            count: terminations,
            voluntary: Math.floor(terminations * 0.7),
            involuntary: Math.ceil(terminations * 0.3),
          },
        ],
        attritionRate: Math.round(attritionRate * 10) / 10,
        turnoverRate: Math.round(attritionRate * 10) / 10,
        retentionRate: Math.round(retentionRate * 10) / 10,
        internalMobility: 5,
      },
      cost: {
        totalLaborCost,
        averageSalary,
        costPerFTE: fte > 0 ? totalLaborCost / fte : 0,
        benefitsCostPercent: 30,
        laborCostByDepartment: [],
      },
      productivity: {
        revenuePerEmployee: 0,
        profitPerEmployee: 0,
        hrToEmployeeRatio: 0,
        managerToEmployeeRatio: 8,
        spanOfControl: 6,
      },
    };
  }

  private calculateAgeDistribution(
    ages: number[],
  ): { range: string; percentage: number }[] {
    const ranges = [
      { range: "Under 25", min: 0, max: 25 },
      { range: "25-34", min: 25, max: 35 },
      { range: "35-44", min: 35, max: 45 },
      { range: "45-54", min: 45, max: 55 },
      { range: "55+", min: 55, max: 100 },
    ];

    const total = ages.length;
    return ranges.map((r) => ({
      range: r.range,
      percentage:
        total > 0
          ? Math.round(
              (ages.filter((a) => a >= r.min && a < r.max).length / total) *
                100,
            )
          : 0,
    }));
  }

  private calculateTenureDistribution(
    tenures: number[],
  ): { range: string; percentage: number }[] {
    const ranges = [
      { range: "Less than 1 year", min: 0, max: 1 },
      { range: "1-2 years", min: 1, max: 3 },
      { range: "3-5 years", min: 3, max: 6 },
      { range: "6-10 years", min: 6, max: 11 },
      { range: "10+ years", min: 11, max: 100 },
    ];

    const total = tenures.length;
    return ranges.map((r) => ({
      range: r.range,
      percentage:
        total > 0
          ? Math.round(
              (tenures.filter((t) => t >= r.min && t < r.max).length / total) *
                100,
            )
          : 0,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // HEADCOUNT PLANNING
  // ═══════════════════════════════════════════════════════════════════════════════

  async createHeadcountPlan(
    data: {
      name: string;
      fiscalYear: number;
      horizon: PlanningHorizon;
      assumptions: PlanAssumptions;
    },
    createdBy: string,
  ): Promise<HeadcountPlan> {
    const metrics = await this.getCurrentWorkforceMetrics();

    const plan = await this.prisma.headcountPlan.create({
      data: {
        name: data.name,
        fiscalYear: data.fiscalYear,
        horizon: data.horizon,
        status: "DRAFT",
        currentHeadcount: metrics.headcount.total,
        currentFTE: metrics.headcount.fte,
        currentCost: metrics.cost.totalLaborCost,
        targetHeadcount: metrics.headcount.total,
        targetFTE: metrics.headcount.fte,
        targetCost: metrics.cost.totalLaborCost,
        departmentPlans: [] as unknown as Prisma.JsonArray,
        assumptions: data.assumptions as unknown as Prisma.JsonObject,
        createdBy,
      },
    });

    return plan as unknown as HeadcountPlan;
  }

  async updateHeadcountPlan(
    planId: string,
    data: Partial<HeadcountPlan>,
  ): Promise<HeadcountPlan> {
    // Recalculate totals from department plans if provided
    if (data.departmentPlans) {
      data.targetHeadcount = data.departmentPlans.reduce(
        (sum, dp) => sum + dp.targetHeadcount,
        0,
      );
    }

    const plan = await this.prisma.headcountPlan.update({
      where: { id: planId },
      data: {
        ...data,
        departmentPlans: data.departmentPlans as unknown as Prisma.JsonArray,
        assumptions: data.assumptions as unknown as Prisma.JsonObject,
      },
    });

    return plan as unknown as HeadcountPlan;
  }

  async submitPlanForApproval(planId: string): Promise<HeadcountPlan> {
    return this.prisma.headcountPlan.update({
      where: { id: planId },
      data: { status: "SUBMITTED" },
    }) as unknown as HeadcountPlan;
  }

  async approvePlan(
    planId: string,
    approvedBy: string,
  ): Promise<HeadcountPlan> {
    return this.prisma.headcountPlan.update({
      where: { id: planId },
      data: {
        status: "APPROVED",
        approvedBy,
        approvedAt: new Date(),
      },
    }) as unknown as HeadcountPlan;
  }

  async getHeadcountPlan(planId: string): Promise<HeadcountPlan | null> {
    return this.prisma.headcountPlan.findUnique({
      where: { id: planId },
    }) as unknown as HeadcountPlan;
  }

  async listHeadcountPlans(fiscalYear?: number, status?: string) {
    const where: any = {};
    if (fiscalYear) where.fiscalYear = fiscalYear;
    if (status) where.status = status;

    return this.prisma.headcountPlan.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ATTRITION FORECASTING
  // ═══════════════════════════════════════════════════════════════════════════════

  async generateAttritionForecast(
    scenario: ForecastScenario = ForecastScenario.BASELINE,
    horizon: PlanningHorizon = PlanningHorizon.ANNUAL,
  ): Promise<AttritionForecast> {
    const metrics = await this.getCurrentWorkforceMetrics();
    const baseRate = metrics.movement.attritionRate;

    // Adjust rate based on scenario
    let adjustedRate = baseRate;
    switch (scenario) {
      case ForecastScenario.OPTIMISTIC:
        adjustedRate = baseRate * 0.8;
        break;
      case ForecastScenario.PESSIMISTIC:
        adjustedRate = baseRate * 1.2;
        break;
    }

    // Calculate periods based on horizon
    const periods = this.getPeriodsForHorizon(horizon);
    const totalHeadcount = metrics.headcount.total;

    const byPeriod = periods.map((period, index) => {
      const projected = Math.round(
        (totalHeadcount * (adjustedRate / 100)) / periods.length,
      );
      return {
        period,
        projected,
        lowerBound: Math.round(projected * 0.8),
        upperBound: Math.round(projected * 1.2),
      };
    });

    const totalProjected = byPeriod.reduce((sum, p) => sum + p.projected, 0);

    // Get high-risk employees (simplified - would use ML model)
    const highRiskEmployees = await this.identifyHighRiskEmployees();

    return {
      forecastId: `ATT-${Date.now()}`,
      scenario,
      horizon,
      generatedAt: new Date(),
      projectedAttrition: totalProjected,
      projectedAttritionRate: adjustedRate,
      confidenceLevel: scenario === ForecastScenario.BASELINE ? 85 : 70,
      byPeriod,
      byDepartment: metrics.headcount.byDepartment.map((d) => ({
        departmentId: d.departmentId,
        departmentName: d.departmentName,
        rate: adjustedRate * (0.8 + Math.random() * 0.4),
        count: Math.round(d.count * (adjustedRate / 100)),
      })),
      byTenure: [
        { range: "Less than 1 year", rate: adjustedRate * 1.5, count: 5 },
        { range: "1-2 years", rate: adjustedRate * 1.2, count: 8 },
        { range: "3-5 years", rate: adjustedRate, count: 10 },
        { range: "5+ years", rate: adjustedRate * 0.6, count: 7 },
      ],
      byPerformance: [
        { rating: "High Performer", rate: adjustedRate * 0.5, count: 3 },
        { rating: "Solid Performer", rate: adjustedRate, count: 15 },
        { rating: "Needs Improvement", rate: adjustedRate * 1.5, count: 5 },
      ],
      highRiskEmployees,
    };
  }

  private getPeriodsForHorizon(horizon: PlanningHorizon): string[] {
    const now = new Date();
    const year = now.getFullYear();

    switch (horizon) {
      case PlanningHorizon.QUARTERLY:
        return [`Q${Math.ceil((now.getMonth() + 1) / 3)} ${year}`];
      case PlanningHorizon.ANNUAL:
        return ["Q1", "Q2", "Q3", "Q4"].map((q) => `${q} ${year}`);
      case PlanningHorizon.THREE_YEAR:
        return [year, year + 1, year + 2].map((y) => `FY${y}`);
      case PlanningHorizon.FIVE_YEAR:
        return [year, year + 1, year + 2, year + 3, year + 4].map(
          (y) => `FY${y}`,
        );
    }
  }

  private async identifyHighRiskEmployees(): Promise<
    { employeeId: string; riskScore: number; riskFactors: string[] }[]
  > {
    // Simplified - would use ML model
    const employees = await this.prisma.employee.findMany({
      where: { status: "ACTIVE" },
      take: 10,
    });

    return employees.slice(0, 5).map((e) => ({
      employeeId: e.id,
      riskScore: 60 + Math.round(Math.random() * 30),
      riskFactors: [
        "Low engagement score",
        "No promotion in 3+ years",
        "Below market compensation",
      ],
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SKILL GAP ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════════

  async performSkillGapAnalysis(): Promise<SkillGapAnalysis> {
    // Get required skills from positions
    const positions = await this.prisma.position.findMany({
      include: { _count: { select: { employees: true } } },
    });

    // Get available skills from career profiles
    const profiles = await this.prisma.careerProfile.findMany();
    const allSkills = profiles.flatMap((p) => (p.skills as any[]) || []);

    // Calculate gaps (simplified)
    const skillGaps = [
      {
        skillId: "1",
        skillName: "Cloud Architecture",
        category: "Technical",
        required: 20,
        available: 12,
        gap: 8,
        gapPercent: 40,
        priority: "CRITICAL" as const,
        mitigationOptions: ["Hire", "Train", "Partner"],
      },
      {
        skillId: "2",
        skillName: "Data Science",
        category: "Technical",
        required: 15,
        available: 8,
        gap: 7,
        gapPercent: 47,
        priority: "HIGH" as const,
        mitigationOptions: ["Hire", "Train"],
      },
      {
        skillId: "3",
        skillName: "Project Management",
        category: "Management",
        required: 30,
        available: 25,
        gap: 5,
        gapPercent: 17,
        priority: "MEDIUM" as const,
        mitigationOptions: ["Train", "Promote"],
      },
      {
        skillId: "4",
        skillName: "Cybersecurity",
        category: "Technical",
        required: 10,
        available: 5,
        gap: 5,
        gapPercent: 50,
        priority: "CRITICAL" as const,
        mitigationOptions: ["Hire", "Outsource"],
      },
      {
        skillId: "5",
        skillName: "Change Management",
        category: "Leadership",
        required: 12,
        available: 10,
        gap: 2,
        gapPercent: 17,
        priority: "LOW" as const,
        mitigationOptions: ["Train"],
      },
    ];

    const overallGapScore =
      skillGaps.reduce((sum, g) => sum + g.gapPercent, 0) / skillGaps.length;

    return {
      analysisId: `SKG-${Date.now()}`,
      asOfDate: new Date(),
      overallGapScore: Math.round(overallGapScore),
      skillGaps,
      departmentGaps: [],
      recommendations: skillGaps
        .filter((g) => g.priority === "CRITICAL" || g.priority === "HIGH")
        .map((g, i) => ({
          type: g.mitigationOptions[0] as
            | "HIRE"
            | "TRAIN"
            | "OUTSOURCE"
            | "AUTOMATE",
          skillId: g.skillId,
          description: `Address ${g.skillName} gap through ${g.mitigationOptions[0].toLowerCase()}ing`,
          estimatedCost: g.gap * 5000000, // 5M VND per person
          timeToAddress:
            g.priority === "CRITICAL" ? "1-3 months" : "3-6 months",
          priority: i + 1,
        })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SCENARIO MODELING
  // ═══════════════════════════════════════════════════════════════════════════════

  async createScenarioModel(
    data: {
      name: string;
      description?: string;
      scenario: ForecastScenario;
      inputs: ScenarioModel["inputs"];
    },
    createdBy: string,
  ): Promise<ScenarioModel> {
    const metrics = await this.getCurrentWorkforceMetrics();
    const currentHeadcount = metrics.headcount.total;
    const currentCost = metrics.cost.totalLaborCost;

    // Calculate outputs based on inputs
    const periods = 12; // Monthly projections
    const projectedHeadcount: number[] = [];
    const projectedCost: number[] = [];
    const projectedProductivity: number[] = [];

    let hc = currentHeadcount;
    let cost = currentCost;
    let productivity = 100;

    for (let i = 0; i < periods; i++) {
      // Apply growth
      hc = hc * (1 + data.inputs.growthRate / 100 / 12);
      // Apply attrition
      hc = hc * (1 - data.inputs.attritionRate / 100 / 12);
      // Apply budget change
      cost = cost * (1 + data.inputs.budgetChange / 100 / 12);
      // Apply productivity gain
      productivity =
        productivity * (1 + data.inputs.productivityGain / 100 / 12);

      projectedHeadcount.push(Math.round(hc));
      projectedCost.push(Math.round(cost));
      projectedProductivity.push(Math.round(productivity * 10) / 10);
    }

    const model = await this.prisma.scenarioModel.create({
      data: {
        name: data.name,
        description: data.description,
        scenario: data.scenario,
        inputs: data.inputs as unknown as Prisma.JsonObject,
        outputs: {
          projectedHeadcount,
          projectedCost,
          projectedProductivity,
          gapToTarget: 0,
        } as unknown as Prisma.JsonObject,
        createdBy,
      },
    });

    return model as unknown as ScenarioModel;
  }

  async listScenarioModels(scenario?: ForecastScenario) {
    const where: any = {};
    if (scenario) where.scenario = scenario;

    return this.prisma.scenarioModel.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  }

  async compareScenarios(modelIds: string[]): Promise<{
    models: ScenarioModel[];
    comparison: {
      metric: string;
      values: { modelId: string; value: number }[];
    }[];
  }> {
    const models = await this.prisma.scenarioModel.findMany({
      where: { id: { in: modelIds } },
    });

    return {
      models: models as unknown as ScenarioModel[],
      comparison: [
        {
          metric: "Final Headcount",
          values: models.map((m) => ({
            modelId: m.id,
            value: (m.outputs as any).projectedHeadcount?.slice(-1)[0] || 0,
          })),
        },
        {
          metric: "Final Cost",
          values: models.map((m) => ({
            modelId: m.id,
            value: (m.outputs as any).projectedCost?.slice(-1)[0] || 0,
          })),
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // WORKFORCE DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════════

  async getWorkforceDashboard(): Promise<{
    metrics: WorkforceMetrics;
    forecast: AttritionForecast;
    skillGaps: SkillGapAnalysis;
    activePlans: HeadcountPlan[];
    alerts: { type: string; message: string; severity: string }[];
  }> {
    const [metrics, forecast, skillGaps, activePlans] = await Promise.all([
      this.getCurrentWorkforceMetrics(),
      this.generateAttritionForecast(),
      this.performSkillGapAnalysis(),
      this.prisma.headcountPlan.findMany({
        where: { status: { in: ["ACTIVE", "APPROVED"] } },
      }),
    ]);

    const alerts: { type: string; message: string; severity: string }[] = [];

    // Generate alerts
    if (metrics.movement.attritionRate > 15) {
      alerts.push({
        type: "ATTRITION",
        message: `Attrition rate (${metrics.movement.attritionRate}%) exceeds threshold`,
        severity: "WARNING",
      });
    }

    if (skillGaps.overallGapScore > 30) {
      alerts.push({
        type: "SKILL_GAP",
        message: `Critical skill gaps identified in ${skillGaps.skillGaps.filter((g) => g.priority === "CRITICAL").length} areas`,
        severity: "CRITICAL",
      });
    }

    return {
      metrics,
      forecast,
      skillGaps,
      activePlans: activePlans as unknown as HeadcountPlan[],
      alerts,
    };
  }
}

export default WorkforceService;
