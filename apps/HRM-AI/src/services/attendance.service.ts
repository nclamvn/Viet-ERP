// src/services/attendance.service.ts
// Attendance management service

import { db } from "@/lib/db";
import type {
  AttendanceFilters,
  PaginatedResponse,
  AttendanceWithRelations,
  ClockInRequest,
  ClockOutRequest,
  ClockResponse,
} from "@/types";
import type { Prisma, AttendanceStatus, DayType } from ".prisma/hrm-ai-client";
import { calculateWorkHours } from "@/lib/attendance";
import { shiftService } from "./shift.service";

export const attendanceService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async findAll(
    tenantId: string,
    filters: AttendanceFilters = {},
  ): Promise<PaginatedResponse<AttendanceWithRelations>> {
    const {
      search,
      employeeId,
      departmentId,
      shiftId,
      status,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.AttendanceWhereInput = {
      tenantId,
      ...(employeeId && { employeeId }),
      ...(shiftId && { shiftId }),
      ...(status && { status }),
      ...(departmentId && {
        employee: { departmentId },
      }),
      ...(search && {
        employee: {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { employeeCode: { contains: search, mode: "insensitive" } },
          ],
        },
      }),
      ...(dateFrom &&
        dateTo && {
          date: {
            gte: new Date(dateFrom),
            lte: new Date(dateTo),
          },
        }),
      ...(dateFrom &&
        !dateTo && {
          date: { gte: new Date(dateFrom) },
        }),
      ...(!dateFrom &&
        dateTo && {
          date: { lte: new Date(dateTo) },
        }),
    };

    const [data, total] = await Promise.all([
      db.attendance.findMany({
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
          shift: true,
          anomalies: true,
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.attendance.count({ where }),
    ]);

    return {
      data: data as unknown as AttendanceWithRelations[],
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
  ): Promise<AttendanceWithRelations | null> {
    return db.attendance.findFirst({
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
        shift: true,
        anomalies: true,
      },
    }) as unknown as Promise<AttendanceWithRelations | null>;
  },

  async findByEmployeeAndDate(
    tenantId: string,
    employeeId: string,
    date: Date,
  ) {
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);

    return db.attendance.findFirst({
      where: {
        tenantId,
        employeeId,
        date: dateStart,
      },
      include: {
        shift: true,
        anomalies: true,
      },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // CLOCK IN/OUT
  // ═══════════════════════════════════════════════════════════════

  async clockIn(
    tenantId: string,
    employeeId: string,
    data: ClockInRequest,
  ): Promise<ClockResponse> {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Check if already clocked in today
    const existing = await this.findByEmployeeAndDate(
      tenantId,
      employeeId,
      today,
    );

    if (existing?.checkIn) {
      throw new Error("Bạn đã check in hôm nay rồi");
    }

    // Get employee's shift for today
    const shift = await shiftService.getEmployeeShift(employeeId, today);

    // Determine day type (will be enhanced with holiday check)
    const dayType = this.getDayType(today);

    if (existing) {
      // Update existing record
      const attendance = await db.attendance.update({
        where: { id: existing.id },
        data: {
          checkIn: now,
          checkInSource: data.source,
          checkInLat: data.latitude,
          checkInLng: data.longitude,
          checkInAddress: data.address,
        },
        include: { shift: true },
      });

      return {
        attendance,
        message: "Check in thành công",
      };
    }

    // Create new attendance record
    const attendance = await db.attendance.create({
      data: {
        tenantId,
        employeeId,
        shiftId: shift?.id,
        date: today,
        dayType,
        checkIn: now,
        checkInSource: data.source,
        checkInLat: data.latitude,
        checkInLng: data.longitude,
        checkInAddress: data.address,
        status: "PRESENT",
      },
      include: { shift: true },
    });

    return {
      attendance,
      message: "Check in thành công",
    };
  },

  async clockOut(
    tenantId: string,
    employeeId: string,
    data: ClockOutRequest,
  ): Promise<ClockResponse> {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Find today's attendance record
    const attendance = await this.findByEmployeeAndDate(
      tenantId,
      employeeId,
      today,
    );

    if (!attendance) {
      throw new Error("Bạn chưa check in hôm nay");
    }

    if (!attendance.checkIn) {
      throw new Error("Bạn chưa check in hôm nay");
    }

    if (attendance.checkOut) {
      throw new Error("Bạn đã check out hôm nay rồi");
    }

    // Calculate work hours
    const workHoursResult = calculateWorkHours({
      checkIn: attendance.checkIn,
      checkOut: now,
      shift: attendance.shift,
      dayType: attendance.dayType,
    });

    // Update attendance record
    const updated = await db.attendance.update({
      where: { id: attendance.id },
      data: {
        checkOut: now,
        checkOutSource: data.source,
        checkOutLat: data.latitude,
        checkOutLng: data.longitude,
        checkOutAddress: data.address,
        workHours: workHoursResult.workHours,
        otHours: workHoursResult.otHours,
        nightHours: workHoursResult.nightHours,
        lateMinutes: workHoursResult.lateMinutes,
        earlyMinutes: workHoursResult.earlyMinutes,
        status: workHoursResult.status,
      },
      include: {
        shift: true,
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
          },
        },
      },
    });

    return {
      attendance: updated,
      message: "Check out thành công",
    };
  },

  // ═══════════════════════════════════════════════════════════════
  // MANUAL ENTRY & ADJUSTMENT
  // ═══════════════════════════════════════════════════════════════

  async createManualEntry(
    tenantId: string,
    data: {
      employeeId: string;
      date: Date;
      checkIn?: Date;
      checkOut?: Date;
      status: AttendanceStatus;
      dayType?: DayType;
      notes?: string;
    },
    adjustedBy: string,
  ) {
    const dateStart = new Date(data.date);
    dateStart.setHours(0, 0, 0, 0);

    // Check for existing record
    const existing = await this.findByEmployeeAndDate(
      tenantId,
      data.employeeId,
      dateStart,
    );

    if (existing) {
      throw new Error("Đã có bản ghi chấm công cho ngày này");
    }

    // Get shift
    const shift = await shiftService.getEmployeeShift(
      data.employeeId,
      dateStart,
    );

    // Calculate work hours if both checkIn and checkOut provided
    let workHoursResult = null;
    if (data.checkIn && data.checkOut) {
      workHoursResult = calculateWorkHours({
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        shift,
        dayType: data.dayType || "NORMAL",
      });
    }

    return db.attendance.create({
      data: {
        tenantId,
        employeeId: data.employeeId,
        shiftId: shift?.id,
        date: dateStart,
        dayType: data.dayType || this.getDayType(dateStart),
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        checkInSource: "MANUAL",
        checkOutSource: data.checkOut ? "MANUAL" : null,
        status: data.status,
        workHours: workHoursResult?.workHours,
        otHours: workHoursResult?.otHours,
        nightHours: workHoursResult?.nightHours,
        lateMinutes: workHoursResult?.lateMinutes,
        earlyMinutes: workHoursResult?.earlyMinutes,
        isManualEntry: true,
        adjustedBy,
        adjustmentNote: data.notes,
        notes: data.notes,
      },
      include: {
        employee: true,
        shift: true,
      },
    });
  },

  async adjustAttendance(
    tenantId: string,
    id: string,
    data: {
      checkIn?: Date;
      checkOut?: Date;
      status?: AttendanceStatus;
      notes?: string;
    },
    adjustedBy: string,
  ) {
    const attendance = await db.attendance.findFirst({
      where: { id, tenantId },
      include: { shift: true },
    });

    if (!attendance) {
      throw new Error("Bản ghi chấm công không tồn tại");
    }

    const checkIn = data.checkIn || attendance.checkIn;
    const checkOut = data.checkOut || attendance.checkOut;

    // Recalculate work hours
    let workHoursResult = null;
    if (checkIn && checkOut) {
      workHoursResult = calculateWorkHours({
        checkIn,
        checkOut,
        shift: attendance.shift,
        dayType: attendance.dayType,
      });
    }

    return db.attendance.update({
      where: { id },
      data: {
        checkIn,
        checkOut,
        status: data.status || workHoursResult?.status || attendance.status,
        workHours: workHoursResult?.workHours,
        otHours: workHoursResult?.otHours,
        nightHours: workHoursResult?.nightHours,
        lateMinutes: workHoursResult?.lateMinutes,
        earlyMinutes: workHoursResult?.earlyMinutes,
        adjustedBy,
        adjustmentNote: data.notes,
      },
      include: {
        employee: true,
        shift: true,
      },
    });
  },

  async delete(tenantId: string, id: string) {
    const attendance = await db.attendance.findFirst({
      where: { id, tenantId },
    });

    if (!attendance) {
      throw new Error("Bản ghi chấm công không tồn tại");
    }

    return db.attendance.delete({
      where: { id },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // TODAY'S STATUS
  // ═══════════════════════════════════════════════════════════════

  async getTodayStatus(tenantId: string, employeeId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.findByEmployeeAndDate(
      tenantId,
      employeeId,
      today,
    );
    const shift = await shiftService.getEmployeeShift(employeeId, today);

    return {
      attendance,
      shift,
      hasCheckedIn: !!attendance?.checkIn,
      hasCheckedOut: !!attendance?.checkOut,
    };
  },

  async getTodayStats(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [present, absent, late, onLeave, total] = await Promise.all([
      db.attendance.count({
        where: {
          tenantId,
          date: { gte: today, lt: tomorrow },
          status: "PRESENT",
        },
      }),
      db.attendance.count({
        where: {
          tenantId,
          date: { gte: today, lt: tomorrow },
          status: "ABSENT",
        },
      }),
      db.attendance.count({
        where: {
          tenantId,
          date: { gte: today, lt: tomorrow },
          status: { in: ["LATE", "LATE_AND_EARLY"] },
        },
      }),
      db.attendance.count({
        where: {
          tenantId,
          date: { gte: today, lt: tomorrow },
          status: "ON_LEAVE",
        },
      }),
      db.employee.count({
        where: { tenantId, status: "ACTIVE" },
      }),
    ]);

    return {
      present,
      absent,
      late,
      onLeave,
      totalEmployees: total,
      attendanceRate: total > 0 ? Math.round((present / total) * 100) : 0,
    };
  },

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  getDayType(date: Date): DayType {
    const day = date.getDay();
    if (day === 0 || day === 6) {
      return "WEEKEND";
    }
    return "NORMAL";
  },

  async getEmployeeAttendanceByMonth(
    tenantId: string,
    employeeId: string,
    year: number,
    month: number,
  ) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    return db.attendance.findMany({
      where: {
        tenantId,
        employeeId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        shift: true,
        anomalies: true,
      },
      orderBy: { date: "asc" },
    });
  },
};
