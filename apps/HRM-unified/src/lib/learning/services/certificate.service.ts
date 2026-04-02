// src/lib/learning/services/certificate.service.ts
// Certificate Service - Manage course completion certificates

import { db } from "@/lib/db";
import { EnrollmentStatus, Prisma } from ".prisma/hrm-unified-client";
import crypto from "crypto";

// Types
export interface CertificateData {
  enrollmentId: string;
  employeeId: string;
  employeeName: string;
  courseId: string;
  courseTitle: string;
  courseCode: string;
  completionDate: Date;
  score?: number;
  passed: boolean;
  certificateNumber: string;
  certificateUrl: string;
}

export interface CertificateFilters {
  employeeId?: string;
  courseId?: string;
  fromDate?: Date;
  toDate?: Date;
}

export interface CertificateTemplate {
  id: string;
  name: string;
  htmlTemplate: string;
  cssStyles?: string;
  isDefault: boolean;
}

export class CertificateService {
  constructor(private tenantId: string) {}

  /**
   * Generate certificate number
   */
  private generateCertificateNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(4).toString("hex").toUpperCase();
    return `CERT-${timestamp}-${random}`;
  }

  /**
   * Issue certificate for completed enrollment
   */
  async issue(enrollmentId: string) {
    const enrollment = await db.enrollment.findFirst({
      where: {
        id: enrollmentId,
        tenantId: this.tenantId,
      },
      include: {
        employee: {
          select: { id: true, fullName: true, workEmail: true },
        },
        course: {
          select: { id: true, title: true, code: true, durationHours: true },
        },
      },
    });

    if (!enrollment) {
      throw new Error("Enrollment not found");
    }

    if (enrollment.status !== EnrollmentStatus.COMPLETED) {
      throw new Error(
        "Certificate can only be issued for completed enrollments",
      );
    }

    if (!enrollment.passed) {
      throw new Error("Certificate can only be issued for passed enrollments");
    }

    if (enrollment.certificateIssued) {
      throw new Error("Certificate already issued for this enrollment");
    }

    // Generate certificate number
    const certificateNumber = this.generateCertificateNumber();

    // In a real implementation, you would generate a PDF certificate
    // and upload to storage, returning the URL
    // For now, we use a placeholder URL pattern
    const certificateUrl = `/api/certificates/${enrollmentId}/download`;

    // Update enrollment with certificate info
    const updated = await db.enrollment.update({
      where: { id: enrollmentId },
      data: {
        certificateIssued: true,
        certificateUrl,
      },
    });

    return {
      enrollment: updated,
      certificateNumber,
      certificateUrl,
      issuedAt: new Date(),
    };
  }

  /**
   * Get certificate data for an enrollment
   */
  async getCertificateData(
    enrollmentId: string,
  ): Promise<CertificateData | null> {
    const enrollment = await db.enrollment.findFirst({
      where: {
        id: enrollmentId,
        tenantId: this.tenantId,
        certificateIssued: true,
      },
      include: {
        employee: {
          select: { id: true, fullName: true },
        },
        course: {
          select: { id: true, title: true, code: true },
        },
      },
    });

    if (!enrollment) {
      return null;
    }

    return {
      enrollmentId: enrollment.id,
      employeeId: enrollment.employeeId,
      employeeName: enrollment.employee.fullName,
      courseId: enrollment.courseId,
      courseTitle: enrollment.course.title,
      courseCode: enrollment.course.code,
      completionDate: enrollment.completedAt!,
      score: enrollment.score ? Number(enrollment.score) : undefined,
      passed: enrollment.passed ?? false,
      certificateNumber: this.generateCertificateNumber(), // Would be stored in DB
      certificateUrl: enrollment.certificateUrl!,
    };
  }

  /**
   * Verify certificate is valid
   */
  async verify(
    enrollmentId: string,
  ): Promise<{ valid: boolean; data?: CertificateData; reason?: string }> {
    const enrollment = await db.enrollment.findFirst({
      where: {
        id: enrollmentId,
        tenantId: this.tenantId,
      },
      include: {
        employee: {
          select: { id: true, fullName: true },
        },
        course: {
          select: { id: true, title: true, code: true },
        },
      },
    });

    if (!enrollment) {
      return { valid: false, reason: "Enrollment not found" };
    }

    if (!enrollment.certificateIssued) {
      return {
        valid: false,
        reason: "No certificate issued for this enrollment",
      };
    }

    if (enrollment.status !== EnrollmentStatus.COMPLETED) {
      return { valid: false, reason: "Enrollment is not completed" };
    }

    if (!enrollment.passed) {
      return { valid: false, reason: "Course was not passed" };
    }

    return {
      valid: true,
      data: {
        enrollmentId: enrollment.id,
        employeeId: enrollment.employeeId,
        employeeName: enrollment.employee.fullName,
        courseId: enrollment.courseId,
        courseTitle: enrollment.course.title,
        courseCode: enrollment.course.code,
        completionDate: enrollment.completedAt!,
        score: enrollment.score ? Number(enrollment.score) : undefined,
        passed: true,
        certificateNumber: this.generateCertificateNumber(),
        certificateUrl: enrollment.certificateUrl!,
      },
    };
  }

  /**
   * List certificates for an employee
   */
  async listByEmployee(employeeId: string) {
    const enrollments = await db.enrollment.findMany({
      where: {
        tenantId: this.tenantId,
        employeeId,
        certificateIssued: true,
      },
      orderBy: { completedAt: "desc" },
      include: {
        course: {
          select: { id: true, title: true, code: true, thumbnailUrl: true },
        },
      },
    });

    return enrollments.map((e) => ({
      enrollmentId: e.id,
      courseId: e.courseId,
      courseTitle: e.course.title,
      courseCode: e.course.code,
      thumbnailUrl: e.course.thumbnailUrl,
      completedAt: e.completedAt,
      score: e.score ? Number(e.score) : null,
      certificateUrl: e.certificateUrl,
    }));
  }

  /**
   * List all issued certificates
   */
  async list(
    filters: CertificateFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.EnrollmentWhereInput = {
      tenantId: this.tenantId,
      certificateIssued: true,
    };

    if (filters.employeeId) {
      where.employeeId = filters.employeeId;
    }

    if (filters.courseId) {
      where.courseId = filters.courseId;
    }

    if (filters.fromDate) {
      where.completedAt = { gte: filters.fromDate };
    }

    if (filters.toDate) {
      where.completedAt = {
        ...((where.completedAt as object) || {}),
        lte: filters.toDate,
      };
    }

    const [enrollments, total] = await Promise.all([
      db.enrollment.findMany({
        where,
        orderBy: { completedAt: "desc" },
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
        },
      }),
      db.enrollment.count({ where }),
    ]);

    return {
      data: enrollments.map((e) => ({
        enrollmentId: e.id,
        employeeId: e.employeeId,
        employeeName: e.employee.fullName,
        departmentName: e.employee.department?.name,
        courseId: e.courseId,
        courseTitle: e.course.title,
        courseCode: e.course.code,
        completedAt: e.completedAt,
        score: e.score ? Number(e.score) : null,
        certificateUrl: e.certificateUrl,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Revoke certificate (mark as invalid)
   */
  async revoke(enrollmentId: string, reason: string) {
    const enrollment = await db.enrollment.findFirst({
      where: {
        id: enrollmentId,
        tenantId: this.tenantId,
        certificateIssued: true,
      },
    });

    if (!enrollment) {
      throw new Error("Certificate not found");
    }

    // In a real implementation, you might have a separate revocation table
    // For now, we'll update the enrollment
    await db.enrollment.update({
      where: { id: enrollmentId },
      data: {
        certificateIssued: false,
        certificateUrl: null,
        // Could add revocation reason to a notes field or separate table
      },
    });

    return { success: true, reason };
  }

  /**
   * Bulk issue certificates for eligible enrollments
   */
  async bulkIssue(courseId?: string) {
    const where: Prisma.EnrollmentWhereInput = {
      tenantId: this.tenantId,
      status: EnrollmentStatus.COMPLETED,
      passed: true,
      certificateIssued: false,
    };

    if (courseId) {
      where.courseId = courseId;
    }

    const eligibleEnrollments = await db.enrollment.findMany({
      where,
      include: {
        employee: { select: { id: true, fullName: true } },
        course: { select: { id: true, title: true } },
      },
    });

    const results = [];
    for (const enrollment of eligibleEnrollments) {
      try {
        const result = await this.issue(enrollment.id);
        results.push({
          enrollmentId: enrollment.id,
          employeeName: enrollment.employee.fullName,
          courseTitle: enrollment.course.title,
          success: true,
          certificateUrl: result.certificateUrl,
        });
      } catch (error) {
        results.push({
          enrollmentId: enrollment.id,
          employeeName: enrollment.employee.fullName,
          courseTitle: enrollment.course.title,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      total: eligibleEnrollments.length,
      issued: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * Get certificate statistics
   */
  async getStats(dateRange?: { from: Date; to: Date }) {
    const where: Prisma.EnrollmentWhereInput = {
      tenantId: this.tenantId,
      certificateIssued: true,
    };

    if (dateRange) {
      where.completedAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    const [total, byCourse, byDepartment] = await Promise.all([
      db.enrollment.count({ where }),

      db.enrollment.groupBy({
        by: ["courseId"],
        where,
        _count: true,
        orderBy: { _count: { courseId: "desc" } },
        take: 10,
      }),

      db.enrollment.findMany({
        where,
        select: {
          employee: {
            select: {
              department: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    // Get course names
    const courseIds = byCourse.map((c) => c.courseId);
    const courses = await db.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, title: true },
    });
    const courseMap = new Map(courses.map((c) => [c.id, c.title]));

    // Count by department
    const deptCounts: Record<
      string,
      { id: string; name: string; count: number }
    > = {};
    byDepartment.forEach((e) => {
      if (e.employee.department) {
        const deptId = e.employee.department.id;
        if (!deptCounts[deptId]) {
          deptCounts[deptId] = {
            id: deptId,
            name: e.employee.department.name,
            count: 0,
          };
        }
        deptCounts[deptId].count++;
      }
    });

    return {
      totalCertificates: total,
      topCourses: byCourse.map((c) => ({
        courseId: c.courseId,
        courseTitle: courseMap.get(c.courseId) || "Unknown",
        count: c._count,
      })),
      byDepartment: Object.values(deptCounts).sort((a, b) => b.count - a.count),
    };
  }

  /**
   * Get expiring certifications (for courses with recertification requirements)
   */
  async getExpiringCertificates(daysAhead: number = 30) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    // Get courses with recertification requirements
    const coursesWithRecert = await db.course.findMany({
      where: {
        tenantId: this.tenantId,
        recertificationMonths: { not: null },
      },
      select: { id: true, title: true, recertificationMonths: true },
    });

    const expiringCerts = [];

    for (const course of coursesWithRecert) {
      if (!course.recertificationMonths) continue;

      const expirationThreshold = new Date();
      expirationThreshold.setMonth(
        expirationThreshold.getMonth() - course.recertificationMonths,
      );
      expirationThreshold.setDate(expirationThreshold.getDate() + daysAhead);

      const enrollments = await db.enrollment.findMany({
        where: {
          tenantId: this.tenantId,
          courseId: course.id,
          status: EnrollmentStatus.COMPLETED,
          passed: true,
          completedAt: {
            lte: expirationThreshold,
          },
        },
        include: {
          employee: {
            select: { id: true, fullName: true, workEmail: true },
          },
        },
      });

      for (const enrollment of enrollments) {
        if (!enrollment.completedAt) continue;

        const expirationDate = new Date(enrollment.completedAt);
        expirationDate.setMonth(
          expirationDate.getMonth() + course.recertificationMonths,
        );

        if (expirationDate <= futureDate) {
          expiringCerts.push({
            enrollmentId: enrollment.id,
            employeeId: enrollment.employeeId,
            employeeName: enrollment.employee.fullName,
            employeeEmail: enrollment.employee.workEmail,
            courseId: course.id,
            courseTitle: course.title,
            completedAt: enrollment.completedAt,
            expirationDate,
            daysUntilExpiration: Math.ceil(
              (expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            ),
          });
        }
      }
    }

    return expiringCerts.sort(
      (a, b) => a.daysUntilExpiration - b.daysUntilExpiration,
    );
  }
}

// Factory function
export function createCertificateService(tenantId: string): CertificateService {
  return new CertificateService(tenantId);
}
