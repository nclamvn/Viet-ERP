// src/services/shift.service.ts
// Shift management service

import { db } from "@/lib/db";
import type {
  ShiftFilters,
  PaginatedResponse,
  ShiftWithRelations,
  ShiftAssignmentFilters,
  ShiftAssignmentWithRelations,
} from "@/types";
import type { Prisma } from ".prisma/hrm-ai-client";

export const shiftService = {
  // ═══════════════════════════════════════════════════════════════
  // SHIFT CRUD
  // ═══════════════════════════════════════════════════════════════

  async findAll(
    tenantId: string,
    filters: ShiftFilters = {},
  ): Promise<PaginatedResponse<ShiftWithRelations>> {
    const { search, shiftType, isActive, page = 1, pageSize = 20 } = filters;

    const where: Prisma.ShiftWhereInput = {
      tenantId,
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
        ],
      }),
      ...(shiftType && { shiftType }),
      ...(isActive !== undefined && { isActive }),
    };

    const [data, total] = await Promise.all([
      db.shift.findMany({
        where,
        include: {
          _count: {
            select: {
              assignments: true,
              attendances: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.shift.count({ where }),
    ]);

    return {
      data: data as unknown as ShiftWithRelations[],
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
  ): Promise<ShiftWithRelations | null> {
    return db.shift.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: {
            assignments: true,
            attendances: true,
          },
        },
      },
    }) as unknown as Promise<ShiftWithRelations | null>;
  },

  async findByCode(tenantId: string, code: string) {
    return db.shift.findFirst({
      where: { tenantId, code },
    });
  },

  async create(
    tenantId: string,
    data: Omit<Prisma.ShiftCreateInput, "tenant">,
  ) {
    return db.shift.create({
      data: {
        ...data,
        tenant: { connect: { id: tenantId } },
      },
    });
  },

  async update(
    tenantId: string,
    id: string,
    data: Omit<Prisma.ShiftUpdateInput, "tenant">,
  ) {
    const shift = await db.shift.findFirst({
      where: { id, tenantId },
    });

    if (!shift) {
      throw new Error("Ca làm việc không tồn tại");
    }

    return db.shift.update({
      where: { id },
      data,
    });
  },

  async delete(tenantId: string, id: string) {
    const shift = await db.shift.findFirst({
      where: { id, tenantId },
      include: {
        _count: {
          select: {
            assignments: true,
            attendances: true,
          },
        },
      },
    });

    if (!shift) {
      throw new Error("Ca làm việc không tồn tại");
    }

    if (shift._count.assignments > 0) {
      throw new Error("Không thể xóa ca làm việc đang được gán cho nhân viên");
    }

    if (shift._count.attendances > 0) {
      throw new Error("Không thể xóa ca làm việc đã có dữ liệu chấm công");
    }

    return db.shift.delete({
      where: { id },
    });
  },

  async getActiveShifts(tenantId: string) {
    return db.shift.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: "asc" },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // SHIFT ASSIGNMENT
  // ═══════════════════════════════════════════════════════════════

  async findAssignments(
    tenantId: string,
    filters: ShiftAssignmentFilters = {},
  ): Promise<PaginatedResponse<ShiftAssignmentWithRelations>> {
    const {
      employeeId,
      shiftId,
      departmentId,
      startDate,
      endDate,
      isPrimary,
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.ShiftAssignmentWhereInput = {
      tenantId,
      ...(employeeId && { employeeId }),
      ...(shiftId && { shiftId }),
      ...(departmentId && {
        employee: { departmentId },
      }),
      ...(startDate && {
        startDate: { lte: new Date(startDate) },
        OR: [{ endDate: null }, { endDate: { gte: new Date(startDate) } }],
      }),
      ...(endDate && {
        startDate: { lte: new Date(endDate) },
      }),
      ...(isPrimary !== undefined && { isPrimary }),
    };

    const [data, total] = await Promise.all([
      db.shiftAssignment.findMany({
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
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.shiftAssignment.count({ where }),
    ]);

    return {
      data: data as unknown as ShiftAssignmentWithRelations[],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  async assignShift(
    tenantId: string,
    data: {
      employeeId: string;
      shiftId: string;
      startDate: Date;
      endDate?: Date | null;
      daysOfWeek?: number[];
      isPrimary?: boolean;
      notes?: string;
    },
  ) {
    // If this is primary, remove primary flag from other assignments
    if (data.isPrimary) {
      await db.shiftAssignment.updateMany({
        where: {
          tenantId,
          employeeId: data.employeeId,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    return db.shiftAssignment.create({
      data: {
        tenantId,
        employeeId: data.employeeId,
        shiftId: data.shiftId,
        startDate: data.startDate,
        endDate: data.endDate,
        daysOfWeek: data.daysOfWeek || [1, 2, 3, 4, 5],
        isPrimary: data.isPrimary ?? true,
        notes: data.notes,
      },
      include: {
        employee: true,
        shift: true,
      },
    });
  },

  async updateAssignment(
    tenantId: string,
    id: string,
    data: Prisma.ShiftAssignmentUpdateInput,
  ) {
    const assignment = await db.shiftAssignment.findFirst({
      where: { id, tenantId },
    });

    if (!assignment) {
      throw new Error("Phân ca không tồn tại");
    }

    return db.shiftAssignment.update({
      where: { id },
      data,
      include: {
        employee: true,
        shift: true,
      },
    });
  },

  async deleteAssignment(tenantId: string, id: string) {
    const assignment = await db.shiftAssignment.findFirst({
      where: { id, tenantId },
    });

    if (!assignment) {
      throw new Error("Phân ca không tồn tại");
    }

    return db.shiftAssignment.delete({
      where: { id },
    });
  },

  async getEmployeeShift(employeeId: string, date: Date) {
    const dayOfWeek = date.getDay();

    const assignment = await db.shiftAssignment.findFirst({
      where: {
        employeeId,
        isPrimary: true,
        startDate: { lte: date },
        OR: [{ endDate: null }, { endDate: { gte: date } }],
        daysOfWeek: { has: dayOfWeek },
      },
      include: { shift: true },
    });

    return assignment?.shift || null;
  },

  async bulkAssignShift(
    tenantId: string,
    employeeIds: string[],
    shiftId: string,
    startDate: Date,
    endDate?: Date | null,
  ) {
    const assignments = employeeIds.map((employeeId) => ({
      tenantId,
      employeeId,
      shiftId,
      startDate,
      endDate,
      daysOfWeek: [1, 2, 3, 4, 5],
      isPrimary: true,
    }));

    // Remove existing primary assignments
    await db.shiftAssignment.updateMany({
      where: {
        tenantId,
        employeeId: { in: employeeIds },
        isPrimary: true,
      },
      data: { isPrimary: false },
    });

    return db.shiftAssignment.createMany({
      data: assignments,
    });
  },
};
