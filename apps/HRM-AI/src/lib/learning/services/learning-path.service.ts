// src/lib/learning/services/learning-path.service.ts
// Learning Path Service - Manage learning paths and career progression

import { db } from "@/lib/db";
import { LearningPathStatus, Prisma } from ".prisma/hrm-ai-client";

// Types
export interface CreateLearningPathInput {
  name: string;
  description?: string;
  targetPosition?: string;
  targetLevel?: string;
  estimatedMonths?: number;
  thumbnailUrl?: string;
  isPublic?: boolean;
}

export interface CreateStageInput {
  name: string;
  description?: string;
  order?: number;
  targetMonths?: number;
}

export interface AddCourseToStageInput {
  stageId: string;
  courseId: string;
  isRequired?: boolean;
  order?: number;
}

export interface EnrollInPathInput {
  employeeId: string;
  pathId: string;
  targetCompletionDate?: Date;
  assignedById?: string;
}

export interface LearningPathFilters {
  isActive?: boolean;
  isPublic?: boolean;
  search?: string;
}

export class LearningPathService {
  constructor(private tenantId: string) {}

  // ===== LEARNING PATHS =====

  /**
   * Create a learning path
   */
  async create(createdById: string, input: CreateLearningPathInput) {
    return db.learningPath.create({
      data: {
        tenantId: this.tenantId,
        name: input.name,
        description: input.description,
        targetPosition: input.targetPosition,
        targetLevel: input.targetLevel,
        estimatedMonths: input.estimatedMonths,
        thumbnailUrl: input.thumbnailUrl,
        isPublic: input.isPublic ?? true,
        createdById,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Get learning path by ID
   */
  async getById(id: string) {
    const path = await db.learningPath.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        stages: {
          orderBy: { order: "asc" },
          include: {
            courses: {
              orderBy: { order: "asc" },
              include: {
                course: {
                  select: {
                    id: true,
                    code: true,
                    title: true,
                    durationHours: true,
                    level: true,
                  },
                },
              },
            },
          },
        },
        _count: {
          select: { enrollments: true },
        },
      },
    });

    if (!path) {
      throw new Error("Learning path not found");
    }

    // Calculate total hours
    const totalHours = path.stages.reduce((sum, stage) => {
      return (
        sum +
        stage.courses.reduce((stageSum, pc) => {
          return stageSum + Number(pc.course.durationHours);
        }, 0)
      );
    }, 0);

    return {
      ...path,
      totalHours,
      totalCourses: path.stages.reduce((sum, s) => sum + s.courses.length, 0),
    };
  }

  /**
   * List learning paths
   */
  async list(
    filters: LearningPathFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.LearningPathWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.isPublic !== undefined) {
      where.isPublic = filters.isPublic;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
        { targetPosition: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const [paths, total] = await Promise.all([
      db.learningPath.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          _count: {
            select: {
              stages: true,
              enrollments: true,
            },
          },
        },
      }),
      db.learningPath.count({ where }),
    ]);

