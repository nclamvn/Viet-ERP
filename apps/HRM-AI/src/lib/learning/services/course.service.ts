// src/lib/learning/services/course.service.ts
// Course Service - Manage courses, modules, and categories

import { db } from "@/lib/db";
import {
  CourseType,
  CourseLevel,
  CourseStatus,
  Prisma,
} from ".prisma/hrm-ai-client";

// Types
export interface CreateCourseInput {
  code: string;
  title: string;
  description?: string;
  objectives?: string;
  categoryId?: string;
  courseType: CourseType;
  level?: CourseLevel;
  durationHours: number;
  contentUrl?: string;
  contentType?: string;
  maxParticipants?: number;
  minParticipants?: number;
  providerId?: string;
  instructorName?: string;
  costPerPerson?: number;
  currency?: string;
  prerequisites?: string;
  targetAudience?: string;
  isMandatory?: boolean;
  mandatoryForPositions?: string[];
  recertificationMonths?: number;
  thumbnailUrl?: string;
}

export interface UpdateCourseInput extends Partial<CreateCourseInput> {
  status?: CourseStatus;
}

export interface CourseFilters {
  status?: CourseStatus[];
  courseType?: CourseType[];
  level?: CourseLevel[];
  categoryId?: string;
  providerId?: string;
  isMandatory?: boolean;
  search?: string;
}

export interface CreateModuleInput {
  title: string;
  description?: string;
  contentUrl?: string;
  contentType?: string;
  durationMinutes: number;
  order?: number;
}

export interface CreateCategoryInput {
  name: string;
  description?: string;
  code?: string;
  parentId?: string;
  order?: number;
}

export class CourseService {
  constructor(private tenantId: string) {}

  // ===== CATEGORIES =====

  /**
   * Create a category
   */
  async createCategory(input: CreateCategoryInput) {
    return db.courseCategory.create({
      data: {
        tenantId: this.tenantId,
        name: input.name,
        description: input.description,
        code: input.code,
        parentId: input.parentId,
        order: input.order || 0,
      },
    });
  }

  /**
   * Get all categories (hierarchical)
   */
  async getCategories() {
    const categories = await db.courseCategory.findMany({
      where: { tenantId: this.tenantId, parentId: null },
      orderBy: { order: "asc" },
      include: {
        children: {
          orderBy: { order: "asc" },
          include: {
            _count: { select: { courses: true } },
          },
        },
        _count: { select: { courses: true } },
      },
    });

    return categories;
  }

