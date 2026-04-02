// src/lib/learning/services/enrollment.service.ts
// Enrollment Service - Manage course and session enrollments

import { db } from "@/lib/db";
import {
  EnrollmentStatus,
  CourseStatus,
  SessionStatus,
  Prisma,
} from ".prisma/hrm-unified-client";

// Types
export interface EnrollInput {
  employeeId: string;
  courseId: string;
  sessionId?: string;
  requestId?: string;
}

export interface EnrollmentFilters {
  employeeId?: string;
  courseId?: string;
  sessionId?: string;
  status?: EnrollmentStatus[];
  fromDate?: Date;
  toDate?: Date;
}

export interface UpdateProgressInput {
  progress?: number;
  score?: number;
  passed?: boolean;
  completedAt?: Date;
}

export class EnrollmentService {
  constructor(private tenantId: string) {}

  /**
   * Enroll employee in a course
   */
  async enroll(input: EnrollInput, approvedById?: string) {
    // Verify course exists and is published
    const course = await db.course.findFirst({
      where: {
        id: input.courseId,
        tenantId: this.tenantId,
        status: CourseStatus.PUBLISHED,
      },
    });

    if (!course) {
      throw new Error("Course not found or not available");
    }

    // Check for existing enrollment
    const existing = await db.enrollment.findUnique({
      where: {
        employeeId_courseId_sessionId: {
          employeeId: input.employeeId,
          courseId: input.courseId,
          sessionId: input.sessionId || "",
        },
      },
    });

    if (existing) {
      throw new Error("Employee already enrolled in this course");
    }

    // If session specified, verify it
    if (input.sessionId) {
      const session = await db.trainingSession.findFirst({
        where: {
          id: input.sessionId,
          courseId: input.courseId,
          status: SessionStatus.SCHEDULED,
        },
        include: {
          _count: { select: { enrollments: true } },
        },
      });

      if (!session) {
        throw new Error("Session not found or not available");
      }

      // Check capacity
      if (session._count.enrollments >= session.maxParticipants) {
        throw new Error("Session is full");
      }
    }

    // Determine initial status
    const initialStatus = approvedById
      ? EnrollmentStatus.ENROLLED
      : EnrollmentStatus.PENDING;

    const enrollment = await db.enrollment.create({
      data: {
        tenantId: this.tenantId,
        employeeId: input.employeeId,
        courseId: input.courseId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        status: initialStatus,
        approvedById,
        approvedAt: approvedById ? new Date() : null,
      },
      include: {
        employee: {
          select: { id: true, fullName: true, workEmail: true },
        },
        course: {
          select: { id: true, title: true, code: true },
        },
        session: {
          select: { id: true, sessionCode: true, startDate: true },
        },
      },
    });

    return enrollment;
  }

