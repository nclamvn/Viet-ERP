// src/lib/performance/services/competency.service.ts
// Competency Service - Manage competency frameworks and assessments

import { db } from "@/lib/db";
import { Prisma } from ".prisma/hrm-ai-client";

// Types
export interface CreateFrameworkInput {
  name: string;
  description?: string;
}

export interface CreateCompetencyInput {
  name: string;
  description?: string;
  category?: string;
  levels: CompetencyLevel[];
  isCore?: boolean;
  order?: number;
}

export interface CompetencyLevel {
  level: number;
  name: string;
  description: string;
  behaviors: string[];
}

export interface PositionCompetencyInput {
  competencyId: string;
  position: string;
  requiredLevel: number;
}

export interface CompetencyFilters {
  frameworkId?: string;
  category?: string;
  isCore?: boolean;
  search?: string;
}

export class CompetencyService {
  constructor(private tenantId: string) {}

  // ===== FRAMEWORKS =====

  /**
   * Create a competency framework
   */
  async createFramework(input: CreateFrameworkInput) {
    return db.competencyFramework.create({
      data: {
        tenantId: this.tenantId,
        name: input.name,
        description: input.description,
        isActive: true,
      },
    });
  }

  /**
   * Get framework by ID
   */
  async getFrameworkById(id: string) {
    const framework = await db.competencyFramework.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        competencies: {
          orderBy: [{ category: "asc" }, { order: "asc" }],
        },
      },
    });

    if (!framework) {
      throw new Error("Competency framework not found");
    }

    return framework;
  }

  /**
   * List frameworks
   */
  async listFrameworks() {
    return db.competencyFramework.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { competencies: true } },
      },
    });
  }

  /**
   * Update framework
   */
  async updateFramework(id: string, input: Partial<CreateFrameworkInput>) {
    return db.competencyFramework.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
      },
    });
  }

  /**
   * Activate/deactivate framework
   */
  async setFrameworkActive(id: string, isActive: boolean) {
    return db.competencyFramework.update({
      where: { id },
      data: { isActive },
    });
  }

  /**
   * Delete framework
   */
  async deleteFramework(id: string) {
    const framework = await db.competencyFramework.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { _count: { select: { competencies: true } } },
    });

    if (!framework) {
      throw new Error("Framework not found");
    }

    if (framework._count.competencies > 0) {
      throw new Error("Cannot delete framework with competencies");
    }

    await db.competencyFramework.delete({ where: { id } });
    return { success: true };
  }

  // ===== COMPETENCIES =====

  /**
   * Create a competency
   */
  async createCompetency(frameworkId: string, input: CreateCompetencyInput) {
    const framework = await db.competencyFramework.findFirst({
      where: { id: frameworkId, tenantId: this.tenantId },
    });

    if (!framework) {
      throw new Error("Framework not found");
    }

    // Get max order in category
    const lastCompetency = await db.competency.findFirst({
      where: { frameworkId, category: input.category },
      orderBy: { order: "desc" },
    });

    const order =
      input.order ?? (lastCompetency ? lastCompetency.order + 1 : 0);

    return db.competency.create({
      data: {
        frameworkId,
        name: input.name,
        description: input.description,
        category: input.category,
        levels: input.levels as unknown as Prisma.InputJsonValue,
        isCore: input.isCore ?? false,
        order,
      },
    });
  }

  /**
   * Get competency by ID
   */
  async getCompetencyById(id: string) {
    const competency = await db.competency.findUnique({
      where: { id },
      include: {
        framework: { select: { id: true, name: true, tenantId: true } },
        positionCompetencies: true,
      },
    });

    if (!competency) {
      throw new Error("Competency not found");
    }

    // Verify tenant access
    if (competency.framework.tenantId !== this.tenantId) {
      throw new Error("Competency not found");
    }

    return competency;
  }

  /**
   * List competencies
   */
  async listCompetencies(
    filters: CompetencyFilters = {},
    page: number = 1,
    pageSize: number = 50,
  ) {
    const skip = (page - 1) * pageSize;

    // Build framework filter
    const frameworkWhere: Prisma.CompetencyFrameworkWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.frameworkId) {
      frameworkWhere.id = filters.frameworkId;
    }

    const where: Prisma.CompetencyWhereInput = {
      framework: frameworkWhere,
    };

    if (filters.category) {
      where.category = filters.category;
    }

    if (filters.isCore !== undefined) {
      where.isCore = filters.isCore;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const [competencies, total] = await Promise.all([
      db.competency.findMany({
        where,
        orderBy: [{ category: "asc" }, { order: "asc" }],
        skip,
        take: pageSize,
        include: {
          framework: { select: { id: true, name: true } },
        },
      }),
      db.competency.count({ where }),
    ]);

    return {
      data: competencies,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get competencies by category
   */
  async getByCategory(frameworkId: string) {
    const competencies = await db.competency.findMany({
      where: {
        frameworkId,
        framework: { tenantId: this.tenantId },
      },
      orderBy: [{ category: "asc" }, { order: "asc" }],
    });

    // Group by category
    const byCategory: Record<string, typeof competencies> = {};
    competencies.forEach((c) => {
      const category = c.category || "Uncategorized";
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push(c);
    });

    return byCategory;
  }

  /**
   * Get core competencies
   */
  async getCoreCompetencies(frameworkId?: string) {
    const where: Prisma.CompetencyWhereInput = {
      isCore: true,
      framework: { tenantId: this.tenantId },
    };

    if (frameworkId) {
      where.frameworkId = frameworkId;
    }

    return db.competency.findMany({
      where,
      orderBy: { order: "asc" },
    });
  }

  /**
   * Update competency
   */
  async updateCompetency(id: string, input: Partial<CreateCompetencyInput>) {
    return db.competency.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        category: input.category,
        levels: input.levels as unknown as Prisma.InputJsonValue,
        isCore: input.isCore,
        order: input.order,
      },
    });
  }

  /**
   * Delete competency
   */
  async deleteCompetency(id: string) {
    const competency = await db.competency.findUnique({
      where: { id },
      include: {
        framework: { select: { tenantId: true } },
        _count: { select: { reviewCompetencies: true } },
      },
    });

    if (!competency || competency.framework.tenantId !== this.tenantId) {
      throw new Error("Competency not found");
    }

    if (competency._count.reviewCompetencies > 0) {
      throw new Error("Cannot delete competency used in reviews");
    }

    await db.competency.delete({ where: { id } });
    return { success: true };
  }

  // ===== POSITION COMPETENCIES =====

  /**
   * Set required competencies for a position
   */
  async setPositionCompetencies(
    position: string,
    competencies: PositionCompetencyInput[],
  ) {
    // Delete existing
    await db.positionCompetency.deleteMany({
      where: {
        tenantId: this.tenantId,
        position,
      },
    });

    // Create new
    if (competencies.length > 0) {
      await db.positionCompetency.createMany({
        data: competencies.map((c) => ({
          tenantId: this.tenantId,
          competencyId: c.competencyId,
          position,
          requiredLevel: c.requiredLevel,
        })),
      });
    }

    return { success: true };
  }

  /**
   * Get competencies for a position
   */
  async getPositionCompetencies(position: string) {
    return db.positionCompetency.findMany({
      where: {
        tenantId: this.tenantId,
        position,
      },
      include: {
        competency: true,
      },
      orderBy: { competency: { order: "asc" } },
    });
  }

  /**
   * Add competency requirement to position
   */
  async addPositionCompetency(input: PositionCompetencyInput) {
    return db.positionCompetency.create({
      data: {
        tenantId: this.tenantId,
        competencyId: input.competencyId,
        position: input.position,
        requiredLevel: input.requiredLevel,
      },
      include: {
        competency: true,
      },
    });
  }

  /**
   * Update position competency
   */
  async updatePositionCompetency(id: string, requiredLevel: number) {
    return db.positionCompetency.update({
      where: { id },
      data: {
        requiredLevel,
      },
    });
  }

  /**
   * Remove competency from position
   */
  async removePositionCompetency(id: string) {
    await db.positionCompetency.delete({ where: { id } });
    return { success: true };
  }

  // ===== COMPETENCY GAPS =====

  /**
   * Assess competency gap for an employee
   */
  async assessGap(
    employeeId: string,
    competencyId: string,
    currentLevel: number,
  ) {
    const employee = await db.employee.findFirst({
      where: { id: employeeId, tenantId: this.tenantId },
      include: { position: true },
    });

    if (!employee || !employee.position) {
      throw new Error("Employee or position not found");
    }

    const positionCompetency = await db.positionCompetency.findFirst({
      where: {
        tenantId: this.tenantId,
        competencyId,
        position: employee.position.name,
      },
      include: { competency: true },
    });

    if (!positionCompetency) {
      return null; // Competency not required for position
    }

    const gap = positionCompetency.requiredLevel - currentLevel;

    return {
      competency: positionCompetency.competency,
      requiredLevel: positionCompetency.requiredLevel,
      currentLevel,
      gap,
      status: gap <= 0 ? "MEETS" : gap === 1 ? "DEVELOPING" : "GAP",
    };
  }

  /**
   * Get full competency gap analysis for employee
   */
  async getEmployeeGapAnalysis(
    employeeId: string,
    currentLevels: Record<string, number>,
  ) {
    const employee = await db.employee.findFirst({
      where: { id: employeeId, tenantId: this.tenantId },
      include: { position: true },
    });

    if (!employee || !employee.position) {
      throw new Error("Employee or position not found");
    }

    const positionCompetencies = await db.positionCompetency.findMany({
      where: {
        tenantId: this.tenantId,
        position: employee.position.name,
      },
      include: { competency: true },
    });

    const analysis = positionCompetencies.map((pc) => {
      const currentLevel = currentLevels[pc.competencyId] || 0;
      const gap = pc.requiredLevel - currentLevel;

      return {
        competency: pc.competency,
        requiredLevel: pc.requiredLevel,
        currentLevel,
        gap,
        status: gap <= 0 ? "MEETS" : gap === 1 ? "DEVELOPING" : "GAP",
      };
    });

    // Calculate overall readiness (equal weight for all competencies)
    const totalScore = analysis.reduce((sum, a) => {
      const score = Math.min(a.currentLevel / a.requiredLevel, 1);
      return sum + score;
    }, 0);
    const overallReadiness =
      analysis.length > 0
        ? Math.round((totalScore / analysis.length) * 100)
        : 0;

    return {
      employee: {
        id: employee.id,
        fullName: employee.fullName,
        position: employee.position.name,
      },
      analysis,
      summary: {
        totalCompetencies: analysis.length,
        meetsRequirements: analysis.filter((a) => a.status === "MEETS").length,
        developing: analysis.filter((a) => a.status === "DEVELOPING").length,
        gaps: analysis.filter((a) => a.status === "GAP").length,
        overallReadiness,
      },
    };
  }

  // ===== STATISTICS =====

  /**
   * Get competency statistics
   */
  async getStats() {
    const [frameworks, competencies, byCategory] = await Promise.all([
      db.competencyFramework.count({
        where: { tenantId: this.tenantId, isActive: true },
      }),

      db.competency.count({
        where: { framework: { tenantId: this.tenantId } },
      }),

      db.competency.groupBy({
        by: ["category"],
        where: { framework: { tenantId: this.tenantId } },
        _count: true,
      }),
    ]);

    return {
      totalFrameworks: frameworks,
      totalCompetencies: competencies,
      byCategory: byCategory.map((c) => ({
        category: c.category || "Uncategorized",
        count: c._count,
      })),
    };
  }
}

// Factory function
export function createCompetencyService(tenantId: string): CompetencyService {
  return new CompetencyService(tenantId);
}
