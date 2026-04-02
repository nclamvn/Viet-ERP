// @ts-nocheck - Prisma models not yet in schema (Phase 6)
// succession-planning/services/succession.service.ts

/**
 * LAC VIET HR - Succession Planning Service
 * Business logic for succession and talent management
 */

import { PrismaClient, Prisma } from ".prisma/hrm-unified-client";
import {
  CriticalPosition,
  PositionCriticality,
  TalentProfile,
  TalentCategory,
  NineBoxPosition,
  FlightRisk,
  RiskLevel,
  SuccessionPlan,
  SuccessionPlanStatus,
  SuccessorCandidate,
  SuccessorReadiness,
  DevelopmentPlan,
  DevelopmentActivity,
  DevelopmentActivityType,
  DevelopmentPriority,
  TalentPool,
  NineBoxGrid,
  SuccessionAnalytics,
  SuccessionDashboardData,
  CreateCriticalPositionDto,
  CreateSuccessionPlanDto,
  AddSuccessorDto,
  UpdateTalentProfileDto,
  CreateDevelopmentPlanDto,
  AddDevelopmentActivityDto,
  NineBoxAssessmentDto,
  TalentSearchFilters,
} from "../types/succession.types";

export class SuccessionService {
  constructor(private prisma: PrismaClient) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRITICAL POSITIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createCriticalPosition(
    data: CreateCriticalPositionDto,
  ): Promise<CriticalPosition> {
    // Get position details
    const position = await this.prisma.position.findUnique({
      where: { id: data.positionId },
      include: {
        department: true,
        currentHolder: true,
      },
    });

    if (!position) {
      throw new Error("Position not found");
    }

    // Calculate criticality score
    const criticalityScore = this.calculateCriticalityScore(
      data.criticalityFactors,
    );

    const criticalPosition = await this.prisma.criticalPosition.create({
      data: {
        positionId: data.positionId,
        jobTitle: position.title,
        departmentId: position.departmentId,
        departmentName: position.department.name,
        criticality: data.criticality,
        criticalityScore,
        criticalityFactors:
          data.criticalityFactors as unknown as Prisma.JsonArray,
        currentIncumbentId: position.currentHolder?.id,
        isVacant: !position.currentHolder,
        vacancyRisk: RiskLevel.MEDIUM,
        benchStrength: 0,
        keyCompetencies: data.keyCompetencies as unknown as Prisma.JsonArray,
        keyExperiences: data.keyExperiences,
        minYearsExperience: data.minYearsExperience,
        readyNowCount: 0,
        notes: data.notes,
      },
    });

    return criticalPosition as unknown as CriticalPosition;
  }

  private calculateCriticalityScore(
    factors: { factor: string; weight: number; score: number }[],
  ): number {
    if (!factors || factors.length === 0) return 0;

    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const weightedScore = factors.reduce(
      (sum, f) => sum + f.score * f.weight,
      0,
    );

    return totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
  }

  async updateCriticalPosition(
    positionId: string,
    data: Partial<CriticalPosition>,
  ): Promise<CriticalPosition> {
    const updated = await this.prisma.criticalPosition.update({
      where: { id: positionId },
      data: {
        ...data,
        criticalityScore: data.criticalityFactors
          ? this.calculateCriticalityScore(data.criticalityFactors as any)
          : undefined,
      },
    });

    return updated as unknown as CriticalPosition;
  }

  async getCriticalPosition(id: string): Promise<CriticalPosition | null> {
    const position = await this.prisma.criticalPosition.findUnique({
      where: { id },
      include: {
        successors: {
          include: {
            talentProfile: true,
          },
          orderBy: { rank: "asc" },
        },
        currentIncumbent: true,
      },
    });

    return position as unknown as CriticalPosition;
  }