  /**
   * Get enrollment by ID
   */
  async getById(id: string) {
    const enrollment = await db.enrollment.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            workEmail: true,
            department: { select: { id: true, name: true } },
          },
        },
        course: {
          include: {
            modules: { orderBy: { order: "asc" } },
          },
        },
        session: {
          select: {
            id: true,
            sessionCode: true,
            title: true,
            startDate: true,
            endDate: true,
            location: true,
            isVirtual: true,
            virtualLink: true,
          },
        },
        approvedBy: {
          select: { id: true, name: true },
        },
        moduleCompletions: {
          include: {
            module: { select: { id: true, title: true } },
          },
        },
        assessmentAttempts: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    return enrollment;
  }

  /**
   * List enrollments with filters
   */
  async list(
    filters: EnrollmentFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.EnrollmentWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.employeeId) {
      where.employeeId = filters.employeeId;
    }

    if (filters.courseId) {
      where.courseId = filters.courseId;
    }

    if (filters.sessionId) {
      where.sessionId = filters.sessionId;
    }

    if (filters.status?.length) {
      where.status = { in: filters.status };
    }

    if (filters.fromDate) {
      where.createdAt = { gte: filters.fromDate };
    }

    if (filters.toDate) {
      where.createdAt = {
        ...((where.createdAt as object) || {}),
        lte: filters.toDate,
      };
    }

    const [enrollments, total] = await Promise.all([
      db.enrollment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              department: { select: { id: true, name: true } },
            },
          },
          course: {
            select: { id: true, title: true, code: true },
          },
          session: {
            select: { id: true, sessionCode: true, startDate: true },
          },
        },
      }),
      db.enrollment.count({ where }),
    ]);

    return {
      data: enrollments,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get employee's enrollments
   */
  async getByEmployee(employeeId: string, activeOnly: boolean = false) {
    const where: Prisma.EnrollmentWhereInput = {
      tenantId: this.tenantId,
      employeeId,
    };

    if (activeOnly) {
      where.status = {
        in: [EnrollmentStatus.ENROLLED, EnrollmentStatus.IN_PROGRESS],
      };
    }

    return db.enrollment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            code: true,
            thumbnailUrl: true,
            durationHours: true,
          },
        },
        session: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
          },
        },
      },
    });
  }

  /**
   * Approve enrollment
   */
  async approve(id: string, approvedById: string) {
    const enrollment = await db.enrollment.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    if (enrollment.status !== EnrollmentStatus.PENDING) {
      throw new Error("Enrollment is not pending approval");
    }

    return db.enrollment.update({
      where: { id },
      data: {
        status: EnrollmentStatus.ENROLLED,
        approvedById,
        approvedAt: new Date(),
      },
    });
  }

  /**
   * Reject enrollment
   */
  async reject(id: string, rejectedById: string, reason: string) {
    const enrollment = await db.enrollment.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    if (enrollment.status !== EnrollmentStatus.PENDING) {
      throw new Error("Enrollment is not pending");
    }

    return db.enrollment.update({
      where: { id },
      data: {
        status: EnrollmentStatus.REJECTED,
        approvedById: rejectedById,
        approvedAt: new Date(),
        rejectionReason: reason,
      },
    });
  }

  /**
   * Start learning
   */
  async startLearning(id: string) {
    const enrollment = await db.enrollment.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    if (enrollment.status !== EnrollmentStatus.ENROLLED) {
      throw new Error("Enrollment is not in enrolled status");
    }

    return db.enrollment.update({
      where: { id },
      data: {
        status: EnrollmentStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
    });
  }

  /**
   * Complete a module
   */
  async completeModule(
    enrollmentId: string,
    moduleId: string,
    timeSpentMinutes?: number,
  ) {
    const enrollment = await db.enrollment.findFirst({
      where: { id: enrollmentId, tenantId: this.tenantId },
      include: {
        course: {
          include: { modules: true },
        },
        moduleCompletions: true,
      },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    // Create module completion
    await db.moduleCompletion.upsert({
      where: {
        enrollmentId_moduleId: {
          enrollmentId,
          moduleId,
        },
      },
      create: {
        enrollmentId,
        moduleId,
        timeSpentMinutes,
      },
      update: {
        completedAt: new Date(),
        timeSpentMinutes,
      },
    });

    // Calculate new progress
    const totalModules = enrollment.course.modules.length;
    const completedModules = enrollment.moduleCompletions.length + 1;
    const progress =
      totalModules > 0
        ? Math.round((completedModules / totalModules) * 100)
        : 0;

    // Update enrollment progress
    await db.enrollment.update({
      where: { id: enrollmentId },
      data: { progress },
    });

    return {
      progress,
      completedModules,
      totalModules,
    };
  }

  /**
   * Update enrollment progress
   */
  async updateProgress(id: string, input: UpdateProgressInput) {
    const enrollment = await db.enrollment.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    const updateData: Prisma.EnrollmentUpdateInput = {};

    if (input.progress !== undefined) {
      updateData.progress = input.progress;
    }

    if (input.score !== undefined) {
      updateData.score = input.score;
    }

    if (input.passed !== undefined) {
      updateData.passed = input.passed;
    }

    if (input.completedAt) {
      updateData.completedAt = input.completedAt;
      updateData.status = EnrollmentStatus.COMPLETED;
      updateData.progress = 100;
    }

    return db.enrollment.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Complete enrollment
   */
  async complete(id: string, score?: number, passed?: boolean) {
    const enrollment = await db.enrollment.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    return db.enrollment.update({
      where: { id },
      data: {
        status: EnrollmentStatus.COMPLETED,
        completedAt: new Date(),
        progress: 100,
        score,
        passed,
      },
    });
  }

  /**
   * Cancel enrollment
   */
  async cancel(id: string, reason?: string) {
    const enrollment = await db.enrollment.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    if (enrollment.status === EnrollmentStatus.COMPLETED) {
      throw new Error("Cannot cancel completed enrollment");
    }

    return db.enrollment.update({
      where: { id },
      data: {
        status: EnrollmentStatus.CANCELLED,
        rejectionReason: reason ? `Cancelled: ${reason}` : null,
      },
    });
  }

  /**
   * Submit feedback
   */
  async submitFeedback(id: string, rating: number, feedback?: string) {
    const enrollment = await db.enrollment.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    if (enrollment.status !== EnrollmentStatus.COMPLETED) {
      throw new Error("Can only submit feedback for completed courses");
    }

    return db.enrollment.update({
      where: { id },
      data: {
        rating,
        feedback,
      },
    });
  }

  /**
   * Issue certificate
   */
  async issueCertificate(id: string, certificateUrl: string) {
    const enrollment = await db.enrollment.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    if (
      enrollment.status !== EnrollmentStatus.COMPLETED ||
      !enrollment.passed
    ) {
      throw new Error("Certificate can only be issued for passed courses");
    }

    return db.enrollment.update({
      where: { id },
      data: {
        certificateIssued: true,
        certificateUrl,
      },
    });
  }

  /**
   * Get enrollment statistics
   */
  async getStats(dateRange?: { from: Date; to: Date }) {
    const where: Prisma.EnrollmentWhereInput = {
      tenantId: this.tenantId,
    };

    if (dateRange) {
      where.createdAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    const [total, byStatus, completionRate, avgRating] = await Promise.all([
      db.enrollment.count({ where }),

      db.enrollment.groupBy({
        by: ["status"],
        where,
        _count: true,
      }),

      // Completion rate
      Promise.all([
        db.enrollment.count({
          where: { ...where, status: EnrollmentStatus.COMPLETED },
        }),
        db.enrollment.count({
          where: {
            ...where,
            status: {
              in: [
                EnrollmentStatus.COMPLETED,
                EnrollmentStatus.IN_PROGRESS,
                EnrollmentStatus.ENROLLED,
              ],
            },
          },
        }),
      ]),

      // Average rating
      db.enrollment.aggregate({
        where: {
          ...where,
          rating: { not: null },
        },
        _avg: { rating: true },
      }),
    ]);

    const [completed, active] = completionRate;
    const rate = active > 0 ? Math.round((completed / active) * 100) : 0;

    return {
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      completionRate: rate,
      avgRating: avgRating._avg.rating || 0,
    };
  }

  /**
   * Get pending approvals for a manager
   */
  async getPendingApprovals(managerId?: string) {
    const where: Prisma.EnrollmentWhereInput = {
      tenantId: this.tenantId,
      status: EnrollmentStatus.PENDING,
    };

    if (managerId) {
      where.employee = {
        directManagerId: managerId,
      };
    }

    return db.enrollment.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            department: { select: { id: true, name: true } },
          },
        },
        course: {
          select: {
            id: true,
            title: true,
            code: true,
            costPerPerson: true,
          },
        },
      },
    });
  }
}

// Factory function
export function createEnrollmentService(tenantId: string): EnrollmentService {
  return new EnrollmentService(tenantId);
}
