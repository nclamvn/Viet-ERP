// src/services/overtime.service.ts
// Overtime request management service

import { db } from "@/lib/db";
import type {
  OvertimeFilters,
  PaginatedResponse,
  OvertimeRequestWithRelations,
} from "@/types";
import type { Prisma, DayType } from ".prisma/hrm-unified-client";
import { calculateOT, validateOTRequest } from "@/lib/attendance/ot-calculator";
import { getTimeDiffInHours, roundHours } from "@/lib/attendance/time-utils";

export const overtimeService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async findAll(
    tenantId: string,
    filters: OvertimeFilters = {},
  ): Promise<PaginatedResponse<OvertimeRequestWithRelations>> {
    const {
      search,
      employeeId,
      departmentId,
      status,
      dateFrom,
      dateTo,
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.OvertimeRequestWhereInput = {
      tenantId,
      ...(employeeId && { employeeId }),
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
      db.overtimeRequest.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              department: { select: { id: true, name: true } },
            },
          },
          approver: {
            select: { id: true, name: true },
          },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.overtimeRequest.count({ where }),
    ]);

    return {
      data: data as unknown as OvertimeRequestWithRelations[],
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
  ): Promise<OvertimeRequestWithRelations | null> {
    return db.overtimeRequest.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: { select: { id: true, name: true } },
          },
        },
        approver: {
          select: { id: true, name: true },
        },
      },
    }) as unknown as Promise<OvertimeRequestWithRelations | null>;
  },

  async create(
    tenantId: string,
    data: {
      employeeId: string;
      date: Date;
      startTime: Date;
      endTime: Date;
      dayType?: DayType;
      reason: string;
      attachmentUrl?: string;
      notes?: string;
    },
  ) {
    // Calculate planned hours
    const plannedHours = roundHours(
      getTimeDiffInHours(data.startTime, data.endTime),
    );

    // Get existing OT hours in the month for validation
    const monthStart = new Date(
      data.date.getFullYear(),
      data.date.getMonth(),
      1,
    );
    const monthEnd = new Date(
      data.date.getFullYear(),
      data.date.getMonth() + 1,
      0,
    );

    const existingOT = await db.overtimeRequest.aggregate({
      where: {
        tenantId,
        employeeId: data.employeeId,
        date: { gte: monthStart, lte: monthEnd },
        status: { in: ["PENDING", "APPROVED"] },
      },
      _sum: { plannedHours: true },
    });

    const existingHours = Number(existingOT._sum.plannedHours || 0);

    // Get yearly OT hours for Article 107 validation
    const yearStart = new Date(data.date.getFullYear(), 0, 1);
    const yearEnd = new Date(data.date.getFullYear(), 11, 31);
    const yearlyOT = await db.overtimeRequest.aggregate({
      where: {
        tenantId,
        employeeId: data.employeeId,
        date: { gte: yearStart, lte: yearEnd },
        status: { in: ["PENDING", "APPROVED"] },
      },
      _sum: { plannedHours: true },
    });
    const existingYearlyHours = Number(yearlyOT._sum.plannedHours || 0);

    // Validate OT request (monthly + yearly limits per Labor Code Article 107)
    const validation = validateOTRequest(
      data.startTime,
      data.endTime,
      existingHours,
      4,
      40,
      { existingYearlyOTHours: existingYearlyHours },
    );

    if (!validation.isValid) {
      throw new Error(validation.errors.join(", "));
    }

    // Calculate OT details
    const otCalculation = calculateOT(
      data.startTime,
      data.endTime,
      data.dayType || "NORMAL",
    );

    return db.overtimeRequest.create({
      data: {
        tenantId,
        employeeId: data.employeeId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        plannedHours,
        dayType: data.dayType || "NORMAL",
        isNightShift: otCalculation.isNightShift,
        multiplier: otCalculation.totalMultiplier,
        reason: data.reason,
        status: "PENDING",
        attachmentUrl: data.attachmentUrl,
        notes: data.notes,
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

  async update(
    tenantId: string,
    id: string,
    data: {
      date?: Date;
      startTime?: Date;
      endTime?: Date;
      dayType?: DayType;
      reason?: string;
      attachmentUrl?: string;
      notes?: string;
    },
  ) {
    const existing = await db.overtimeRequest.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error("Đơn tăng ca không tồn tại");
    }

    if (existing.status !== "PENDING") {
      throw new Error("Chỉ có thể sửa đơn tăng ca đang chờ duyệt");
    }

    const startTime = data.startTime || existing.startTime;
    const endTime = data.endTime || existing.endTime;
    const dayType = data.dayType || existing.dayType;

    // Recalculate if times changed
    const plannedHours = roundHours(getTimeDiffInHours(startTime, endTime));
    const otCalculation = calculateOT(startTime, endTime, dayType);

    return db.overtimeRequest.update({
      where: { id },
      data: {
        date: data.date,
        startTime,
        endTime,
        plannedHours,
        dayType,
        isNightShift: otCalculation.isNightShift,
        multiplier: otCalculation.totalMultiplier,
        reason: data.reason,
        attachmentUrl: data.attachmentUrl,
        notes: data.notes,
      },
      include: {
        employee: true,
      },
    });
  },

  async delete(tenantId: string, id: string) {
    const existing = await db.overtimeRequest.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error("Đơn tăng ca không tồn tại");
    }

    if (existing.status === "APPROVED") {
      throw new Error("Không thể xóa đơn tăng ca đã được duyệt");
    }

    return db.overtimeRequest.delete({
      where: { id },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // APPROVAL WORKFLOW
  // ═══════════════════════════════════════════════════════════════

  async approve(
    tenantId: string,
    id: string,
    approverId: string,
    actualHours?: number,
  ) {
    const existing = await db.overtimeRequest.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error("Đơn tăng ca không tồn tại");
    }

    if (existing.status !== "PENDING") {
      throw new Error("Đơn tăng ca đã được xử lý");
    }

    // Validate monthly OT limits before approval
    const monthStart = new Date(
      existing.date.getFullYear(),
      existing.date.getMonth(),
      1,
    );
    const monthEnd = new Date(
      existing.date.getFullYear(),
      existing.date.getMonth() + 1,
      0,
    );
    const monthlyOT = await db.overtimeRequest.aggregate({
      where: {
        tenantId,
        employeeId: existing.employeeId,
        date: { gte: monthStart, lte: monthEnd },
        status: "APPROVED",
        id: { not: id },
      },
      _sum: { plannedHours: true },
    });
    const monthlyHours = Number(monthlyOT._sum.plannedHours || 0);
    const approvedHours = actualHours ?? Number(existing.plannedHours);

    if (monthlyHours + approvedHours > 40) {
      throw new Error(
        `Không thể duyệt: tổng OT tháng sẽ vượt 40h (hiện tại ${monthlyHours}h + ${approvedHours}h = ${monthlyHours + approvedHours}h)`,
      );
    }

    // Validate yearly OT limits (Article 107: max 200h/year)
    const yearStart = new Date(existing.date.getFullYear(), 0, 1);
    const yearEnd = new Date(existing.date.getFullYear(), 11, 31);
    const yearlyOT = await db.overtimeRequest.aggregate({
      where: {
        tenantId,
        employeeId: existing.employeeId,
        date: { gte: yearStart, lte: yearEnd },
        status: "APPROVED",
        id: { not: id },
      },
      _sum: { plannedHours: true },
    });
    const yearlyHours = Number(yearlyOT._sum.plannedHours || 0);

    if (yearlyHours + approvedHours > 200) {
      throw new Error(
        `Không thể duyệt: tổng OT năm sẽ vượt 200h (hiện tại ${yearlyHours}h + ${approvedHours}h = ${yearlyHours + approvedHours}h). Điều 107 BLLĐ`,
      );
    }

    return db.overtimeRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: approverId,
        approvedAt: new Date(),
        actualHours: actualHours ?? existing.plannedHours,
      },
      include: {
        employee: true,
        approver: true,
      },
    });
  },

  async reject(
    tenantId: string,
    id: string,
    approverId: string,
    reason: string,
  ) {
    const existing = await db.overtimeRequest.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error("Đơn tăng ca không tồn tại");
    }

    if (existing.status !== "PENDING") {
      throw new Error("Đơn tăng ca đã được xử lý");
    }

    return db.overtimeRequest.update({
      where: { id },
      data: {
        status: "REJECTED",
        approvedBy: approverId,
        approvedAt: new Date(),
        rejectionReason: reason,
      },
      include: {
        employee: true,
        approver: true,
      },
    });
  },

  async cancel(tenantId: string, id: string) {
    const existing = await db.overtimeRequest.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error("Đơn tăng ca không tồn tại");
    }

    if (existing.status === "APPROVED") {
      throw new Error("Không thể hủy đơn tăng ca đã được duyệt");
    }

    return db.overtimeRequest.update({
      where: { id },
      data: {
        status: "CANCELLED",
      },
    });
  },

  async bulkApprove(tenantId: string, ids: string[], approverId: string) {
    return db.overtimeRequest.updateMany({
      where: {
        id: { in: ids },
        tenantId,
        status: "PENDING",
      },
      data: {
        status: "APPROVED",
        approvedBy: approverId,
        approvedAt: new Date(),
      },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // STATISTICS
  // ═══════════════════════════════════════════════════════════════

  async getPendingCount(tenantId: string) {
    return db.overtimeRequest.count({
      where: { tenantId, status: "PENDING" },
    });
  },

  async getEmployeeOTStats(
    tenantId: string,
    employeeId: string,
    year: number,
    month: number,
  ) {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);

    const requests = await db.overtimeRequest.findMany({
      where: {
        tenantId,
        employeeId,
        date: { gte: monthStart, lte: monthEnd },
        status: "APPROVED",
      },
    });

    let totalHours = 0;
    let weekdayHours = 0;
    let weekendHours = 0;
    let holidayHours = 0;
    let nightHours = 0;

    for (const req of requests) {
      const hours = Number(req.actualHours || req.plannedHours);
      totalHours += hours;

      switch (req.dayType) {
        case "HOLIDAY":
          holidayHours += hours;
          break;
        case "WEEKEND":
          weekendHours += hours;
          break;
        default:
          weekdayHours += hours;
      }

      if (req.isNightShift) {
        nightHours += hours;
      }
    }

    return {
      totalHours: roundHours(totalHours),
      weekdayHours: roundHours(weekdayHours),
      weekendHours: roundHours(weekendHours),
      holidayHours: roundHours(holidayHours),
      nightHours: roundHours(nightHours),
      requestCount: requests.length,
    };
  },

  async getMyPendingRequests(tenantId: string, employeeId: string) {
    return db.overtimeRequest.findMany({
      where: {
        tenantId,
        employeeId,
        status: "PENDING",
      },
      orderBy: { date: "asc" },
    });
  },
};
