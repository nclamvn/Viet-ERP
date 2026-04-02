// src/services/leave-balance.service.ts
// Leave Balance Service

import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-ai-client";
import { calculateAvailableBalance } from "@/lib/leave/calculator";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface LeaveBalanceWithPolicy {
  id: string;
  year: number;
  entitlement: number;
  carryOver: number;
  adjustment: number;
  used: number;
  pending: number;
  available: number;
  policy: {
    id: string;
    name: string;
    code: string;
    leaveType: string;
    allowNegativeBalance: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════

export const leaveBalanceService = {
  /**
   * Get all balances for an employee
   */
  async getByEmployee(
    tenantId: string,
    employeeId: string,
    year?: number,
  ): Promise<LeaveBalanceWithPolicy[]> {
    const currentYear = year || new Date().getFullYear();

    const balances = await db.leaveBalance.findMany({
      where: {
        tenantId,
        employeeId,
        year: currentYear,
      },
      include: {
        policy: {
          select: {
            id: true,
            name: true,
            code: true,
            leaveType: true,
            allowNegativeBalance: true,
          },
        },
      },
      orderBy: {
        policy: { leaveType: "asc" },
      },
    });

    return balances.map((b) => ({
      id: b.id,
      year: b.year,
      entitlement: Number(b.entitlement),
      carryOver: Number(b.carryOver),
      adjustment: Number(b.adjustment),
      used: Number(b.used),
      pending: Number(b.pending),
      available: Number(b.available),
      policy: b.policy,
    }));
  },

  /**
   * Get balance for specific policy
   */
  async getByPolicy(
    tenantId: string,
    employeeId: string,
    policyId: string,
    year?: number,
  ) {
    const currentYear = year || new Date().getFullYear();

    return db.leaveBalance.findUnique({
      where: {
        tenantId_employeeId_policyId_year: {
          tenantId,
          employeeId,
          policyId,
          year: currentYear,
        },
      },
      include: {
        policy: true,
      },
    });
  },

  /**
   * Initialize balance for employee
   */
  async initializeForEmployee(
    tenantId: string,
    employeeId: string,
    year?: number,
  ) {
    const currentYear = year || new Date().getFullYear();

    // Get all active policies
    const policies = await db.leavePolicy.findMany({
      where: { tenantId, isActive: true },
    });

    const balances = [];
    for (const policy of policies) {
      // Check if balance already exists
      const existing = await db.leaveBalance.findUnique({
        where: {
          tenantId_employeeId_policyId_year: {
            tenantId,
            employeeId,
            policyId: policy.id,
            year: currentYear,
          },
        },
      });

      if (!existing) {
        const balance = await db.leaveBalance.create({
          data: {
            tenantId,
            employeeId,
            policyId: policy.id,
            year: currentYear,
            entitlement: Number(policy.daysPerYear),
            carryOver: 0,
            adjustment: 0,
            used: 0,
            pending: 0,
            available: Number(policy.daysPerYear),
          },
        });
        balances.push(balance);
      } else {
        balances.push(existing);
      }
    }

    return balances;
  },

  /**
   * Initialize balances for all employees
   */
  async initializeForAllEmployees(tenantId: string, year?: number) {
    const currentYear = year || new Date().getFullYear();

    const employees = await db.employee.findMany({
      where: { tenantId, status: { in: ["ACTIVE", "PROBATION"] } },
      select: { id: true },
    });

    for (const emp of employees) {
      await this.initializeForEmployee(tenantId, emp.id, currentYear);
    }

    return employees.length;
  },

  /**
   * Adjust balance
   */
  async adjust(
    tenantId: string,
    employeeId: string,
    policyId: string,
    year: number,
    adjustmentDays: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _reason?: string,
  ) {
    const balance = await this.getByPolicy(
      tenantId,
      employeeId,
      policyId,
      year,
    );
    if (!balance) {
      throw new Error("Không tìm thấy số dư phép");
    }

    const newAdjustment = Number(balance.adjustment) + adjustmentDays;
    const newAvailable = calculateAvailableBalance(
      Number(balance.entitlement),
      Number(balance.carryOver),
      newAdjustment,
      Number(balance.used),
      Number(balance.pending),
    );

    return db.leaveBalance.update({
      where: { id: balance.id },
      data: {
        adjustment: newAdjustment,
        available: newAvailable,
      },
    });
  },

  /**
   * Add pending days (when request is submitted)
   */
  async addPending(
    tenantId: string,
    employeeId: string,
    policyId: string,
    year: number,
    days: number,
  ) {
    const balance = await this.getByPolicy(
      tenantId,
      employeeId,
      policyId,
      year,
    );
    if (!balance) {
      throw new Error("Không tìm thấy số dư phép");
    }

    const newPending = Number(balance.pending) + days;
    const newAvailable = calculateAvailableBalance(
      Number(balance.entitlement),
      Number(balance.carryOver),
      Number(balance.adjustment),
      Number(balance.used),
      newPending,
    );

    return db.leaveBalance.update({
      where: { id: balance.id },
      data: {
        pending: newPending,
        available: newAvailable,
      },
    });
  },

  /**
   * Remove pending days (when request is cancelled/rejected)
   */
  async removePending(
    tenantId: string,
    employeeId: string,
    policyId: string,
    year: number,
    days: number,
  ) {
    const balance = await this.getByPolicy(
      tenantId,
      employeeId,
      policyId,
      year,
    );
    if (!balance) {
      throw new Error("Không tìm thấy số dư phép");
    }

    const newPending = Math.max(0, Number(balance.pending) - days);
    const newAvailable = calculateAvailableBalance(
      Number(balance.entitlement),
      Number(balance.carryOver),
      Number(balance.adjustment),
      Number(balance.used),
      newPending,
    );

    return db.leaveBalance.update({
      where: { id: balance.id },
      data: {
        pending: newPending,
        available: newAvailable,
      },
    });
  },

  /**
   * Process carry over for new year
   */
  async processCarryOver(tenantId: string, fromYear: number, toYear: number) {
    const policies = await db.leavePolicy.findMany({
      where: { tenantId, isActive: true },
    });

    const employees = await db.employee.findMany({
      where: { tenantId, status: { in: ["ACTIVE", "PROBATION"] } },
      select: { id: true },
    });

    for (const emp of employees) {
      for (const policy of policies) {
        const oldBalance = await this.getByPolicy(
          tenantId,
          emp.id,
          policy.id,
          fromYear,
        );
        if (!oldBalance) continue;

        const carryOverDays = Math.min(
          Number(oldBalance.available),
          Number(policy.maxCarryOver),
        );

        // Create or update new year balance
        await db.leaveBalance.upsert({
          where: {
            tenantId_employeeId_policyId_year: {
              tenantId,
              employeeId: emp.id,
              policyId: policy.id,
              year: toYear,
            },
          },
          create: {
            tenantId,
            employeeId: emp.id,
            policyId: policy.id,
            year: toYear,
            entitlement: Number(policy.daysPerYear),
            carryOver: carryOverDays,
            adjustment: 0,
            used: 0,
            pending: 0,
            available: Number(policy.daysPerYear) + carryOverDays,
          },
          update: {
            carryOver: carryOverDays,
            available: {
              increment: carryOverDays,
            },
          },
        });
      }
    }
  },

  /**
   * Get all balances for a tenant (admin view)
   */
  async getAllBalances(
    tenantId: string,
    year: number,
    filters: {
      departmentId?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const { departmentId, search, page = 1, pageSize = 50 } = filters;
    const skip = (page - 1) * pageSize;

    const where: Prisma.LeaveBalanceWhereInput = {
      tenantId,
      year,
      ...(departmentId && { employee: { departmentId } }),
      ...(search && {
        employee: {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { employeeCode: { contains: search, mode: "insensitive" } },
          ],
        },
      }),
    };

    const [data, total] = await Promise.all([
      db.leaveBalance.findMany({
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
        orderBy: [
          { employee: { fullName: "asc" } },
          { policy: { leaveType: "asc" } },
        ],
        skip,
        take: pageSize,
      }),
      db.leaveBalance.count({ where }),
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
};
