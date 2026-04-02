// src/services/anomaly.service.ts
// Attendance anomaly detection and management service

import { db } from "@/lib/db";
import type {
  AttendanceAnomalyFilters,
  PaginatedResponse,
  AttendanceAnomalyWithRelations,
} from "@/types";
import type {
  Prisma,
  AnomalyType,
  AnomalySeverity,
} from ".prisma/hrm-unified-client";

export const anomalyService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async findAll(
    tenantId: string,
    filters: AttendanceAnomalyFilters = {},
  ): Promise<PaginatedResponse<AttendanceAnomalyWithRelations>> {
    const {
      employeeId,
      attendanceId,
      type,
      severity,
      isResolved,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.AttendanceAnomalyWhereInput = {
      tenantId,
      ...(employeeId && { employeeId }),
      ...(attendanceId && { attendanceId }),
      ...(type && { type }),
      ...(severity && { severity }),
      ...(isResolved !== undefined && { isResolved }),
      ...(dateFrom || dateTo
        ? {
            attendance: {
              date: {
                ...(dateFrom && { gte: new Date(dateFrom) }),
                ...(dateTo && { lte: new Date(dateTo) }),
              },
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      db.attendanceAnomaly.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
            },
          },
          attendance: true,
        },
        orderBy: [{ detectedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.attendanceAnomaly.count({ where }),
    ]);

    return {
      data: data as unknown as AttendanceAnomalyWithRelations[],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  async findById(
    tenantId: string,
    id: string,
  ): Promise<AttendanceAnomalyWithRelations | null> {
    return db.attendanceAnomaly.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
          },
        },
        attendance: true,
      },
    }) as unknown as Promise<AttendanceAnomalyWithRelations | null>;
  },

  async create(
    tenantId: string,
    data: {
      attendanceId: string;
      employeeId: string;
      type: AnomalyType;
      severity?: AnomalySeverity;
      description: string;
      detectedBy?: string;
    },
  ) {
    return db.attendanceAnomaly.create({
      data: {
        tenantId,
        attendanceId: data.attendanceId,
        employeeId: data.employeeId,
        type: data.type,
        severity: data.severity || "MEDIUM",
        description: data.description,
        detectedBy: data.detectedBy || "SYSTEM",
      },
      include: {
        employee: true,
        attendance: true,
      },
    });
  },

  async resolve(
    tenantId: string,
    id: string,
    resolvedBy: string,
    resolution: string,
  ) {
    const anomaly = await db.attendanceAnomaly.findFirst({
      where: { id, tenantId },
    });

    if (!anomaly) {
      throw new Error("Bất thường không tồn tại");
    }

    if (anomaly.isResolved) {
      throw new Error("Bất thường đã được xử lý");
    }

    return db.attendanceAnomaly.update({
      where: { id },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
        resolvedBy,
        resolution,
      },
      include: {
        employee: true,
        attendance: true,
      },
    });
  },

  async bulkResolve(
    tenantId: string,
    ids: string[],
    resolvedBy: string,
    resolution: string,
  ) {
    return db.attendanceAnomaly.updateMany({
      where: {
        id: { in: ids },
        tenantId,
        isResolved: false,
      },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
        resolvedBy,
        resolution,
      },
    });
  },

  async delete(tenantId: string, id: string) {
    const anomaly = await db.attendanceAnomaly.findFirst({
      where: { id, tenantId },
    });

    if (!anomaly) {
      throw new Error("Bất thường không tồn tại");
    }

    return db.attendanceAnomaly.delete({
      where: { id },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // DETECTION
  // ═══════════════════════════════════════════════════════════════

  async detectAnomalies(tenantId: string, date: Date) {
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);

    const dateEnd = new Date(date);
    dateEnd.setHours(23, 59, 59, 999);

    // Get all attendance records for the date
    const attendances = await db.attendance.findMany({
      where: {
        tenantId,
        date: { gte: dateStart, lte: dateEnd },
      },
      include: {
        shift: true,
        employee: true,
      },
    });

    const detected: Array<{
      attendanceId: string;
      employeeId: string;
      type: AnomalyType;
      severity: AnomalySeverity;
      description: string;
    }> = [];

    for (const att of attendances) {
      // Missing check-out
      if (att.checkIn && !att.checkOut) {
        const hoursAgo =
          (Date.now() - att.checkIn.getTime()) / (1000 * 60 * 60);
        if (hoursAgo > 12) {
          detected.push({
            attendanceId: att.id,
            employeeId: att.employeeId,
            type: "MISSING_CHECKOUT",
            severity: "HIGH",
            description: `Nhân viên ${att.employee.fullName} check in lúc ${att.checkIn.toLocaleTimeString("vi-VN")} nhưng chưa check out`,
          });
        }
      }

      // Late check-in (more than 30 minutes)
      if (att.lateMinutes && att.lateMinutes > 30) {
        const severity: AnomalySeverity =
          att.lateMinutes > 60
            ? "HIGH"
            : att.lateMinutes > 30
              ? "MEDIUM"
              : "LOW";

        detected.push({
          attendanceId: att.id,
          employeeId: att.employeeId,
          type: "MISSING_CHECKIN", // Using as "Very late"
          severity,
          description: `Nhân viên ${att.employee.fullName} đi trễ ${att.lateMinutes} phút`,
        });
      }

      // OT without request (if OT hours > 1 and no approved OT request)
      if (att.otHours && Number(att.otHours) > 1) {
        const hasOTRequest = await db.overtimeRequest.findFirst({
          where: {
            tenantId,
            employeeId: att.employeeId,
            date: dateStart,
            status: "APPROVED",
          },
        });

        if (!hasOTRequest) {
          detected.push({
            attendanceId: att.id,
            employeeId: att.employeeId,
            type: "OVERTIME_NO_REQUEST",
            severity: "MEDIUM",
            description: `Nhân viên ${att.employee.fullName} có ${att.otHours} giờ tăng ca nhưng chưa có đơn`,
          });
        }
      }
    }

    // Create anomaly records (avoid duplicates)
    const created: typeof detected = [];

    for (const anomaly of detected) {
      const existing = await db.attendanceAnomaly.findFirst({
        where: {
          tenantId,
          attendanceId: anomaly.attendanceId,
          type: anomaly.type,
        },
      });

      if (!existing) {
        await this.create(tenantId, anomaly);
        created.push(anomaly);
      }
    }

    return {
      checked: attendances.length,
      detected: created.length,
      anomalies: created,
    };
  },

  async detectMissingAttendance(tenantId: string, date: Date) {
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);

    const dayOfWeek = date.getDay();

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { missing: 0, employees: [] };
    }

    // Get all active employees
    const activeEmployees = await db.employee.findMany({
      where: {
        tenantId,
        status: { in: ["ACTIVE", "PROBATION"] },
      },
      select: { id: true, employeeCode: true, fullName: true },
    });

    // Get employees who have attendance for the date
    const attendedEmployeeIds = await db.attendance.findMany({
      where: {
        tenantId,
        date: dateStart,
      },
      select: { employeeId: true },
    });

    const attendedSet = new Set(attendedEmployeeIds.map((a) => a.employeeId));

    // Find missing employees
    const missingEmployees = activeEmployees.filter(
      (e) => !attendedSet.has(e.id),
    );

    return {
      missing: missingEmployees.length,
      employees: missingEmployees,
    };
  },

  // ═══════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════

  async getUnresolvedCount(tenantId: string) {
    return db.attendanceAnomaly.count({
      where: { tenantId, isResolved: false },
    });
  },

  async getAnomalyStats(tenantId: string, year: number, month: number) {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);

    const anomalies = await db.attendanceAnomaly.groupBy({
      by: ["type", "isResolved"],
      where: {
        tenantId,
        detectedAt: { gte: monthStart, lte: monthEnd },
      },
      _count: true,
    });

    const stats: Record<
      string,
      { total: number; resolved: number; unresolved: number }
    > = {};

    for (const item of anomalies) {
      if (!stats[item.type]) {
        stats[item.type] = { total: 0, resolved: 0, unresolved: 0 };
      }
      stats[item.type].total += item._count;
      if (item.isResolved) {
        stats[item.type].resolved += item._count;
      } else {
        stats[item.type].unresolved += item._count;
      }
    }

    return stats;
  },
};
