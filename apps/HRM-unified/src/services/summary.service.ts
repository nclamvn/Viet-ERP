// src/services/summary.service.ts
// Attendance summary service (monthly timesheet)

import { db } from "@/lib/db";
import type {
  AttendanceSummaryFilters,
  PaginatedResponse,
  AttendanceSummaryWithRelations,
  MonthlySummaryData,
} from "@/types";
import type { Prisma } from ".prisma/hrm-unified-client";
import { getWorkingDaysInMonth, roundHours } from "@/lib/attendance/time-utils";

export const summaryService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async findAll(
    tenantId: string,
    filters: AttendanceSummaryFilters = {},
  ): Promise<PaginatedResponse<AttendanceSummaryWithRelations>> {
    const {
      employeeId,
      departmentId,
      year,
      month,
      isLocked,
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.AttendanceSummaryWhereInput = {
      tenantId,
      ...(employeeId && { employeeId }),
      ...(departmentId && {
        employee: { departmentId },
      }),
      ...(year && { year }),
      ...(month && { month }),
      ...(isLocked !== undefined && { isLocked }),
    };

    const [data, total] = await Promise.all([
      db.attendanceSummary.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              department: { select: { id: true, name: true } },
              position: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.attendanceSummary.count({ where }),
    ]);

    return {
      data: data as unknown as AttendanceSummaryWithRelations[],
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
  ): Promise<AttendanceSummaryWithRelations | null> {
    return db.attendanceSummary.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: { select: { id: true, name: true } },
            position: { select: { id: true, name: true } },
          },
        },
      },
    }) as unknown as Promise<AttendanceSummaryWithRelations | null>;
  },

  async findByEmployeeAndMonth(
    tenantId: string,
    employeeId: string,
    year: number,
    month: number,
  ) {
    return db.attendanceSummary.findFirst({
      where: { tenantId, employeeId, year, month },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
          },
        },
      },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // CALCULATE SUMMARY
  // ═══════════════════════════════════════════════════════════════

  async calculateSummary(
    tenantId: string,
    employeeId: string,
    year: number,
    month: number,
  ): Promise<MonthlySummaryData> {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);

    // Get all attendance records for the month
    const attendances = await db.attendance.findMany({
      where: {
        tenantId,
        employeeId,
        date: { gte: monthStart, lte: monthEnd },
      },
      include: {
        anomalies: true,
      },
    });

    // Get approved OT requests
    const otRequests = await db.overtimeRequest.findMany({
      where: {
        tenantId,
        employeeId,
        date: { gte: monthStart, lte: monthEnd },
        status: "APPROVED",
      },
    });

    // Calculate working days (standard business days in month)
    const workingDays = getWorkingDaysInMonth(year, month);
    const standardHours = workingDays * 8;

    // Initialize counters
    let presentDays = 0;
    let absentDays = 0;
    let paidLeaveDays = 0;
    const unpaidLeaveDays = 0;
    const sickLeaveDays = 0;
    let totalWorkHours = 0;
    let lateTimes = 0;
    let earlyLeaveTimes = 0;
    let totalLateMinutes = 0;
    let totalEarlyMinutes = 0;
    let anomalyCount = 0;
    let unresolvedAnomalies = 0;

    // Process attendance records
    for (const att of attendances) {
      switch (att.status) {
        case "PRESENT":
        case "LATE":
        case "EARLY_LEAVE":
        case "LATE_AND_EARLY":
          presentDays++;
          break;
        case "ABSENT":
          absentDays++;
          break;
        case "ON_LEAVE":
          paidLeaveDays++;
          break;
      }

      // Sum work hours
      if (att.workHours) {
        totalWorkHours += Number(att.workHours);
      }

      // Count late/early
      if (att.lateMinutes && att.lateMinutes > 0) {
        lateTimes++;
        totalLateMinutes += att.lateMinutes;
      }

      if (att.earlyMinutes && att.earlyMinutes > 0) {
        earlyLeaveTimes++;
        totalEarlyMinutes += att.earlyMinutes;
      }

      // Count anomalies
      if (att.anomalies) {
        anomalyCount += att.anomalies.length;
        unresolvedAnomalies += att.anomalies.filter(
          (a) => !a.isResolved,
        ).length;
      }
    }

    // Calculate OT hours
    let otWeekdayHours = 0;
    let otWeekendHours = 0;
    let otHolidayHours = 0;
    let otNightHours = 0;

    for (const ot of otRequests) {
      const hours = Number(ot.actualHours || ot.plannedHours);

      switch (ot.dayType) {
        case "HOLIDAY":
          otHolidayHours += hours;
          break;
        case "WEEKEND":
          otWeekendHours += hours;
          break;
        default:
          otWeekdayHours += hours;
      }

      if (ot.isNightShift) {
        otNightHours += hours;
      }
    }

    const totalOtHours = otWeekdayHours + otWeekendHours + otHolidayHours;

    // Calculate actual work days (including partial days)
    const actualWorkDays = roundHours(totalWorkHours / 8);

    return {
      workingDays,
      actualWorkDays,
      presentDays,
      absentDays,
      paidLeaveDays,
      unpaidLeaveDays,
      sickLeaveDays,
      totalWorkHours: roundHours(totalWorkHours),
      standardHours,
      otWeekdayHours: roundHours(otWeekdayHours),
      otWeekendHours: roundHours(otWeekendHours),
      otHolidayHours: roundHours(otHolidayHours),
      otNightHours: roundHours(otNightHours),
      totalOtHours: roundHours(totalOtHours),
      lateTimes,
      earlyLeaveTimes,
      totalLateMinutes,
      totalEarlyMinutes,
      anomalyCount,
      unresolvedAnomalies,
    };
  },

  async generateSummary(
    tenantId: string,
    employeeId: string,
    year: number,
    month: number,
  ) {
    // Check if summary exists
    const existing = await this.findByEmployeeAndMonth(
      tenantId,
      employeeId,
      year,
      month,
    );

    if (existing?.isLocked) {
      throw new Error("Bảng công đã khóa, không thể tính lại");
    }

    // Calculate summary data
    const summaryData = await this.calculateSummary(
      tenantId,
      employeeId,
      year,
      month,
    );

    // Upsert summary
    return db.attendanceSummary.upsert({
      where: {
        tenantId_employeeId_year_month: {
          tenantId,
          employeeId,
          year,
          month,
        },
      },
      create: {
        tenantId,
        employeeId,
        year,
        month,
        ...summaryData,
      },
      update: {
        ...summaryData,
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
          },
        },
      },
    });
  },

  async generateSummariesForMonth(
    tenantId: string,
    year: number,
    month: number,
    departmentId?: string,
  ) {
    // Get all active employees
    const employees = await db.employee.findMany({
      where: {
        tenantId,
        status: { in: ["ACTIVE", "PROBATION"] },
        ...(departmentId && { departmentId }),
      },
      select: { id: true },
    });

    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ employeeId: string; error: string }>,
    };

    // Generate summary for each employee
    for (const emp of employees) {
      try {
        await this.generateSummary(tenantId, emp.id, year, month);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          employeeId: emp.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  },

  // ═══════════════════════════════════════════════════════════════
  // LOCK/UNLOCK
  // ═══════════════════════════════════════════════════════════════

  async lockSummary(tenantId: string, id: string, lockedBy: string) {
    const summary = await db.attendanceSummary.findFirst({
      where: { id, tenantId },
    });

    if (!summary) {
      throw new Error("Bảng công không tồn tại");
    }

    if (summary.isLocked) {
      throw new Error("Bảng công đã được khóa");
    }

    return db.attendanceSummary.update({
      where: { id },
      data: {
        isLocked: true,
        lockedAt: new Date(),
        lockedBy,
      },
    });
  },

  async unlockSummary(tenantId: string, id: string) {
    const summary = await db.attendanceSummary.findFirst({
      where: { id, tenantId },
    });

    if (!summary) {
      throw new Error("Bảng công không tồn tại");
    }

    return db.attendanceSummary.update({
      where: { id },
      data: {
        isLocked: false,
        lockedAt: null,
        lockedBy: null,
      },
    });
  },

  async lockMonth(
    tenantId: string,
    year: number,
    month: number,
    lockedBy: string,
  ) {
    return db.attendanceSummary.updateMany({
      where: {
        tenantId,
        year,
        month,
        isLocked: false,
      },
      data: {
        isLocked: true,
        lockedAt: new Date(),
        lockedBy,
      },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // REPORTS
  // ═══════════════════════════════════════════════════════════════

  async getDepartmentSummary(
    tenantId: string,
    departmentId: string,
    year: number,
    month: number,
  ) {
    const summaries = await db.attendanceSummary.findMany({
      where: {
        tenantId,
        year,
        month,
        employee: { departmentId },
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
          },
        },
      },
    });

    // Aggregate department stats
    let totalWorkHours = 0;
    let totalOtHours = 0;
    let totalLateTimes = 0;
    let totalAnomalies = 0;

    for (const s of summaries) {
      totalWorkHours += Number(s.totalWorkHours);
      totalOtHours += Number(s.totalOtHours);
      totalLateTimes += s.lateTimes;
      totalAnomalies += s.anomalyCount;
    }

    return {
      employeeCount: summaries.length,
      totalWorkHours: roundHours(totalWorkHours),
      averageWorkHours: roundHours(totalWorkHours / (summaries.length || 1)),
      totalOtHours: roundHours(totalOtHours),
      totalLateTimes,
      totalAnomalies,
      summaries,
    };
  },
};
