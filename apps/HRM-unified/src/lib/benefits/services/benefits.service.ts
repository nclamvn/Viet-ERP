// @ts-nocheck - Prisma models not yet in schema (Phase 6)
// benefits-administration/services/benefits.service.ts

/**
 * LAC VIET HR - Benefits Administration Service
 * Business logic for employee benefits management
 */

import { PrismaClient, Prisma } from ".prisma/hrm-unified-client";
import {
  BenefitPlan,
  BenefitCategory,
  BenefitPlanType,
  BenefitEnrollment,
  EnrollmentStatus,
  EnrollmentPeriod,
  EnrollmentPeriodType,
  Dependent,
  DependentRelationship,
  LifeEvent,
  LifeEventType,
  BenefitClaim,
  ClaimStatus,
  FlexBenefitAccount,
  BenefitsAnalytics,
  EmployeeBenefitsSummary,
  CoverageLevel,
  CreateBenefitPlanDto,
  CreateEnrollmentDto,
  CreateLifeEventDto,
  CreateDependentDto,
  SubmitClaimDto,
  BenefitPlanFilters,
  EnrollmentFilters,
} from "../types/benefits.types";

export class BenefitsService {
  constructor(private prisma: PrismaClient) {}

  // ═══════════════════════════════════════════════════════════════════════════════
  // BENEFIT PLANS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createBenefitPlan(data: CreateBenefitPlanDto): Promise<BenefitPlan> {
    const plan = await this.prisma.benefitPlan.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description,
        category: data.category,
        planType: data.planType,
        vendorId: data.vendorId,
        eligibilityRules: data.eligibilityRules as unknown as Prisma.JsonObject,
        waitingPeriodDays: data.waitingPeriodDays,
        effectiveDate: data.effectiveDate,
        planYear: data.planYear,
        isActive: true,
      },
    });

    return plan as unknown as BenefitPlan;
  }

  async updateBenefitPlan(
    planId: string,
    data: Partial<BenefitPlan>,
  ): Promise<BenefitPlan> {
    const plan = await this.prisma.benefitPlan.update({
      where: { id: planId },
      data: {
        ...data,
        eligibilityRules: data.eligibilityRules as unknown as Prisma.JsonObject,
      },
    });

    return plan as unknown as BenefitPlan;
  }

  async getBenefitPlan(planId: string): Promise<BenefitPlan | null> {
    return this.prisma.benefitPlan.findUnique({
      where: { id: planId },
      include: {
        coverageOptions: true,
        vendor: true,
      },
    }) as unknown as BenefitPlan;
  }

  async listBenefitPlans(
    filters: BenefitPlanFilters,
    page: number = 1,
    limit: number = 20,
  ) {
    const where: Prisma.BenefitPlanWhereInput = {};

    if (filters.category) where.category = filters.category;
    if (filters.planType) where.planType = filters.planType;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.planYear) where.planYear = filters.planYear;

    const [plans, total] = await Promise.all([
      this.prisma.benefitPlan.findMany({
        where,
        include: {
          coverageOptions: true,
          vendor: true,
          _count: { select: { enrollments: true } },
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.benefitPlan.count({ where }),
    ]);

    return {
      data: plans,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getEligiblePlansForEmployee(
    employeeId: string,
  ): Promise<BenefitPlan[]> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { department: true },
    });

    if (!employee) throw new Error("Employee not found");

    const plans = await this.prisma.benefitPlan.findMany({
      where: { isActive: true },
      include: { coverageOptions: { where: { isActive: true } } },
    });

    // Filter by eligibility rules
    const eligiblePlans = plans.filter((plan) => {
      const rules = plan.eligibilityRules as any;

      // Check employment type
      if (
        rules.employmentTypes?.length &&
        !rules.employmentTypes.includes(employee.employmentType)
      ) {
        return false;
      }

      // Check employment status
      if (
        rules.employmentStatuses?.length &&
        !rules.employmentStatuses.includes(employee.status)
      ) {
        return false;
      }

      // Check tenure
      if (rules.minTenureDays) {
        const tenureDays = Math.floor(
          (Date.now() - new Date(employee.hireDate).getTime()) /
            (1000 * 60 * 60 * 24),
        );
        if (tenureDays < rules.minTenureDays) return false;
      }

      // Check department
      if (
        rules.eligibleDepartmentIds?.length &&
        !rules.eligibleDepartmentIds.includes(employee.departmentId)
      ) {
        return false;
      }

      // Check exclusions
      if (rules.excludedEmployeeIds?.includes(employeeId)) {
        return false;
      }

      return true;
    });

    return eligiblePlans as unknown as BenefitPlan[];
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ENROLLMENT PERIODS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createEnrollmentPeriod(
    data: Partial<EnrollmentPeriod>,
    createdBy: string,
  ): Promise<EnrollmentPeriod> {
    // Get eligible employee count
    const eligibleCount = await this.getEligibleEmployeeCount(
      data.planIds || [],
    );

    const period = await this.prisma.enrollmentPeriod.create({
      data: {
        name: data.name!,
        description: data.description,
        type: data.type || EnrollmentPeriodType.OPEN_ENROLLMENT,
        startDate: data.startDate!,
        endDate: data.endDate!,
        effectiveDate: data.effectiveDate!,
        planIds: data.planIds || [],
        isActive: true,
        isLocked: false,
        totalEligible: eligibleCount,
        totalEnrolled: 0,
        totalWaived: 0,
        totalPending: 0,
        createdBy,
      },
    });

    return period as unknown as EnrollmentPeriod;
  }

  async getActiveEnrollmentPeriods(): Promise<EnrollmentPeriod[]> {
    const now = new Date();
    return this.prisma.enrollmentPeriod.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { endDate: "asc" },
    }) as unknown as EnrollmentPeriod[];
  }

  async lockEnrollmentPeriod(periodId: string): Promise<EnrollmentPeriod> {
    return this.prisma.enrollmentPeriod.update({
      where: { id: periodId },
      data: { isLocked: true },
    }) as unknown as EnrollmentPeriod;
  }

  private async getEligibleEmployeeCount(planIds: string[]): Promise<number> {
    // Simplified - would need to check each plan's eligibility rules
    return this.prisma.employee.count({
      where: { status: "ACTIVE" },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ENROLLMENTS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createEnrollment(
    data: CreateEnrollmentDto,
    enrolledBy: string,
  ): Promise<BenefitEnrollment> {
    // Validate enrollment period is active
    const period = await this.prisma.enrollmentPeriod.findUnique({
      where: { id: data.enrollmentPeriodId },
    });

    if (!period || period.isLocked) {
      throw new Error("Enrollment period is not available");
    }

    const now = new Date();
    if (now < period.startDate || now > period.endDate) {
      throw new Error("Outside enrollment period dates");
    }

    // Get plan and coverage option
    const plan = await this.prisma.benefitPlan.findUnique({
      where: { id: data.planId },
      include: { coverageOptions: true },
    });

    if (!plan) throw new Error("Benefit plan not found");

    const coverageOption = plan.coverageOptions.find(
      (o) => o.id === data.coverageOptionId,
    );
    if (!coverageOption) throw new Error("Coverage option not found");

    // Check for existing enrollment
    const existing = await this.prisma.benefitEnrollment.findFirst({
      where: {
        employeeId: data.employeeId,
        planId: data.planId,
        status: { in: ["ENROLLED", "PENDING"] },
      },
    });

    if (existing) {
      throw new Error("Already enrolled in this plan");
    }

    // Calculate costs
    const employeeContribution =
      coverageOption.employeePremium?.annualAmount || 0;
    const employerContribution =
      coverageOption.employerPremium?.annualAmount || 0;

    const enrollment = await this.prisma.benefitEnrollment.create({
      data: {
        employeeId: data.employeeId,
        enrollmentPeriodId: data.enrollmentPeriodId,
        planId: data.planId,
        coverageOptionId: data.coverageOptionId,
        status: data.waiverReason
          ? EnrollmentStatus.WAIVED
          : EnrollmentStatus.PENDING,
        coverageStartDate: period.effectiveDate,
        dependentIds: data.dependentIds || [],
        beneficiaries: data.beneficiaries as unknown as Prisma.JsonArray,
        employeeContribution,
        employerContribution,
        totalCost: employeeContribution + employerContribution,
        paymentFrequency: "MONTHLY",
        waiverReason: data.waiverReason,
        enrolledAt: new Date(),
        enrolledBy,
        lastModifiedAt: new Date(),
        lastModifiedBy: enrolledBy,
      },
    });

    // Update enrollment period stats
    await this.updateEnrollmentPeriodStats(data.enrollmentPeriodId);

    return enrollment as unknown as BenefitEnrollment;
  }

  async approveEnrollment(
    enrollmentId: string,
    approvedBy: string,
  ): Promise<BenefitEnrollment> {
    const enrollment = await this.prisma.benefitEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: EnrollmentStatus.ENROLLED,
        approvedBy,
        approvedAt: new Date(),
        lastModifiedAt: new Date(),
        lastModifiedBy: approvedBy,
      },
    });

    await this.updateEnrollmentPeriodStats(enrollment.enrollmentPeriodId);

    return enrollment as unknown as BenefitEnrollment;
  }

  async terminateEnrollment(
    enrollmentId: string,
    terminationDate: Date,
    reason: string,
    terminatedBy: string,
  ): Promise<BenefitEnrollment> {
    const enrollment = await this.prisma.benefitEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: EnrollmentStatus.TERMINATED,
        coverageEndDate: terminationDate,
        notes: reason,
        lastModifiedAt: new Date(),
        lastModifiedBy: terminatedBy,
      },
    });

    return enrollment as unknown as BenefitEnrollment;
  }

  async getEmployeeEnrollments(
    employeeId: string,
    activeOnly: boolean = true,
  ): Promise<BenefitEnrollment[]> {
    const where: Prisma.BenefitEnrollmentWhereInput = { employeeId };

    if (activeOnly) {
      where.status = EnrollmentStatus.ENROLLED;
      where.OR = [
        { coverageEndDate: null },
        { coverageEndDate: { gte: new Date() } },
      ];
    }

    return this.prisma.benefitEnrollment.findMany({
      where,
      include: {
        plan: true,
        coverageOption: true,
        enrollmentPeriod: true,
      },
      orderBy: { coverageStartDate: "desc" },
    }) as unknown as BenefitEnrollment[];
  }

  async listEnrollments(
    filters: EnrollmentFilters,
    page: number = 1,
    limit: number = 50,
  ) {
    const where: Prisma.BenefitEnrollmentWhereInput = {};

    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.planId) where.planId = filters.planId;
    if (filters.status) where.status = filters.status;
    if (filters.enrollmentPeriodId)
      where.enrollmentPeriodId = filters.enrollmentPeriodId;

    const [enrollments, total] = await Promise.all([
      this.prisma.benefitEnrollment.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
            },
          },
          plan: true,
          coverageOption: true,
        },
        orderBy: { enrolledAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.benefitEnrollment.count({ where }),
    ]);

    return {
      data: enrollments,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async updateEnrollmentPeriodStats(periodId: string): Promise<void> {
    const stats = await this.prisma.benefitEnrollment.groupBy({
      by: ["status"],
      where: { enrollmentPeriodId: periodId },
      _count: true,
    });

    const enrolled = stats.find((s) => s.status === "ENROLLED")?._count || 0;
    const waived = stats.find((s) => s.status === "WAIVED")?._count || 0;
    const pending = stats.find((s) => s.status === "PENDING")?._count || 0;

    await this.prisma.enrollmentPeriod.update({
      where: { id: periodId },
      data: {
        totalEnrolled: enrolled,
        totalWaived: waived,
        totalPending: pending,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DEPENDENTS
  // ═══════════════════════════════════════════════════════════════════════════════

  async addDependent(data: CreateDependentDto): Promise<Dependent> {
    // Calculate eligibility end date for children
    let eligibilityEndDate: Date | undefined;
    if (data.relationship === DependentRelationship.CHILD && !data.isDisabled) {
      const dob = new Date(data.dateOfBirth);
      eligibilityEndDate = new Date(
        dob.getFullYear() + 26,
        dob.getMonth(),
        dob.getDate(),
      );
    }

    const dependent = await this.prisma.dependent.create({
      data: {
        employeeId: data.employeeId,
        firstName: data.firstName,
        lastName: data.lastName,
        relationship: data.relationship,
        dateOfBirth: data.dateOfBirth,
        gender: data.gender,
        nationalId: data.nationalId,
        isDisabled: data.isDisabled || false,
        isStudent: data.isStudent || false,
        verificationStatus: "PENDING",
        isEligible: true,
        eligibilityEndDate,
      },
    });

    return dependent as unknown as Dependent;
  }

  async updateDependent(
    dependentId: string,
    data: Partial<Dependent>,
  ): Promise<Dependent> {
    const dependent = await this.prisma.dependent.update({
      where: { id: dependentId },
      data,
    });

    return dependent as unknown as Dependent;
  }

  async verifyDependent(
    dependentId: string,
    status: "VERIFIED" | "REJECTED",
    verifiedBy: string,
  ): Promise<Dependent> {
    const dependent = await this.prisma.dependent.update({
      where: { id: dependentId },
      data: {
        verificationStatus: status,
        verifiedAt: new Date(),
        verifiedBy,
        isEligible: status === "VERIFIED",
      },
    });

    return dependent as unknown as Dependent;
  }

  async getEmployeeDependents(employeeId: string): Promise<Dependent[]> {
    return this.prisma.dependent.findMany({
      where: { employeeId },
      orderBy: { createdAt: "desc" },
    }) as unknown as Dependent[];
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // LIFE EVENTS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createLifeEvent(data: CreateLifeEventDto): Promise<LifeEvent> {
    const eventDate = new Date(data.eventDate);
    const windowEnd = new Date(eventDate);
    windowEnd.setDate(windowEnd.getDate() + 30); // 30-day window

    // Get affected plans based on event type
    const affectedPlanIds = await this.getAffectedPlansByEventType(
      data.eventType,
    );

    const lifeEvent = await this.prisma.lifeEvent.create({
      data: {
        employeeId: data.employeeId,
        eventType: data.eventType,
        eventDate: data.eventDate,
        description: data.description,
        supportingDocuments:
          data.supportingDocuments as unknown as Prisma.JsonArray,
        enrollmentWindowStart: eventDate,
        enrollmentWindowEnd: windowEnd,
        affectedPlanIds,
        status: "PENDING",
        submittedAt: new Date(),
      },
    });

    return lifeEvent as unknown as LifeEvent;
  }

  async approveLifeEvent(
    lifeEventId: string,
    reviewedBy: string,
    notes?: string,
  ): Promise<LifeEvent> {
    const lifeEvent = await this.prisma.lifeEvent.update({
      where: { id: lifeEventId },
      data: {
        status: "APPROVED",
        reviewedBy,
        reviewedAt: new Date(),
        reviewNotes: notes,
      },
    });

    return lifeEvent as unknown as LifeEvent;
  }

  async getEmployeeLifeEvents(employeeId: string): Promise<LifeEvent[]> {
    return this.prisma.lifeEvent.findMany({
      where: { employeeId },
      orderBy: { eventDate: "desc" },
    }) as unknown as LifeEvent[];
  }

  async getPendingLifeEvents(): Promise<LifeEvent[]> {
    return this.prisma.lifeEvent.findMany({
      where: { status: "PENDING" },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
      },
      orderBy: { submittedAt: "asc" },
    }) as unknown as LifeEvent[];
  }

  private async getAffectedPlansByEventType(
    eventType: LifeEventType,
  ): Promise<string[]> {
    // Map event types to benefit categories that can be changed
    const categoryMap: Record<LifeEventType, BenefitCategory[]> = {
      [LifeEventType.MARRIAGE]: [
        BenefitCategory.HEALTH,
        BenefitCategory.DENTAL,
        BenefitCategory.VISION,
        BenefitCategory.LIFE_INSURANCE,
      ],
      [LifeEventType.DIVORCE]: [
        BenefitCategory.HEALTH,
        BenefitCategory.DENTAL,
        BenefitCategory.VISION,
        BenefitCategory.LIFE_INSURANCE,
      ],
      [LifeEventType.BIRTH_ADOPTION]: [
        BenefitCategory.HEALTH,
        BenefitCategory.DENTAL,
        BenefitCategory.VISION,
        BenefitCategory.LIFE_INSURANCE,
      ],
      [LifeEventType.DEATH_DEPENDENT]: [
        BenefitCategory.HEALTH,
        BenefitCategory.DENTAL,
        BenefitCategory.VISION,
        BenefitCategory.LIFE_INSURANCE,
      ],
      [LifeEventType.SPOUSE_JOB_LOSS]: [
        BenefitCategory.HEALTH,
        BenefitCategory.DENTAL,
        BenefitCategory.VISION,
      ],
      [LifeEventType.SPOUSE_JOB_GAIN]: [
        BenefitCategory.HEALTH,
        BenefitCategory.DENTAL,
        BenefitCategory.VISION,
      ],
      [LifeEventType.ADDRESS_CHANGE]: [BenefitCategory.HEALTH],
      [LifeEventType.DEPENDENT_AGE_OUT]: [
        BenefitCategory.HEALTH,
        BenefitCategory.DENTAL,
        BenefitCategory.VISION,
      ],
      [LifeEventType.DISABILITY_STATUS]: [
        BenefitCategory.DISABILITY,
        BenefitCategory.LIFE_INSURANCE,
      ],
      [LifeEventType.COURT_ORDER]: [
        BenefitCategory.HEALTH,
        BenefitCategory.DENTAL,
        BenefitCategory.VISION,
      ],
      [LifeEventType.OTHER]: [],
    };

    const categories = categoryMap[eventType] || [];

    const plans = await this.prisma.benefitPlan.findMany({
      where: {
        category: { in: categories },
        isActive: true,
      },
      select: { id: true },
    });

    return plans.map((p) => p.id);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // CLAIMS
  // ═══════════════════════════════════════════════════════════════════════════════

  async submitClaim(
    data: SubmitClaimDto,
    submittedBy: string,
  ): Promise<BenefitClaim> {
    const claimNumber = await this.generateClaimNumber();

    // Get patient name
    let patientName: string;
    if (data.patientRelationship === "SELF") {
      const employee = await this.prisma.employee.findUnique({
        where: { id: submittedBy },
      });
      patientName = `${employee?.firstName} ${employee?.lastName}`;
    } else {
      const dependent = await this.prisma.dependent.findUnique({
        where: { id: data.dependentId },
      });
      patientName = `${dependent?.firstName} ${dependent?.lastName}`;
    }

    const claim = await this.prisma.benefitClaim.create({
      data: {
        claimNumber,
        employeeId: submittedBy,
        enrollmentId: data.enrollmentId,
        claimType: data.claimType,
        serviceDate: data.serviceDate,
        submissionDate: new Date(),
        providerName: data.providerName,
        patientName,
        patientRelationship: data.patientRelationship,
        dependentId: data.dependentId,
        billedAmount: data.billedAmount,
        status: ClaimStatus.SUBMITTED,
        statusHistory: [
          {
            status: ClaimStatus.SUBMITTED,
            changedAt: new Date(),
            changedBy: submittedBy,
          },
        ] as unknown as Prisma.JsonArray,
        documents: data.documents as unknown as Prisma.JsonArray,
      },
    });

    return claim as unknown as BenefitClaim;
  }

  async reviewClaim(
    claimId: string,
    status: ClaimStatus,
    reviewedBy: string,
    data: {
      allowedAmount?: number;
      paidAmount?: number;
      employeeResponsibility?: number;
      notes?: string;
      denialReason?: string;
    },
  ): Promise<BenefitClaim> {
    const claim = await this.prisma.benefitClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) throw new Error("Claim not found");

    const statusHistory = (claim.statusHistory as any[]) || [];
    statusHistory.push({
      status,
      changedAt: new Date(),
      changedBy: reviewedBy,
      notes: data.notes,
    });

    const updated = await this.prisma.benefitClaim.update({
      where: { id: claimId },
      data: {
        status,
        statusHistory: statusHistory as unknown as Prisma.JsonArray,
        allowedAmount: data.allowedAmount,
        paidAmount: data.paidAmount,
        employeeResponsibility: data.employeeResponsibility,
        reviewedBy,
        reviewedAt: new Date(),
        reviewNotes: data.notes,
        denialReason: data.denialReason,
        paymentDate: status === ClaimStatus.PAID ? new Date() : undefined,
      },
    });

    return updated as unknown as BenefitClaim;
  }

  async getEmployeeClaims(
    employeeId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const [claims, total] = await Promise.all([
      this.prisma.benefitClaim.findMany({
        where: { employeeId },
        include: {
          enrollment: {
            include: { plan: true },
          },
        },
        orderBy: { submissionDate: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.benefitClaim.count({ where: { employeeId } }),
    ]);

    return {
      data: claims,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getPendingClaims(page: number = 1, limit: number = 50) {
    const [claims, total] = await Promise.all([
      this.prisma.benefitClaim.findMany({
        where: {
          status: { in: [ClaimStatus.SUBMITTED, ClaimStatus.UNDER_REVIEW] },
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
            },
          },
          enrollment: {
            include: { plan: true },
          },
        },
        orderBy: { submissionDate: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.benefitClaim.count({
        where: {
          status: { in: [ClaimStatus.SUBMITTED, ClaimStatus.UNDER_REVIEW] },
        },
      }),
    ]);

    return {
      data: claims,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async generateClaimNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.benefitClaim.count({
      where: {
        submissionDate: {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        },
      },
    });
    return `CLM-${year}-${String(count + 1).padStart(6, "0")}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FLEXIBLE BENEFITS
  // ═══════════════════════════════════════════════════════════════════════════════

  async createFlexAccount(
    employeeId: string,
    planYear: number,
    totalPoints: number,
    pointValue: number,
  ): Promise<FlexBenefitAccount> {
    const account = await this.prisma.flexBenefitAccount.create({
      data: {
        employeeId,
        planYear,
        totalPoints,
        usedPoints: 0,
        remainingPoints: totalPoints,
        pointValue,
        totalValue: totalPoints * pointValue,
        status: "DRAFT",
      },
    });

    return account as unknown as FlexBenefitAccount;
  }

  async selectFlexBenefit(
    accountId: string,
    planId: string,
    coverageOptionId: string | null,
    pointsToUse: number,
  ): Promise<FlexBenefitAccount> {
    const account = await this.prisma.flexBenefitAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) throw new Error("Flex account not found");
    if (account.status !== "DRAFT" && account.status !== "SUBMITTED") {
      throw new Error("Account is not editable");
    }
    if (pointsToUse > account.remainingPoints) {
      throw new Error("Insufficient flex points");
    }

    const plan = await this.prisma.benefitPlan.findUnique({
      where: { id: planId },
    });

    if (!plan) throw new Error("Plan not found");

    // Create selection
    await this.prisma.flexBenefitSelection.create({
      data: {
        accountId,
        planId,
        coverageOptionId,
        pointsUsed: pointsToUse,
        cashValue: pointsToUse * account.pointValue,
        status: "SELECTED",
        effectiveDate: new Date(account.planYear, 0, 1),
      },
    });

    // Update account
    const updated = await this.prisma.flexBenefitAccount.update({
      where: { id: accountId },
      data: {
        usedPoints: { increment: pointsToUse },
        remainingPoints: { decrement: pointsToUse },
      },
      include: { selections: true },
    });

    return updated as unknown as FlexBenefitAccount;
  }

  async submitFlexSelections(accountId: string): Promise<FlexBenefitAccount> {
    const account = await this.prisma.flexBenefitAccount.update({
      where: { id: accountId },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });

    return account as unknown as FlexBenefitAccount;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ═══════════════════════════════════════════════════════════════════════════════

  async getBenefitsAnalytics(planYear: number): Promise<BenefitsAnalytics> {
    const yearStart = new Date(planYear, 0, 1);
    const yearEnd = new Date(planYear, 11, 31);

    // Enrollment stats
    const enrollments = await this.prisma.benefitEnrollment.findMany({
      where: {
        coverageStartDate: { gte: yearStart, lte: yearEnd },
      },
      include: { plan: true, coverageOption: true },
    });

    const totalEligible = await this.prisma.employee.count({
      where: { status: "ACTIVE" },
    });

    const enrolledEmployees = new Set(
      enrollments
        .filter((e) => e.status === "ENROLLED")
        .map((e) => e.employeeId),
    );

    // Cost calculations
    const totalEmployerCost = enrollments
      .filter((e) => e.status === "ENROLLED")
      .reduce((sum, e) => sum + (e.employerContribution || 0), 0);

    const totalEmployeeCost = enrollments
      .filter((e) => e.status === "ENROLLED")
      .reduce((sum, e) => sum + (e.employeeContribution || 0), 0);

    // Claims stats
    const claims = await this.prisma.benefitClaim.findMany({
      where: {
        serviceDate: { gte: yearStart, lte: yearEnd },
      },
    });

    // Dependents
    const dependents = await this.prisma.dependent.findMany({
      where: { isEligible: true },
    });

    return {
      asOfDate: new Date(),
      planYear,
      enrollmentSummary: {
        totalEligible,
        totalEnrolled: enrolledEmployees.size,
        enrollmentRate:
          totalEligible > 0
            ? (enrolledEmployees.size / totalEligible) * 100
            : 0,
        byPlan: [],
        byCoverageLevel: [],
      },
      costSummary: {
        totalEmployerCost,
        totalEmployeeCost,
        totalCost: totalEmployerCost + totalEmployeeCost,
        averageEmployerCostPerEmployee:
          enrolledEmployees.size > 0
            ? totalEmployerCost / enrolledEmployees.size
            : 0,
        averageEmployeeCostPerEmployee:
          enrolledEmployees.size > 0
            ? totalEmployeeCost / enrolledEmployees.size
            : 0,
        byCategory: [],
      },
      claimsSummary: {
        totalClaims: claims.length,
        totalClaimedAmount: claims.reduce(
          (sum, c) => sum + (c.billedAmount || 0),
          0,
        ),
        totalPaidAmount: claims.reduce(
          (sum, c) => sum + (c.paidAmount || 0),
          0,
        ),
        averageClaimAmount:
          claims.length > 0
            ? claims.reduce((sum, c) => sum + (c.billedAmount || 0), 0) /
              claims.length
            : 0,
        byStatus: [],
        byCategory: [],
      },
      dependentsSummary: {
        totalDependents: dependents.length,
        byRelationship: [],
        averageDependentsPerEmployee:
          enrolledEmployees.size > 0
            ? dependents.length / enrolledEmployees.size
            : 0,
      },
      trends: {
        enrollmentTrend: [],
        costTrend: [],
        claimsTrend: [],
      },
    };
  }

  async getEmployeeBenefitsSummary(
    employeeId: string,
  ): Promise<EmployeeBenefitsSummary> {
    const enrollments = await this.getEmployeeEnrollments(employeeId, true);
    const dependents = await this.getEmployeeDependents(employeeId);
    const claimsResult = await this.getEmployeeClaims(employeeId, 1, 5);
    const activePeriods = await this.getActiveEnrollmentPeriods();
    const lifeEvents = await this.prisma.lifeEvent.findMany({
      where: { employeeId, status: "PENDING" },
    });

    const flexAccount = await this.prisma.flexBenefitAccount.findFirst({
      where: { employeeId, planYear: new Date().getFullYear() },
      include: { selections: true },
    });

    const totalEmployeeContribution = enrollments.reduce(
      (sum, e) => sum + (e.employeeContribution || 0),
      0,
    );
    const totalEmployerContribution = enrollments.reduce(
      (sum, e) => sum + (e.employerContribution || 0),
      0,
    );

    return {
      employeeId,
      enrollments: enrollments.map((e) => ({
        planId: e.planId,
        planName: (e as any).plan?.name || "",
        category: (e as any).plan?.category || BenefitCategory.OTHER,
        coverageLevel:
          (e as any).coverageOption?.coverageLevel ||
          CoverageLevel.EMPLOYEE_ONLY,
        status: e.status,
        employeeContribution: e.employeeContribution,
        employerContribution: e.employerContribution,
        effectiveDate: e.coverageStartDate,
      })),
      totalEmployeeContribution,
      totalEmployerContribution,
      totalBenefitsValue: totalEmployeeContribution + totalEmployerContribution,
      dependents,
      flexAccount: flexAccount as unknown as FlexBenefitAccount,
      recentClaims: claimsResult.data as unknown as BenefitClaim[],
      upcomingEnrollmentPeriods: activePeriods,
      pendingLifeEvents: lifeEvents as unknown as LifeEvent[],
    };
  }
}

export default BenefitsService;