    return {
      data: paths,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Update learning path
   */
  async update(id: string, input: Partial<CreateLearningPathInput>) {
    const path = await db.learningPath.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!path) {
      throw new Error("Learning path not found");
    }

    return db.learningPath.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        targetPosition: input.targetPosition,
        targetLevel: input.targetLevel,
        estimatedMonths: input.estimatedMonths,
        thumbnailUrl: input.thumbnailUrl,
        isPublic: input.isPublic,
      },
    });
  }

  /**
   * Activate/Deactivate learning path
   */
  async setActive(id: string, isActive: boolean) {
    return db.learningPath.update({
      where: { id },
      data: { isActive },
    });
  }

  /**
   * Delete learning path
   */
  async delete(id: string) {
    const path = await db.learningPath.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { _count: { select: { enrollments: true } } },
    });

    if (!path) {
      throw new Error("Learning path not found");
    }

    if (path._count.enrollments > 0) {
      throw new Error("Cannot delete learning path with active enrollments");
    }

    await db.learningPath.delete({ where: { id } });
    return { success: true };
  }

  // ===== STAGES =====

  /**
   * Add stage to learning path
   */
  async addStage(pathId: string, input: CreateStageInput) {
    const path = await db.learningPath.findFirst({
      where: { id: pathId, tenantId: this.tenantId },
    });

    if (!path) {
      throw new Error("Learning path not found");
    }

    // Get max order
    const lastStage = await db.learningPathStage.findFirst({
      where: { pathId },
      orderBy: { order: "desc" },
    });

    const order = input.order ?? (lastStage ? lastStage.order + 1 : 0);

    return db.learningPathStage.create({
      data: {
        pathId,
        name: input.name,
        description: input.description,
        order,
        targetMonths: input.targetMonths,
      },
    });
  }

  /**
   * Update stage
   */
  async updateStage(stageId: string, input: Partial<CreateStageInput>) {
    return db.learningPathStage.update({
      where: { id: stageId },
      data: {
        name: input.name,
        description: input.description,
        order: input.order,
        targetMonths: input.targetMonths,
      },
    });
  }

  /**
   * Delete stage
   */
  async deleteStage(stageId: string) {
    await db.learningPathStage.delete({ where: { id: stageId } });
    return { success: true };
  }

  /**
   * Reorder stages
   */
  async reorderStages(pathId: string, stageIds: string[]) {
    const updates = stageIds.map((id, index) =>
      db.learningPathStage.update({
        where: { id },
        data: { order: index },
      }),
    );

    await Promise.all(updates);
    return { success: true };
  }

  // ===== STAGE COURSES =====

  /**
   * Add course to stage
   */
  async addCourseToStage(input: AddCourseToStageInput) {
    // Get max order in stage
    const lastCourse = await db.learningPathCourse.findFirst({
      where: { stageId: input.stageId },
      orderBy: { order: "desc" },
    });

    const order = input.order ?? (lastCourse ? lastCourse.order + 1 : 0);

    return db.learningPathCourse.create({
      data: {
        stageId: input.stageId,
        courseId: input.courseId,
        isRequired: input.isRequired ?? true,
        order,
      },
      include: {
        course: {
          select: { id: true, title: true, code: true },
        },
      },
    });
  }

  /**
   * Remove course from stage
   */
  async removeCourseFromStage(stageId: string, courseId: string) {
    await db.learningPathCourse.delete({
      where: {
        stageId_courseId: {
          stageId,
          courseId,
        },
      },
    });
    return { success: true };
  }

  /**
   * Update course in stage
   */
  async updateCourseInStage(
    stageId: string,
    courseId: string,
    isRequired: boolean,
    order?: number,
  ) {
    return db.learningPathCourse.update({
      where: {
        stageId_courseId: {
          stageId,
          courseId,
        },
      },
      data: {
        isRequired,
        order,
      },
    });
  }

  // ===== ENROLLMENTS =====

  /**
   * Enroll employee in learning path
   */
  async enroll(input: EnrollInPathInput) {
    const path = await db.learningPath.findFirst({
      where: {
        id: input.pathId,
        tenantId: this.tenantId,
        isActive: true,
      },
    });

    if (!path) {
      throw new Error("Learning path not found or inactive");
    }

    // Check existing enrollment
    const existing = await db.learningPathEnrollment.findUnique({
      where: {
        employeeId_pathId: {
          employeeId: input.employeeId,
          pathId: input.pathId,
        },
      },
    });

    if (existing) {
      throw new Error("Employee already enrolled in this learning path");
    }

    return db.learningPathEnrollment.create({
      data: {
        tenantId: this.tenantId,
        employeeId: input.employeeId,
        pathId: input.pathId,
        targetCompletionDate: input.targetCompletionDate,
        assignedById: input.assignedById,
        status: LearningPathStatus.NOT_STARTED,
      },
      include: {
        employee: {
          select: { id: true, fullName: true },
        },
        path: {
          select: { id: true, name: true },
        },
      },
    });
  }

  /**
   * Get employee's learning path enrollment
   */
  async getEnrollment(enrollmentId: string) {
    const enrollment = await db.learningPathEnrollment.findFirst({
      where: {
        id: enrollmentId,
        tenantId: this.tenantId,
      },
      include: {
        employee: {
          select: { id: true, fullName: true },
        },
        path: {
          include: {
            stages: {
              orderBy: { order: "asc" },
              include: {
                courses: {
                  orderBy: { order: "asc" },
                  include: {
                    course: {
                      select: { id: true, title: true, code: true },
                    },
                  },
                },
              },
            },
          },
        },
        assignedBy: {
          select: { id: true, name: true },
        },
      },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    // Get employee's course completions to calculate progress
    const completedCourses = await db.enrollment.findMany({
      where: {
        employeeId: enrollment.employeeId,
        courseId: {
          in: enrollment.path.stages.flatMap((s) =>
            s.courses.map((c) => c.courseId),
          ),
        },
        status: "COMPLETED",
      },
      select: { courseId: true },
    });

    const completedCourseIds = new Set(completedCourses.map((c) => c.courseId));

    // Add completion info to courses
    const pathWithProgress = {
      ...enrollment,
      path: {
        ...enrollment.path,
        stages: enrollment.path.stages.map((stage) => ({
          ...stage,
          courses: stage.courses.map((pc) => ({
            ...pc,
            completed: completedCourseIds.has(pc.courseId),
          })),
          completed: stage.courses.every((pc) =>
            completedCourseIds.has(pc.courseId),
          ),
        })),
      },
    };

    return pathWithProgress;
  }

  /**
   * Start learning path
   */
  async startPath(enrollmentId: string) {
    const enrollment = await db.learningPathEnrollment.findFirst({
      where: { id: enrollmentId, tenantId: this.tenantId },
      include: {
        path: {
          include: {
            stages: { orderBy: { order: "asc" } },
          },
        },
      },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    if (enrollment.status !== LearningPathStatus.NOT_STARTED) {
      throw new Error("Learning path already started");
    }

    const firstStage = enrollment.path.stages[0];

    return db.learningPathEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: LearningPathStatus.IN_PROGRESS,
        startedAt: new Date(),
        currentStageId: firstStage?.id,
      },
    });
  }

  /**
   * Update learning path progress
   */
  async updateProgress(enrollmentId: string, courseId: string) {
    const enrollment = await db.learningPathEnrollment.findFirst({
      where: { id: enrollmentId, tenantId: this.tenantId },
      include: {
        path: {
          include: {
            stages: {
              orderBy: { order: "asc" },
              include: {
                courses: { where: { isRequired: true } },
              },
            },
          },
        },
      },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    // Get all required courses
    const allRequiredCourses = enrollment.path.stages.flatMap((s) =>
      s.courses.map((c) => c.courseId),
    );

    // Get completed courses
    const completedCourses = await db.enrollment.findMany({
      where: {
        employeeId: enrollment.employeeId,
        courseId: { in: allRequiredCourses },
        status: "COMPLETED",
      },
      select: { courseId: true },
    });

    const completedIds = new Set(completedCourses.map((c) => c.courseId));

    // Calculate progress
    const progress =
      allRequiredCourses.length > 0
        ? Math.round((completedIds.size / allRequiredCourses.length) * 100)
        : 0;

    // Find current stage (first incomplete stage)
    let currentStageId = enrollment.currentStageId;
    for (const stage of enrollment.path.stages) {
      const stageComplete = stage.courses.every((c) =>
        completedIds.has(c.courseId),
      );
      if (!stageComplete) {
        currentStageId = stage.id;
        break;
      }
    }

    // Check if path is completed
    const isCompleted = progress === 100;

    return db.learningPathEnrollment.update({
      where: { id: enrollmentId },
      data: {
        progress,
        currentStageId,
        status: isCompleted
          ? LearningPathStatus.COMPLETED
          : LearningPathStatus.IN_PROGRESS,
        completedAt: isCompleted ? new Date() : null,
      },
    });
  }

  /**
   * Get employee's learning paths
   */
  async getEmployeePaths(employeeId: string) {
    return db.learningPathEnrollment.findMany({
      where: {
        tenantId: this.tenantId,
        employeeId,
      },
      orderBy: { createdAt: "desc" },
      include: {
        path: {
          select: {
            id: true,
            name: true,
            thumbnailUrl: true,
            estimatedMonths: true,
          },
        },
      },
    });
  }

  /**
   * Get learning path statistics
   */
  async getStats() {
    const [total, enrollments, completionRate] = await Promise.all([
      db.learningPath.count({
        where: { tenantId: this.tenantId, isActive: true },
      }),

      db.learningPathEnrollment.groupBy({
        by: ["status"],
        where: { tenantId: this.tenantId },
        _count: true,
      }),

      // Completion rate
      Promise.all([
        db.learningPathEnrollment.count({
          where: {
            tenantId: this.tenantId,
            status: LearningPathStatus.COMPLETED,
          },
        }),
        db.learningPathEnrollment.count({
          where: {
            tenantId: this.tenantId,
            status: { notIn: [LearningPathStatus.NOT_STARTED] },
          },
        }),
      ]),
    ]);

    const [completed, started] = completionRate;
    const rate = started > 0 ? Math.round((completed / started) * 100) : 0;

    return {
      totalPaths: total,
      enrollmentsByStatus: enrollments.map((e) => ({
        status: e.status,
        count: e._count,
      })),
      completionRate: rate,
    };
  }
}

// Factory function
export function createLearningPathService(
  tenantId: string,
): LearningPathService {
  return new LearningPathService(tenantId);
}