  /**
   * Update a category
   */
  async updateCategory(id: string, input: Partial<CreateCategoryInput>) {
    return db.courseCategory.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        code: input.code,
        parentId: input.parentId,
        order: input.order,
      },
    });
  }

  /**
   * Delete a category
   */
  async deleteCategory(id: string) {
    // Check if category has courses
    const coursesCount = await db.course.count({
      where: { categoryId: id },
    });

    if (coursesCount > 0) {
      throw new Error("Cannot delete category with courses");
    }

    await db.courseCategory.delete({ where: { id } });
    return { success: true };
  }

  // ===== COURSES =====

  /**
   * Create a course
   */
  async create(createdById: string, input: CreateCourseInput) {
    // Verify code is unique
    const existing = await db.course.findUnique({
      where: {
        tenantId_code: {
          tenantId: this.tenantId,
          code: input.code,
        },
      },
    });

    if (existing) {
      throw new Error("Course code already exists");
    }

    const course = await db.course.create({
      data: {
        tenantId: this.tenantId,
        code: input.code,
        title: input.title,
        description: input.description,
        objectives: input.objectives,
        categoryId: input.categoryId,
        courseType: input.courseType,
        level: input.level || CourseLevel.BEGINNER,
        durationHours: input.durationHours,
        contentUrl: input.contentUrl,
        contentType: input.contentType,
        maxParticipants: input.maxParticipants,
        minParticipants: input.minParticipants,
        providerId: input.providerId,
        instructorName: input.instructorName,
        costPerPerson: input.costPerPerson,
        currency: input.currency || "VND",
        prerequisites: input.prerequisites,
        targetAudience: input.targetAudience,
        isMandatory: input.isMandatory || false,
        mandatoryForPositions:
          input.mandatoryForPositions as unknown as Prisma.InputJsonValue,
        recertificationMonths: input.recertificationMonths,
        thumbnailUrl: input.thumbnailUrl,
        createdById,
        status: CourseStatus.DRAFT,
      },
      include: {
        category: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    return course;
  }

  /**
   * Get course by ID
   */
  async getById(id: string) {
    const course = await db.course.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        category: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        modules: {
          orderBy: { order: "asc" },
        },
        skills: {
          include: {
            skill: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: {
            enrollments: true,
            sessions: true,
            assessments: true,
          },
        },
      },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    return course;
  }

  /**
   * List courses with filters
   */
  async list(
    filters: CourseFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.CourseWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    if (filters.courseType?.length) {
      where.courseType = { in: filters.courseType };
    }

    if (filters.level?.length) {
      where.level = { in: filters.level };
    }

    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters.providerId) {
      where.providerId = filters.providerId;
    }

    if (filters.isMandatory !== undefined) {
      where.isMandatory = filters.isMandatory;
    }

    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
        { code: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const [courses, total] = await Promise.all([
      db.course.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true } },
          _count: {
            select: {
              enrollments: true,
              modules: true,
            },
          },
        },
      }),
      db.course.count({ where }),
    ]);

    return {
      data: courses,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * List published courses (for learners)
   */
  async listPublished(
    filters: CourseFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    return this.list(
      { ...filters, status: [CourseStatus.PUBLISHED] },
      page,
      pageSize,
    );
  }

  /**
   * Update a course
   */
  async update(id: string, input: UpdateCourseInput) {
    const course = await db.course.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    return db.course.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        objectives: input.objectives,
        categoryId: input.categoryId,
        courseType: input.courseType,
        level: input.level,
        durationHours: input.durationHours,
        contentUrl: input.contentUrl,
        contentType: input.contentType,
        maxParticipants: input.maxParticipants,
        minParticipants: input.minParticipants,
        providerId: input.providerId,
        instructorName: input.instructorName,
        costPerPerson: input.costPerPerson,
        currency: input.currency,
        prerequisites: input.prerequisites,
        targetAudience: input.targetAudience,
        isMandatory: input.isMandatory,
        mandatoryForPositions:
          input.mandatoryForPositions as unknown as Prisma.InputJsonValue,
        recertificationMonths: input.recertificationMonths,
        thumbnailUrl: input.thumbnailUrl,
        status: input.status,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Publish a course
   */
  async publish(id: string) {
    const course = await db.course.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    if (course.status !== CourseStatus.DRAFT) {
      throw new Error("Only draft courses can be published");
    }

    return db.course.update({
      where: { id },
      data: {
        status: CourseStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });
  }

  /**
   * Archive a course
   */
  async archive(id: string) {
    const course = await db.course.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    return db.course.update({
      where: { id },
      data: {
        status: CourseStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });
  }

  /**
   * Clone a course
   */
  async clone(id: string, createdById: string, newCode: string) {
    const course = await db.course.findFirst({
      where: { id, tenantId: this.tenantId },
      include: { modules: true },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    // Create new course
    const newCourse = await db.course.create({
      data: {
        tenantId: this.tenantId,
        code: newCode,
        title: `${course.title} (Copy)`,
        description: course.description,
        objectives: course.objectives,
        categoryId: course.categoryId,
        courseType: course.courseType,
        level: course.level,
        durationHours: course.durationHours,
        contentUrl: course.contentUrl,
        contentType: course.contentType,
        maxParticipants: course.maxParticipants,
        minParticipants: course.minParticipants,
        providerId: course.providerId,
        instructorName: course.instructorName,
        costPerPerson: course.costPerPerson,
        currency: course.currency,
        prerequisites: course.prerequisites,
        targetAudience: course.targetAudience,
        isMandatory: course.isMandatory,
        mandatoryForPositions:
          course.mandatoryForPositions as Prisma.InputJsonValue,
        recertificationMonths: course.recertificationMonths,
        thumbnailUrl: course.thumbnailUrl,
        createdById,
        status: CourseStatus.DRAFT,
      },
    });

    // Clone modules
    if (course.modules.length > 0) {
      await db.courseModule.createMany({
        data: course.modules.map((m) => ({
          courseId: newCourse.id,
          title: m.title,
          description: m.description,
          contentUrl: m.contentUrl,
          contentType: m.contentType,
          durationMinutes: m.durationMinutes,
          order: m.order,
        })),
      });
    }

    return newCourse;
  }

  // ===== MODULES =====

  /**
   * Add module to course
   */
  async addModule(courseId: string, input: CreateModuleInput) {
    const course = await db.course.findFirst({
      where: { id: courseId, tenantId: this.tenantId },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    // Get max order
    const lastModule = await db.courseModule.findFirst({
      where: { courseId },
      orderBy: { order: "desc" },
    });

    const order = input.order ?? (lastModule ? lastModule.order + 1 : 0);

    return db.courseModule.create({
      data: {
        courseId,
        title: input.title,
        description: input.description,
        contentUrl: input.contentUrl,
        contentType: input.contentType,
        durationMinutes: input.durationMinutes,
        order,
      },
    });
  }

  /**
   * Update a module
   */
  async updateModule(moduleId: string, input: Partial<CreateModuleInput>) {
    return db.courseModule.update({
      where: { id: moduleId },
      data: {
        title: input.title,
        description: input.description,
        contentUrl: input.contentUrl,
        contentType: input.contentType,
        durationMinutes: input.durationMinutes,
        order: input.order,
      },
    });
  }

  /**
   * Delete a module
   */
  async deleteModule(moduleId: string) {
    await db.courseModule.delete({ where: { id: moduleId } });
    return { success: true };
  }

  /**
   * Reorder modules
   */
  async reorderModules(courseId: string, moduleIds: string[]) {
    const updates = moduleIds.map((id, index) =>
      db.courseModule.update({
        where: { id },
        data: { order: index },
      }),
    );

    await Promise.all(updates);
    return { success: true };
  }

  // ===== SKILLS =====

  /**
   * Link skill to course
   */
  async linkSkill(courseId: string, skillId: string, skillLevelGained: number) {
    return db.courseSkill.create({
      data: {
        courseId,
        skillId,
        skillLevelGained,
      },
    });
  }

  /**
   * Unlink skill from course
   */
  async unlinkSkill(courseId: string, skillId: string) {
    await db.courseSkill.delete({
      where: {
        courseId_skillId: {
          courseId,
          skillId,
        },
      },
    });
    return { success: true };
  }

  // ===== STATISTICS =====

  /**
   * Get course statistics
   */
  async getStats() {
    const [total, byStatus, byType, byLevel, recentEnrollments] =
      await Promise.all([
        db.course.count({ where: { tenantId: this.tenantId } }),

        db.course.groupBy({
          by: ["status"],
          where: { tenantId: this.tenantId },
          _count: true,
        }),

        db.course.groupBy({
          by: ["courseType"],
          where: { tenantId: this.tenantId },
          _count: true,
        }),

        db.course.groupBy({
          by: ["level"],
          where: { tenantId: this.tenantId },
          _count: true,
        }),

        db.enrollment.count({
          where: {
            tenantId: this.tenantId,
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

    return {
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byType: byType.map((t) => ({ type: t.courseType, count: t._count })),
      byLevel: byLevel.map((l) => ({ level: l.level, count: l._count })),
      recentEnrollments,
    };
  }

  /**
   * Get popular courses
   */
  async getPopular(limit: number = 10) {
    return db.course.findMany({
      where: {
        tenantId: this.tenantId,
        status: CourseStatus.PUBLISHED,
      },
      orderBy: {
        enrollments: { _count: "desc" },
      },
      take: limit,
      include: {
        category: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
    });
  }

  /**
   * Get mandatory courses for employee
   */
  async getMandatoryCourses(employeePosition?: string) {
    const where: Prisma.CourseWhereInput = {
      tenantId: this.tenantId,
      status: CourseStatus.PUBLISHED,
      isMandatory: true,
    };

    // If position specified, filter by mandatory positions
    // Note: This is a simplified version, proper JSON filtering would be more complex

    return db.course.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
      },
    });
  }
}

// Factory function
export function createCourseService(tenantId: string): CourseService {
  return new CourseService(tenantId);
}
