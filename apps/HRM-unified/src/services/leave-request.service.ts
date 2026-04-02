// src/services/leave-request.service.ts
// Leave Request Service

import { db } from "@/lib/db";
import type { RequestStatus, Prisma } from ".prisma/hrm-unified-client";
import type { PaginatedResponse } from "@/types";
import {
  calculateLeaveDays,
  validateLeaveRequest,
  generateRequestCode,
} from "@/lib/leave/calculator";
import { startWorkflow, cancelWorkflow } from "@/lib/workflow/engine";
import { leaveBalanceService } from "./leave-balance.service";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface LeaveRequestFilters {
  employeeId?: string;
  policyId?: string;
  status?: RequestStatus;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}

export interface CreateLeaveRequestInput {
  policyId: string;
  startDate: Date;
  endDate: Date;
  startHalf?: "AM" | "PM" | null;
  endHalf?: "AM" | "PM" | null;
  reason: string;
  handoverTo?: string;
  handoverNotes?: string;
}

// ═══════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════

export const leaveRequestService = {
  /**
   * Get all leave requests with pagination
   */
  async getAll(
    tenantId: string,
    filters: LeaveRequestFilters = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<PaginatedResponse<any>> {
    const {
      employeeId,
      policyId,
      status,
      startDate,
      endDate,
      page = 1,
      pageSize = 20,
    } = filters;
    const skip = (page - 1) * pageSize;

    const where: Prisma.LeaveRequestWhereInput = {
      tenantId,
      ...(employeeId && { employeeId }),
      ...(policyId && { policyId }),
      ...(status && { status }),
      ...(startDate && { startDate: { gte: startDate } }),
      ...(endDate && { endDate: { lte: endDate } }),
    };

    const [data, total] = await Promise.all([
      db.leaveRequest.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              department: { select: { name: true } },
            },
          },
          policy: {
            select: { id: true, name: true, code: true, leaveType: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.leaveRequest.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  /**
   * Get requests for an employee
   */
  async getByEmployee(tenantId: string, employeeId: string, year?: number) {
    const currentYear = year || new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31);

    return db.leaveRequest.findMany({
      where: {
        tenantId,
        employeeId,
        startDate: { gte: startOfYear },
        endDate: { lte: endOfYear },
      },
      include: {
        policy: {
          select: { id: true, name: true, code: true, leaveType: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Get a single request by ID
   */
  async getById(tenantId: string, id: string) {
    return db.leaveRequest.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: { select: { name: true } },
            position: { select: { name: true } },
          },
        },
        policy: true,
        workflowInstance: {
          include: {
            definition: true,
            approvalSteps: {
              include: {
                step: true,
                approver: { select: { id: true, name: true, email: true } },
                delegatedFrom: { select: { id: true, name: true } },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });
  },

  /**
   * Create a new leave request (draft)
   */
  async create(
    tenantId: string,
    employeeId: string,
    data: CreateLeaveRequestInput,
  ) {
    // Get policy
    const policy = await db.leavePolicy.findUnique({
      where: { id: data.policyId },
    });
    if (!policy || !policy.isActive) {
      throw new Error("Loại nghỉ không tồn tại hoặc đã bị vô hiệu hóa");
    }

    // Get holidays for calculation
    const holidays = await db.holiday.findMany({
      where: {
        tenantId,
        date: {
          gte: data.startDate,
          lte: data.endDate,
        },
      },
    });

    // Calculate days
    const totalDays = calculateLeaveDays({
      startDate: data.startDate,
      endDate: data.endDate,
      startHalf: data.startHalf,
      endHalf: data.endHalf,
      holidays: holidays.map((h) => h.date),
    });

    if (totalDays <= 0) {
      throw new Error("Số ngày nghỉ phải lớn hơn 0");
    }

    // Get balance
    const year = data.startDate.getFullYear();
    const balance = await leaveBalanceService.getByPolicy(
      tenantId,
      employeeId,
      data.policyId,
      year,
    );

    if (!balance) {
      // Initialize balance if not exists
      await leaveBalanceService.initializeForEmployee(
        tenantId,
        employeeId,
        year,
      );
    }

    const currentBalance = balance
      ? Number(balance.available)
      : Number(policy.daysPerYear);

    // Validate
    const validation = validateLeaveRequest({
      balance: currentBalance,
      requestDays: totalDays,
      minDays: Number(policy.minDaysPerRequest),
      maxDays: policy.maxDaysPerRequest
        ? Number(policy.maxDaysPerRequest)
        : null,
      allowNegative: policy.allowNegativeBalance,
      advanceNoticeDays: policy.advanceNoticeDays,
      startDate: data.startDate,
    });

    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Create request
    return db.leaveRequest.create({
      data: {
        tenantId,
        employeeId,
        policyId: data.policyId,
        requestCode: generateRequestCode("LR"),
        startDate: data.startDate,
        endDate: data.endDate,
        totalDays,
        startHalf: data.startHalf,
        endHalf: data.endHalf,
        reason: data.reason,
        handoverTo: data.handoverTo,
        handoverNotes: data.handoverNotes,
        status: "DRAFT",
      },
      include: {
        policy: true,
      },
    });
  },

  /**
   * Update a draft request
   */
  async update(
    tenantId: string,
    id: string,
    data: Partial<CreateLeaveRequestInput>,
  ) {
    const request = await this.getById(tenantId, id);
    if (!request) {
      throw new Error("Yêu cầu không tồn tại");
    }
    if (request.status !== "DRAFT") {
      throw new Error("Chỉ có thể sửa yêu cầu nháp");
    }

    const startDate = data.startDate || request.startDate;
    const endDate = data.endDate || request.endDate;

    // Recalculate if dates changed
    let totalDays = Number(request.totalDays);
    if (
      data.startDate ||
      data.endDate ||
      data.startHalf !== undefined ||
      data.endHalf !== undefined
    ) {
      const holidays = await db.holiday.findMany({
        where: {
          tenantId,
          date: { gte: startDate, lte: endDate },
        },
      });

      totalDays = calculateLeaveDays({
        startDate,
        endDate,
        startHalf: data.startHalf ?? (request.startHalf as "AM" | "PM" | null),
        endHalf: data.endHalf ?? (request.endHalf as "AM" | "PM" | null),
        holidays: holidays.map((h) => h.date),
      });
    }

    return db.leaveRequest.update({
      where: { id },
      data: {
        ...(data.startDate && { startDate: data.startDate }),
        ...(data.endDate && { endDate: data.endDate }),
        ...(data.startHalf !== undefined && { startHalf: data.startHalf }),
        ...(data.endHalf !== undefined && { endHalf: data.endHalf }),
        ...(data.reason && { reason: data.reason }),
        ...(data.handoverTo !== undefined && { handoverTo: data.handoverTo }),
        ...(data.handoverNotes !== undefined && {
          handoverNotes: data.handoverNotes,
        }),
        totalDays,
      },
    });
  },

  /**
   * Submit a draft request for approval
   */
  async submit(tenantId: string, id: string, userId: string) {
    const request = await this.getById(tenantId, id);
    if (!request) {
      throw new Error("Yêu cầu không tồn tại");
    }
    if (request.status !== "DRAFT") {
      throw new Error("Chỉ có thể gửi yêu cầu nháp");
    }

    // Add to pending balance
    const year = new Date(request.startDate).getFullYear();
    await leaveBalanceService.addPending(
      tenantId,
      request.employeeId,
      request.policyId,
      year,
      Number(request.totalDays),
    );

    // Start workflow
    const workflow = await startWorkflow({
      tenantId,
      workflowCode: "LEAVE_APPROVAL",
      referenceType: "LEAVE_REQUEST",
      referenceId: request.id,
      requesterId: userId,
      context: {
        totalDays: Number(request.totalDays),
        leaveType: request.policy.leaveType,
      },
    });

    // Update request
    return db.leaveRequest.update({
      where: { id },
      data: {
        status: "PENDING",
        workflowInstanceId: workflow.id,
      },
    });
  },

  /**
   * Cancel a request
   */
  async cancel(tenantId: string, id: string, userId: string, reason: string) {
    const request = await this.getById(tenantId, id);
    if (!request) {
      throw new Error("Yêu cầu không tồn tại");
    }
    if (!["DRAFT", "PENDING"].includes(request.status)) {
      throw new Error("Không thể hủy yêu cầu này");
    }

    // Return pending days if was submitted
    if (request.status === "PENDING") {
      const year = new Date(request.startDate).getFullYear();
      await leaveBalanceService.removePending(
        tenantId,
        request.employeeId,
        request.policyId,
        year,
        Number(request.totalDays),
      );

      // Cancel workflow
      if (request.workflowInstanceId) {
        await cancelWorkflow(request.workflowInstanceId);
      }
    }

    return db.leaveRequest.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancelReason: reason,
      },
    });
  },

  /**
   * Delete a draft request
   */
  async delete(tenantId: string, id: string) {
    const request = await this.getById(tenantId, id);
    if (!request) {
      throw new Error("Yêu cầu không tồn tại");
    }
    if (request.status !== "DRAFT") {
      throw new Error("Chỉ có thể xóa yêu cầu nháp");
    }

    return db.leaveRequest.delete({
      where: { id },
    });
  },

  /**
   * Get leave calendar for a period
   */
  async getCalendar(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    departmentId?: string,
  ) {
    const where: Prisma.LeaveRequestWhereInput = {
      tenantId,
      status: { in: ["PENDING", "APPROVED"] },
      OR: [
        { startDate: { gte: startDate, lte: endDate } },
        { endDate: { gte: startDate, lte: endDate } },
        {
          AND: [
            { startDate: { lte: startDate } },
            { endDate: { gte: endDate } },
          ],
        },
      ],
      ...(departmentId && { employee: { departmentId } }),
    };

    return db.leaveRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: { select: { name: true } },
          },
        },
        policy: {
          select: { name: true, leaveType: true },
        },
      },
      orderBy: { startDate: "asc" },
    });
  },
};