  async listCriticalPositions(
    filters: {
      criticality?: PositionCriticality;
      departmentId?: string;
      hasSuccessors?: boolean;
      riskLevel?: RiskLevel;
    },
    page: number = 1,
    limit: number = 20,
  ) {
    const where: Prisma.CriticalPositionWhereInput = {};

    if (filters.criticality) where.criticality = filters.criticality;
    if (filters.departmentId) where.departmentId = filters.departmentId;
    if (filters.riskLevel) where.vacancyRisk = filters.riskLevel;
    if (filters.hasSuccessors !== undefined) {
      where.readyNowCount = filters.hasSuccessors ? { gt: 0 } : 0;
    }

    const [positions, total] = await Promise.all([
      this.prisma.criticalPosition.findMany({
        where,
        include: {
          _count: { select: { successors: true } },
        },
        orderBy: [{ criticality: "asc" }, { criticalityScore: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.criticalPosition.count({ where }),
    ]);

    return {
      data: positions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async assessPositionRisk(positionId: string): Promise<{
    vacancyRisk: RiskLevel;
    benchStrength: number;
    riskFactors: string[];
  }> {
    const position = await this.prisma.criticalPosition.findUnique({
      where: { id: positionId },
      include: {
        successors: true,
        currentIncumbent: {
          include: { talentProfile: true },
        },
      },
    });

    if (!position) throw new Error("Position not found");

    const riskFactors: string[] = [];
    let riskScore = 0;

    // Check if vacant
    if (position.isVacant) {
      riskFactors.push("Position is currently vacant");
      riskScore += 30;
    }

    // Check incumbent flight risk
    const incumbentProfile = position.currentIncumbent?.talentProfile;
    if (incumbentProfile?.flightRisk === FlightRisk.VERY_HIGH) {
      riskFactors.push("Current incumbent has very high flight risk");
      riskScore += 25;
    } else if (incumbentProfile?.flightRisk === FlightRisk.HIGH) {
      riskFactors.push("Current incumbent has high flight risk");
      riskScore += 15;
    }

    // Check retirement risk
    if (
      incumbentProfile?.yearsToRetirement !== undefined &&
      incumbentProfile.yearsToRetirement <= 2
    ) {
      riskFactors.push(
        `Incumbent retiring in ${incumbentProfile.yearsToRetirement} years`,
      );
      riskScore += 20;
    }

    // Check bench strength
    const readyNowSuccessors = position.successors.filter(
      (s) => s.readiness === SuccessorReadiness.READY_NOW,
    );
    if (readyNowSuccessors.length === 0) {
      riskFactors.push("No ready-now successors identified");
      riskScore += 25;
    }

    const totalSuccessors = position.successors.length;
    if (totalSuccessors === 0) {
      riskFactors.push("No succession pipeline");
      riskScore += 15;
    }

    // Calculate bench strength
    const benchStrength = this.calculateBenchStrength(
      position.successors as any,
    );

    // Determine risk level
    let vacancyRisk: RiskLevel;
    if (riskScore >= 60) vacancyRisk = RiskLevel.CRITICAL;
    else if (riskScore >= 40) vacancyRisk = RiskLevel.HIGH;
    else if (riskScore >= 20) vacancyRisk = RiskLevel.MEDIUM;
    else vacancyRisk = RiskLevel.LOW;

    // Update position with calculated values
    await this.prisma.criticalPosition.update({
      where: { id: positionId },
      data: {
        vacancyRisk,
        benchStrength,
        readyNowCount: readyNowSuccessors.length,
      },
    });

    return { vacancyRisk, benchStrength, riskFactors };
  }

  private calculateBenchStrength(successors: SuccessorCandidate[]): number {
    if (!successors || successors.length === 0) return 0;

    // Weighted score based on readiness
    const readinessWeights: Record<SuccessorReadiness, number> = {
      [SuccessorReadiness.READY_NOW]: 1.0,
      [SuccessorReadiness.READY_1_YEAR]: 0.75,
      [SuccessorReadiness.READY_2_YEARS]: 0.5,
      [SuccessorReadiness.READY_3_PLUS]: 0.25,
      [SuccessorReadiness.NOT_READY]: 0,
    };

    const totalWeight = successors.reduce(
      (sum, s) => sum + (readinessWeights[s.readiness] || 0),
      0,
    );

    // Normalize to 0-100 scale (assuming ideal is 2+ ready-now successors)
    return Math.min(100, Math.round((totalWeight / 2) * 100));
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TALENT PROFILES
  // ═══════════════════════════════════════════════════════════════════════════════

  async createTalentProfile(employeeId: string): Promise<TalentProfile> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        department: true,
        currentPosition: true,
        manager: true,
        performanceReviews: {
          orderBy: { reviewDate: "desc" },
          take: 1,
        },
      },
    });

    if (!employee) throw new Error("Employee not found");

    // Check if profile already exists
    const existing = await this.prisma.talentProfile.findUnique({
      where: { employeeId },
    });

    if (existing) return existing as unknown as TalentProfile;

    // Calculate years
    const hireDate = new Date(employee.hireDate);
    const yearsInCompany =
      (Date.now() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const positionStartDate = employee.currentPosition?.startDate || hireDate;
    const yearsInRole =
      (Date.now() - new Date(positionStartDate).getTime()) /
      (365.25 * 24 * 60 * 60 * 1000);

    // Get latest performance rating
    const performanceRating =
      employee.performanceReviews[0]?.overallRating || 3;

    const profile = await this.prisma.talentProfile.create({
      data: {
        employeeId,
        employeeCode: employee.employeeCode,
        fullName: `${employee.firstName} ${employee.lastName}`,
        email: employee.email,
        photoUrl: employee.photoUrl,
        currentPositionId: employee.positionId || "",
        currentPositionTitle: employee.currentPosition?.title || "",
        departmentId: employee.departmentId || "",
        departmentName: employee.department?.name || "",
        managerId: employee.managerId,
        managerName: employee.manager
          ? `${employee.manager.firstName} ${employee.manager.lastName}`
          : undefined,
        hireDate: employee.hireDate,
        yearsInCompany: Math.round(yearsInCompany * 10) / 10,
        yearsInRole: Math.round(yearsInRole * 10) / 10,
        talentCategory: TalentCategory.SOLID_PERFORMER,
        nineBoxPosition: NineBoxPosition.MODERATE_PERFORMER_MODERATE_POTENTIAL,
        performanceRating,
        potentialRating: 2, // Default medium
        flightRisk: FlightRisk.MODERATE,
        retentionRisk: RiskLevel.MEDIUM,
        retentionPriority: "MEDIUM",
        careerAspirations: [],
        mobilityPreference: {
          geographicMobility: "LOCAL",
          functionalMobility: "WITHIN_FAMILY",
          travelWillingness: 20,
        } as unknown as Prisma.JsonObject,
        promotionReadiness: SuccessorReadiness.READY_2_YEARS,
        lateralMoveInterest: false,
        relocationWillingness: false,
        competencyProfile: [],
        strengthAreas: [],
        developmentAreas: [],
        keyExperiences: [],
        criticalExperienceGaps: [],
        certifications: [],
        languages: [],
        successorForPositions: [],
        activeDevelopmentActivities: 0,
        completedDevelopmentActivities: 0,
      },
    });

    return profile as unknown as TalentProfile;
  }

  async updateTalentProfile(
    profileId: string,
    data: UpdateTalentProfileDto,
  ): Promise<TalentProfile> {
    // If performance or potential changed, recalculate 9-box
    let nineBoxPosition: NineBoxPosition | undefined;

    if (
      data.performanceRating !== undefined ||
      data.potentialRating !== undefined
    ) {
      const current = await this.prisma.talentProfile.findUnique({
        where: { id: profileId },
      });
      if (current) {
        const perf = data.performanceRating ?? current.performanceRating;
        const potential = data.potentialRating ?? current.potentialRating;
        nineBoxPosition = this.calculateNineBoxPosition(perf, potential);
      }
    }

    const updated = await this.prisma.talentProfile.update({
      where: { id: profileId },
      data: {
        ...data,
        nineBoxPosition,
        careerAspirations:
          data.careerAspirations as unknown as Prisma.JsonArray,
        mobilityPreference:
          data.mobilityPreference as unknown as Prisma.JsonObject,
      },
    });

    return updated as unknown as TalentProfile;
  }

  private calculateNineBoxPosition(
    performanceRating: number,
    potentialRating: number,
  ): NineBoxPosition {
    // Performance: 1-2 = Low, 3 = Medium, 4-5 = High
    // Potential: 1 = Low, 2 = Medium, 3 = High

    const perfCategory =
      performanceRating <= 2
        ? "LOW"
        : performanceRating === 3
          ? "MEDIUM"
          : "HIGH";
    const potentialCategory =
      potentialRating === 1 ? "LOW" : potentialRating === 2 ? "MEDIUM" : "HIGH";

    const matrix: Record<string, Record<string, NineBoxPosition>> = {
      HIGH: {
        HIGH: NineBoxPosition.HIGH_PERFORMER_HIGH_POTENTIAL,
        MEDIUM: NineBoxPosition.HIGH_PERFORMER_MODERATE_POTENTIAL,
        LOW: NineBoxPosition.HIGH_PERFORMER_LIMITED_POTENTIAL,
      },
      MEDIUM: {
        HIGH: NineBoxPosition.MODERATE_PERFORMER_HIGH_POTENTIAL,
        MEDIUM: NineBoxPosition.MODERATE_PERFORMER_MODERATE_POTENTIAL,
        LOW: NineBoxPosition.MODERATE_PERFORMER_LIMITED_POTENTIAL,
      },
      LOW: {
        HIGH: NineBoxPosition.LOW_PERFORMER_HIGH_POTENTIAL,
        MEDIUM: NineBoxPosition.LOW_PERFORMER_MODERATE_POTENTIAL,
        LOW: NineBoxPosition.LOW_PERFORMER_LIMITED_POTENTIAL,
      },
    };

    return matrix[perfCategory][potentialCategory];
  }

  async getTalentProfile(employeeId: string): Promise<TalentProfile | null> {
    return this.prisma.talentProfile.findUnique({
      where: { employeeId },
      include: {
        developmentPlan: {
          include: { activities: true },
        },
      },
    }) as unknown as TalentProfile;
  }

  async searchTalentProfiles(
    filters: TalentSearchFilters,
    page: number = 1,
    limit: number = 50,
  ) {
    const where: Prisma.TalentProfileWhereInput = {};

    if (filters.departmentIds?.length) {
      where.departmentId = { in: filters.departmentIds };
    }

    if (filters.nineBoxPositions?.length) {
      where.nineBoxPosition = { in: filters.nineBoxPositions };
    }

    if (filters.talentCategories?.length) {
      where.talentCategory = { in: filters.talentCategories };
    }

    if (filters.flightRiskLevels?.length) {
      where.flightRisk = { in: filters.flightRiskLevels };
    }

    if (filters.minPerformanceRating) {
      where.performanceRating = { gte: filters.minPerformanceRating };
    }

    if (filters.minPotentialRating) {
      where.potentialRating = { gte: filters.minPotentialRating };
    }

    if (filters.searchTerm) {
      where.OR = [
        { fullName: { contains: filters.searchTerm, mode: "insensitive" } },
        { employeeCode: { contains: filters.searchTerm, mode: "insensitive" } },
        {
          currentPositionTitle: {
            contains: filters.searchTerm,
            mode: "insensitive",
          },
        },
      ];
    }

    const [profiles, total] = await Promise.all([
      this.prisma.talentProfile.findMany({
        where,
        orderBy: [{ performanceRating: "desc" }, { potentialRating: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.talentProfile.count({ where }),
    ]);

    return {
      data: profiles,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SUCCESSION PLANS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createSuccessionPlan(
    data: CreateSuccessionPlanDto,
    createdBy: string,
  ): Promise<SuccessionPlan> {
    // Verify critical position exists
    const position = await this.prisma.criticalPosition.findUnique({
      where: { id: data.criticalPositionId },
    });

    if (!position) throw new Error("Critical position not found");

    // Check if plan already exists
    const existing = await this.prisma.successionPlan.findFirst({
      where: {
        criticalPositionId: data.criticalPositionId,
        status: { not: "ARCHIVED" },
      },
    });

    if (existing)
      throw new Error(
        "Active succession plan already exists for this position",
      );

    const plan = await this.prisma.successionPlan.create({
      data: {
        criticalPositionId: data.criticalPositionId,
        name: data.name,
        description: data.description,
        status: SuccessionPlanStatus.DRAFT,
        targetReadyNowCount: data.targetReadyNowCount,
        targetBenchStrength: data.targetBenchStrength,
        currentReadyNowCount: 0,
        currentBenchStrength: 0,
        reviewFrequency: data.reviewFrequency,
        planOwnerId: data.planOwnerId,
        hrPartnerId: data.hrPartnerId,
        createdBy,
      },
    });

    // Update critical position with plan reference
    await this.prisma.criticalPosition.update({
      where: { id: data.criticalPositionId },
      data: { successionPlanId: plan.id },
    });

    return plan as unknown as SuccessionPlan;
  }

  async addSuccessor(data: AddSuccessorDto): Promise<SuccessorCandidate> {
    // Verify plan exists
    const plan = await this.prisma.successionPlan.findUnique({
      where: { id: data.successionPlanId },
      include: { successors: true },
    });

    if (!plan) throw new Error("Succession plan not found");

    // Verify talent profile exists
    const talentProfile = await this.prisma.talentProfile.findUnique({
      where: { id: data.talentProfileId },
    });

    if (!talentProfile) throw new Error("Talent profile not found");

    // Check if already a successor
    const existing = plan.successors.find(
      (s) => s.talentProfileId === data.talentProfileId,
    );
    if (existing)
      throw new Error("Employee is already a successor for this position");

    // Calculate fit scores
    const fitScores = await this.calculateSuccessorFit(
      data.talentProfileId,
      plan.criticalPositionId,
    );

    // Determine rank (next available)
    const maxRank = Math.max(0, ...plan.successors.map((s) => s.rank));

    const successor = await this.prisma.successorCandidate.create({
      data: {
        successionPlanId: data.successionPlanId,
        talentProfileId: data.talentProfileId,
        rank: maxRank + 1,
        isEmergencySuccessor: data.isEmergencySuccessor,
        readiness: data.readiness,
        readinessScore: this.getReadinessScore(data.readiness),
        readinessAssessmentDate: new Date(),
        competencyFitScore: fitScores.competencyFit,
        experienceFitScore: fitScores.experienceFit,
        culturalFitScore: fitScores.culturalFit,
        overallFitScore: fitScores.overall,
        competencyGaps: fitScores.competencyGaps as unknown as Prisma.JsonArray,
        experienceGaps: fitScores.experienceGaps,
        flightRisk: talentProfile.flightRisk as FlightRisk,
        acceptanceLikelihood: 80, // Default
        assessmentNotes: data.assessmentNotes,
        status: "ACTIVE",
        addedDate: new Date(),
        lastUpdated: new Date(),
      },
    });

    // Update plan metrics
    await this.updatePlanMetrics(data.successionPlanId);

    // Update talent profile
    await this.prisma.talentProfile.update({
      where: { id: data.talentProfileId },
      data: {
        successorForPositions: {
          push: plan.criticalPositionId,
        },
      },
    });

    return successor as unknown as SuccessorCandidate;
  }

  private getReadinessScore(readiness: SuccessorReadiness): number {
    const scores: Record<SuccessorReadiness, number> = {
      [SuccessorReadiness.READY_NOW]: 100,
      [SuccessorReadiness.READY_1_YEAR]: 75,
      [SuccessorReadiness.READY_2_YEARS]: 50,
      [SuccessorReadiness.READY_3_PLUS]: 25,
      [SuccessorReadiness.NOT_READY]: 0,
    };
    return scores[readiness];
  }

  private async calculateSuccessorFit(
    talentProfileId: string,
    criticalPositionId: string,
  ): Promise<{
    competencyFit: number;
    experienceFit: number;
    culturalFit: number;
    overall: number;
    competencyGaps: Array<{ competencyId: string; gap: number }>;
    experienceGaps: string[];
  }> {
    const profile = await this.prisma.talentProfile.findUnique({
      where: { id: talentProfileId },
    });

    const position = await this.prisma.criticalPosition.findUnique({
      where: { id: criticalPositionId },
    });

    if (!profile || !position) {
      return {
        competencyFit: 0,
        experienceFit: 0,
        culturalFit: 70, // Default
        overall: 0,
        competencyGaps: [],
        experienceGaps: [],
      };
    }

    // Calculate competency fit
    const requiredCompetencies = (position.keyCompetencies as any[]) || [];
    const profileCompetencies = (profile.competencyProfile as any[]) || [];

    let competencyScore = 0;
    const competencyGaps: Array<{ competencyId: string; gap: number }> = [];

    for (const required of requiredCompetencies) {
      const profileComp = profileCompetencies.find(
        (c) => c.competencyId === required.competencyId,
      );
      if (profileComp) {
        const gap = required.requiredLevel - (profileComp.currentLevel || 0);
        if (gap > 0) {
          competencyGaps.push({ competencyId: required.competencyId, gap });
        }
        competencyScore += Math.max(0, 100 - gap * 20); // -20 points per level gap
      } else {
        competencyGaps.push({
          competencyId: required.competencyId,
          gap: required.requiredLevel,
        });
      }
    }

    const competencyFit =
      requiredCompetencies.length > 0
        ? Math.round(competencyScore / requiredCompetencies.length)
        : 70;

    // Calculate experience fit
    const requiredExperiences = position.keyExperiences || [];
    const profileExperiences = ((profile.keyExperiences as any[]) || []).map(
      (e) => e.experienceType,
    );

    const experienceGaps = requiredExperiences.filter(
      (e) => !profileExperiences.includes(e),
    );
    const experienceFit =
      requiredExperiences.length > 0
        ? Math.round(
            ((requiredExperiences.length - experienceGaps.length) /
              requiredExperiences.length) *
              100,
          )
        : 70;

    // Overall fit (weighted)
    const overall = Math.round(
      competencyFit * 0.5 + experienceFit * 0.3 + 70 * 0.2,
    ); // 70 = default cultural

    return {
      competencyFit,
      experienceFit,
      culturalFit: 70,
      overall,
      competencyGaps,
      experienceGaps,
    };
  }

  async updateSuccessorReadiness(
    successorId: string,
    readiness: SuccessorReadiness,
    notes?: string,
  ): Promise<SuccessorCandidate> {
    const successor = await this.prisma.successorCandidate.update({
      where: { id: successorId },
      data: {
        readiness,
        readinessScore: this.getReadinessScore(readiness),
        readinessAssessmentDate: new Date(),
        assessmentNotes: notes,
        lastUpdated: new Date(),
      },
    });

    // Update plan metrics
    await this.updatePlanMetrics(successor.successionPlanId);

    return successor as unknown as SuccessorCandidate;
  }

  async removeSuccessor(successorId: string, reason: string): Promise<void> {
    const successor = await this.prisma.successorCandidate.findUnique({
      where: { id: successorId },
    });

    if (!successor) throw new Error("Successor not found");

    await this.prisma.successorCandidate.update({
      where: { id: successorId },
      data: {
        status: "REMOVED",
        removalReason: reason,
        lastUpdated: new Date(),
      },
    });

    // Update plan metrics
    await this.updatePlanMetrics(successor.successionPlanId);
  }

  private async updatePlanMetrics(planId: string): Promise<void> {
    const plan = await this.prisma.successionPlan.findUnique({
      where: { id: planId },
      include: {
        successors: {
          where: { status: "ACTIVE" },
        },
      },
    });

    if (!plan) return;

    const readyNowCount = plan.successors.filter(
      (s) => s.readiness === SuccessorReadiness.READY_NOW,
    ).length;
    const benchStrength = this.calculateBenchStrength(plan.successors as any);

    await this.prisma.successionPlan.update({
      where: { id: planId },
      data: {
        currentReadyNowCount: readyNowCount,
        currentBenchStrength: benchStrength,
      },
    });

    // Update critical position
    await this.prisma.criticalPosition.update({
      where: { id: plan.criticalPositionId },
      data: {
        readyNowCount,
        benchStrength,
      },
    });
  }

  async getSuccessionPlan(planId: string): Promise<SuccessionPlan | null> {
    return this.prisma.successionPlan.findUnique({
      where: { id: planId },
      include: {
        criticalPosition: true,
        successors: {
          where: { status: "ACTIVE" },
          include: { talentProfile: true },
          orderBy: { rank: "asc" },
        },
        reviewHistory: {
          orderBy: { reviewDate: "desc" },
          take: 5,
        },
      },
    }) as unknown as SuccessionPlan;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DEVELOPMENT PLANS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createDevelopmentPlan(
    data: CreateDevelopmentPlanDto,
    createdBy: string,
  ): Promise<DevelopmentPlan> {
    const talentProfile = await this.prisma.talentProfile.findUnique({
      where: { id: data.talentProfileId },
    });

    if (!talentProfile) throw new Error("Talent profile not found");

    const plan = await this.prisma.developmentPlan.create({
      data: {
        talentProfileId: data.talentProfileId,
        name: data.name,
        description: data.description,
        targetPositionId: data.targetPositionId,
        targetPositionTitle: data.targetPositionId
          ? (
              await this.prisma.position.findUnique({
                where: { id: data.targetPositionId },
              })
            )?.title
          : undefined,
        targetReadiness: data.targetReadiness,
        targetDate: data.targetDate,
        totalActivities: 0,
        completedActivities: 0,
        inProgressActivities: 0,
        overallProgress: 0,
        competencyProgress: [],
        status: "DRAFT",
        reviewFrequency: data.reviewFrequency,
        planOwnerId: talentProfile.employeeId,
        managerId: talentProfile.managerId || "",
        hrPartnerId: undefined,
        mentorId: data.mentorId,
        budgetAllocated: data.budgetAllocated,
        budgetUsed: 0,
        createdBy,
      },
    });

    // Link to talent profile
    await this.prisma.talentProfile.update({
      where: { id: data.talentProfileId },
      data: { developmentPlanId: plan.id },
    });

    return plan as unknown as DevelopmentPlan;
  }

  async addDevelopmentActivity(
    data: AddDevelopmentActivityDto,
  ): Promise<DevelopmentActivity> {
    const plan = await this.prisma.developmentPlan.findUnique({
      where: { id: data.developmentPlanId },
    });

    if (!plan) throw new Error("Development plan not found");

    const activity = await this.prisma.developmentActivity.create({
      data: {
        developmentPlanId: data.developmentPlanId,
        name: data.name,
        description: data.description,
        type: data.type,
        category: data.category,
        targetCompetencies: data.targetCompetencies,
        targetExperiences: [],
        plannedStartDate: data.plannedStartDate,
        plannedEndDate: data.plannedEndDate,
        status: "NOT_STARTED",
        progress: 0,
        activityDetails: data.activityDetails as unknown as Prisma.JsonObject,
        priority: data.priority,
        ownerId: plan.planOwnerId,
      },
    });

    // Update plan totals
    await this.updateDevelopmentPlanProgress(data.developmentPlanId);

    return activity as unknown as DevelopmentActivity;
  }

  async updateActivityProgress(
    activityId: string,
    status:
      | "NOT_STARTED"
      | "IN_PROGRESS"
      | "COMPLETED"
      | "DEFERRED"
      | "CANCELLED",
    progress: number,
    notes?: string,
  ): Promise<DevelopmentActivity> {
    const activity = await this.prisma.developmentActivity.update({
      where: { id: activityId },
      data: {
        status,
        progress,
        actualStartDate:
          status === "IN_PROGRESS" && !activity.actualStartDate
            ? new Date()
            : undefined,
        actualEndDate: status === "COMPLETED" ? new Date() : undefined,
        feedbackNotes: notes,
      },
    });

    // Update plan progress
    await this.updateDevelopmentPlanProgress(activity.developmentPlanId);

    return activity as unknown as DevelopmentActivity;
  }

  private async updateDevelopmentPlanProgress(planId: string): Promise<void> {
    const activities = await this.prisma.developmentActivity.findMany({
      where: { developmentPlanId: planId },
    });

    const total = activities.length;
    const completed = activities.filter((a) => a.status === "COMPLETED").length;
    const inProgress = activities.filter(
      (a) => a.status === "IN_PROGRESS",
    ).length;
    const overallProgress =
      total > 0
        ? Math.round(activities.reduce((sum, a) => sum + a.progress, 0) / total)
        : 0;

    await this.prisma.developmentPlan.update({
      where: { id: planId },
      data: {
        totalActivities: total,
        completedActivities: completed,
        inProgressActivities: inProgress,
        overallProgress,
        status:
          completed === total && total > 0
            ? "COMPLETED"
            : overallProgress > 0
              ? "ACTIVE"
              : "DRAFT",
      },
    });

    // Update talent profile
    const plan = await this.prisma.developmentPlan.findUnique({
      where: { id: planId },
    });
    if (plan) {
      await this.prisma.talentProfile.update({
        where: { id: plan.talentProfileId },
        data: {
          activeDevelopmentActivities: inProgress,
          completedDevelopmentActivities: completed,
        },
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TALENT POOLS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createTalentPool(
    data: Partial<TalentPool>,
    createdBy: string,
  ): Promise<TalentPool> {
    const pool = await this.prisma.talentPool.create({
      data: {
        name: data.name!,
        description: data.description,
        type: data.type || "CUSTOM",
        criteria: data.criteria as unknown as Prisma.JsonObject,
        memberCount: 0,
        targetSize: data.targetSize,
        poolOwnerId: data.poolOwnerId!,
        hrPartnerId: data.hrPartnerId,
        reviewFrequency: data.reviewFrequency || "SEMI_ANNUAL",
        isActive: true,
        createdBy,
      },
    });

    return pool as unknown as TalentPool;
  }

  async addToTalentPool(
    poolId: string,
    talentProfileId: string,
    addedBy: string,
    reason?: string,
  ): Promise<void> {
    const pool = await this.prisma.talentPool.findUnique({
      where: { id: poolId },
    });
    const profile = await this.prisma.talentProfile.findUnique({
      where: { id: talentProfileId },
    });

    if (!pool || !profile) throw new Error("Pool or profile not found");

    // Check if already member
    const existing = await this.prisma.talentPoolMember.findFirst({
      where: { poolId, talentProfileId, status: "ACTIVE" },
    });

    if (existing) throw new Error("Already a member of this pool");

    await this.prisma.talentPoolMember.create({
      data: {
        poolId,
        talentProfileId,
        addedDate: new Date(),
        addedBy,
        addedReason: reason,
        status: "ACTIVE",
        entryNineBoxPosition: profile.nineBoxPosition as NineBoxPosition,
        currentNineBoxPosition: profile.nineBoxPosition as NineBoxPosition,
      },
    });

    // Update member count
    await this.prisma.talentPool.update({
      where: { id: poolId },
      data: { memberCount: { increment: 1 } },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // NINE BOX GRID
  // ═══════════════════════════════════════════════════════════════════════════════

  async assessNineBox(
    data: NineBoxAssessmentDto,
    assessedBy: string,
  ): Promise<TalentProfile> {
    // Get or create talent profile
    let profile = await this.prisma.talentProfile.findFirst({
      where: { employeeId: data.employeeId },
    });

    if (!profile) {
      profile = (await this.createTalentProfile(data.employeeId)) as any;
    }

    const nineBoxPosition = this.calculateNineBoxPosition(
      data.performanceScore,
      data.potentialScore,
    );

    const updated = await this.prisma.talentProfile.update({
      where: { id: profile.id },
      data: {
        performanceRating: data.performanceScore,
        potentialRating: data.potentialScore,
        nineBoxPosition,
        lastTalentReviewDate: new Date(),
        hrNotes: data.notes,
      },
    });

    return updated as unknown as TalentProfile;
  }

  async getNineBoxDistribution(departmentId?: string): Promise<
    {
      position: NineBoxPosition;
      count: number;
      employees: Array<{ id: string; name: string; position: string }>;
    }[]
  > {
    const where: Prisma.TalentProfileWhereInput = departmentId
      ? { departmentId }
      : {};

    const profiles = await this.prisma.talentProfile.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        currentPositionTitle: true,
        nineBoxPosition: true,
      },
    });

    const distribution = Object.values(NineBoxPosition).map((position) => ({
      position,
      count: profiles.filter((p) => p.nineBoxPosition === position).length,
      employees: profiles
        .filter((p) => p.nineBoxPosition === position)
        .map((p) => ({
          id: p.id,
          name: p.fullName,
          position: p.currentPositionTitle,
        })),
    }));

    return distribution;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════════

  async getSuccessionAnalytics(): Promise<SuccessionAnalytics> {
    const [criticalPositions, talentProfiles, successors] = await Promise.all([
      this.prisma.criticalPosition.findMany(),
      this.prisma.talentProfile.findMany(),
      this.prisma.successorCandidate.findMany({ where: { status: "ACTIVE" } }),
    ]);

    // Critical positions overview
    const criticalOverview = {
      total: criticalPositions.length,
      byCategory: Object.values(PositionCriticality).map((c) => ({
        criticality: c,
        count: criticalPositions.filter((p) => p.criticality === c).length,
      })),
      withSuccessors: criticalPositions.filter(
        (p) =>
          p.readyNowCount > 0 ||
          successors.some(
            (s) =>
              s.successionPlanId &&
              criticalPositions.find(
                (cp) => cp.successionPlanId === s.successionPlanId,
              )?.id === p.id,
          ),
      ).length,
      withoutSuccessors: criticalPositions.filter((p) => p.readyNowCount === 0)
        .length,
      withReadyNow: criticalPositions.filter((p) => p.readyNowCount > 0).length,
      avgBenchStrength:
        criticalPositions.length > 0
          ? Math.round(
              criticalPositions.reduce((sum, p) => sum + p.benchStrength, 0) /
                criticalPositions.length,
            )
          : 0,
    };

    // Succession health
    const healthScore = this.calculateSuccessionHealthScore(
      criticalPositions,
      successors,
    );

    // Talent distribution
    const nineBoxDistribution = Object.values(NineBoxPosition).map(
      (position) => ({
        position,
        count: talentProfiles.filter((p) => p.nineBoxPosition === position)
          .length,
        percentage:
          talentProfiles.length > 0
            ? Math.round(
                (talentProfiles.filter((p) => p.nineBoxPosition === position)
                  .length /
                  talentProfiles.length) *
                  100,
              )
            : 0,
      }),
    );

    const categoryDistribution = Object.values(TalentCategory).map(
      (category) => ({
        category,
        count: talentProfiles.filter((p) => p.talentCategory === category)
          .length,
        percentage:
          talentProfiles.length > 0
            ? Math.round(
                (talentProfiles.filter((p) => p.talentCategory === category)
                  .length /
                  talentProfiles.length) *
                  100,
              )
            : 0,
      }),
    );

    // Risk analysis
    const flightRiskAnalysis = Object.values(FlightRisk).map((level) => ({
      level,
      count: talentProfiles.filter((p) => p.flightRisk === level).length,
      criticalRoles: 0, // Would need to join with critical positions
    }));

    return {
      asOfDate: new Date(),
      criticalPositions: criticalOverview,
      successionHealth: {
        healthScore,
        readyNowCoverage:
          criticalPositions.length > 0
            ? Math.round(
                (criticalOverview.withReadyNow / criticalPositions.length) *
                  100,
              )
            : 0,
        pipelineCoverage:
          criticalPositions.length > 0
            ? Math.round(
                (criticalOverview.withSuccessors / criticalPositions.length) *
                  100,
              )
            : 0,
        avgSuccessorsPerPosition:
          criticalPositions.length > 0
            ? Math.round((successors.length / criticalPositions.length) * 10) /
              10
            : 0,
        atRiskPositions: criticalPositions.filter(
          (p) =>
            p.vacancyRisk === RiskLevel.CRITICAL ||
            p.vacancyRisk === RiskLevel.HIGH,
        ).length,
      },
      talentDistribution: {
        byNineBox: nineBoxDistribution,
        byCategory: categoryDistribution,
        byDepartment: [], // Would aggregate by department
      },
      riskAnalysis: {
        flightRisk: flightRiskAnalysis,
        retirementRisk: [],
        singlePointsOfFailure: criticalPositions.filter(
          (p) => p.readyNowCount === 0 && !p.isVacant,
        ).length,
        keyPersonDependency: 0,
      },
      developmentProgress: {
        activePlans: 0,
        completedPlans: 0,
        avgPlanProgress: 0,
        activitiesCompleted: 0,
        activitiesInProgress: 0,
      },
      talentMovement: {
        promotions: 0,
        lateralMoves: 0,
        successionsExecuted: 0,
        externalHires: 0,
        regrettableLosses: 0,
      },
    };
  }

  private calculateSuccessionHealthScore(
    positions: any[],
    successors: any[],
  ): number {
    if (positions.length === 0) return 0;

    let score = 0;

    // Coverage (40 points max)
    const coverageRate =
      positions.filter((p) => p.readyNowCount > 0).length / positions.length;
    score += coverageRate * 40;

    // Bench strength (30 points max)
    const avgBenchStrength =
      positions.reduce((sum, p) => sum + p.benchStrength, 0) / positions.length;
    score += (avgBenchStrength / 100) * 30;

    // Depth (30 points max) - at least 2 successors per position
    const depthRate =
      positions.filter(
        (p) =>
          successors.filter((s) => s.successionPlanId === p.successionPlanId)
            .length >= 2,
      ).length / positions.length;
    score += depthRate * 30;

    return Math.round(score);
  }

  async getDashboardData(): Promise<SuccessionDashboardData> {
    const analytics = await this.getSuccessionAnalytics();

    const criticalPositions = await this.prisma.criticalPosition.findMany({
      take: 10,
      orderBy: [{ criticality: "asc" }, { benchStrength: "asc" }],
      include: {
        currentIncumbent: true,
        _count: { select: { successors: true } },
      },
    });

    return {
      summary: {
        criticalPositionsCount: analytics.criticalPositions.total,
        criticalPositionsWithSuccessors:
          analytics.criticalPositions.withSuccessors,
        readyNowSuccessors: 0,
        avgBenchStrength: analytics.criticalPositions.avgBenchStrength,
        highPotentialsCount:
          analytics.talentDistribution.byCategory.find(
            (c) => c.category === TalentCategory.HIGH_POTENTIAL,
          )?.count || 0,
        atRiskPositions: analytics.successionHealth.atRiskPositions,
      },
      criticalPositionsList: criticalPositions.map((p) => ({
        id: p.id,
        title: p.jobTitle,
        department: p.departmentName,
        incumbent: p.currentIncumbent
          ? `${p.currentIncumbent.firstName} ${p.currentIncumbent.lastName}`
          : "Vacant",
        benchStrength: p.benchStrength,
        readyNow: p.readyNowCount,
        totalSuccessors: p._count.successors,
        riskLevel: p.vacancyRisk as RiskLevel,
      })),
      readinessMatrix: Object.values(SuccessorReadiness).map((readiness) => ({
        readiness,
        count: 0,
        positions: [],
      })),
      recentChanges: [],
      upcomingReviews: [],
    };
  }
}

export default SuccessionService;
