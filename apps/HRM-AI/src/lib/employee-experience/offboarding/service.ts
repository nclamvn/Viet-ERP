// src/lib/employee-experience/offboarding/service.ts
// Offboarding Service - Employee separation workflow

import { db } from "@/lib/db";
import {
  SeparationType,
  OffboardingStatus,
  OffboardingCategory,
  OnboardingTaskStatus,
  Prisma,
} from ".prisma/hrm-ai-client";

// Types
export interface StartOffboardingInput {
  employeeId: string;
  separationType: SeparationType;
  noticeDate: Date;
  lastWorkingDay: Date;
  reason?: string;
  createdBy: string;
  isVoluntary?: boolean;
}

export interface OffboardingTaskInput {
  title: string;
  description?: string;
  category: OffboardingCategory;
  assigneeId?: string;
  dueDate?: Date;
  daysBeforeExit?: number;
  sortOrder?: number;
}

export interface UpdateTaskInput {
  status?: OnboardingTaskStatus;
  completedBy?: string;
  notes?: string;
}

// Default offboarding tasks by category
export const DEFAULT_OFFBOARDING_TASKS: OffboardingTaskInput[] = [
  // IT Department Tasks
  {
    title: "Revoke system access",
    description: "Disable all system accounts (email, VPN, internal apps)",
    category: OffboardingCategory.IT,
    daysBeforeExit: 0,
    sortOrder: 1,
  },
  {
    title: "Collect laptop and equipment",
    description: "Retrieve company laptop, monitors, keyboard, mouse",
    category: OffboardingCategory.ASSETS,
    daysBeforeExit: 0,
    sortOrder: 2,
  },
  {
    title: "Transfer email and files",
    description: "Backup and transfer important emails and files to manager",
    category: OffboardingCategory.IT,
    daysBeforeExit: 3,
    sortOrder: 3,
  },

  // HR Department Tasks
  {
    title: "Process final payroll",
    description: "Calculate final salary, unused leave payout, bonuses",
    category: OffboardingCategory.HR,
    daysBeforeExit: 5,
    sortOrder: 4,
  },
  {
    title: "Prepare employment certificate",
    description: "Generate and sign employment verification letter",
    category: OffboardingCategory.DOCUMENTATION,
    daysBeforeExit: 3,
    sortOrder: 5,
  },
  {
    title: "Update employee records",
    description: "Mark employee as inactive in HR system",
    category: OffboardingCategory.HR,
    daysBeforeExit: 0,
    sortOrder: 6,
  },
  {
    title: "Process benefits termination",
    description: "Terminate health insurance and other benefits",
    category: OffboardingCategory.BENEFITS,
    daysBeforeExit: 0,
    sortOrder: 7,
  },

  // Finance Tasks
  {
    title: "Settle expense claims",
    description: "Process all pending expense reimbursements",
    category: OffboardingCategory.FINANCE,
    daysBeforeExit: 7,
    sortOrder: 8,
  },

  // Assets Tasks
  {
    title: "Collect access cards and keys",
    description: "Retrieve building access card, office keys, parking card",
    category: OffboardingCategory.ASSETS,
    daysBeforeExit: 0,
    sortOrder: 9,
  },

  // Knowledge Transfer Tasks
  {
    title: "Knowledge transfer documentation",
    description: "Document ongoing projects and processes",
    category: OffboardingCategory.KNOWLEDGE,
    daysBeforeExit: 7,
    sortOrder: 10,
  },
];

// Offboarding Service
export class OffboardingService {
  constructor(private tenantId: string) {}

  /**
   * Start offboarding process for an employee
   */
  async startOffboarding(input: StartOffboardingInput) {
    const {
      employeeId,
      separationType,
      noticeDate,
      lastWorkingDay,
      reason,
      createdBy,
      isVoluntary = true,
    } = input;

    // Check if employee exists
    const employee = await db.employee.findFirst({
      where: {
        id: employeeId,
        tenantId: this.tenantId,
      },
      include: {
        department: true,
      },
    });

    if (!employee) {
      throw new Error("Employee not found");
    }

    // Check for existing active offboarding
    const existingOffboarding = await db.offboardingInstance.findFirst({
      where: {
        employeeId,
        status: {
          notIn: [OffboardingStatus.COMPLETED, OffboardingStatus.CANCELLED],
        },
      },
    });

    if (existingOffboarding) {
      throw new Error("Employee already has an active offboarding process");
    }

    // Create offboarding instance
    const offboarding = await db.offboardingInstance.create({
      data: {
        tenantId: this.tenantId,
        employeeId,
        separationType,
        noticeDate,
        lastWorkingDay,
        reason,
        createdBy,
        isVoluntary,
        status: OffboardingStatus.INITIATED,
      },
    });

    // Create default tasks
    const tasksToCreate = DEFAULT_OFFBOARDING_TASKS.map((task, index) => {
      // Calculate due date based on daysBeforeExit
      let dueDate: Date | null = null;
      if (task.daysBeforeExit !== undefined) {
        dueDate = new Date(lastWorkingDay);
        dueDate.setDate(dueDate.getDate() - task.daysBeforeExit);
      }

      return {
        instanceId: offboarding.id,
        title: task.title,
        description: task.description,
        category: task.category,
        assigneeId: task.assigneeId || null,
        dueDate,
        sortOrder: task.sortOrder || index,
        status: OnboardingTaskStatus.PENDING,
      };
    });

    await db.offboardingTask.createMany({
      data: tasksToCreate,
    });

    // Update status to IN_PROGRESS
    await db.offboardingInstance.update({
      where: { id: offboarding.id },
      data: { status: OffboardingStatus.IN_PROGRESS },
    });

    return this.getOffboarding(offboarding.id);
  }

  /**
   * Get offboarding instance with tasks
   */
  async getOffboarding(offboardingId: string) {
    const offboarding = await db.offboardingInstance.findFirst({
      where: {
        id: offboardingId,
        tenantId: this.tenantId,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            workEmail: true,
            avatar: true,
            department: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        tasks: {
          orderBy: [{ sortOrder: "asc" }, { dueDate: "asc" }],
          include: {
            assignee: {
              select: {
                id: true,
                fullName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!offboarding) {
      throw new Error("Offboarding not found");
    }

    // Calculate progress
    const totalTasks = offboarding.tasks.length;
    const completedTasks = offboarding.tasks.filter(
      (t) => t.status === OnboardingTaskStatus.COMPLETED,
    ).length;
    const progress =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Group tasks by category
    const tasksByCategory = offboarding.tasks.reduce(
      (acc: Record<string, typeof offboarding.tasks>, task) => {
        if (!acc[task.category]) {
          acc[task.category] = [];
        }
        acc[task.category].push(task);
        return acc;
      },
      {},
    );

    return {
      ...offboarding,
      progress,
      totalTasks,
      completedTasks,
      tasksByCategory,
    };
  }

  /**
   * Update task status
   */
  async updateTask(taskId: string, updates: UpdateTaskInput) {
    const task = await db.offboardingTask.findFirst({
      where: { id: taskId },
      include: {
        instance: {
          select: { tenantId: true, id: true },
        },
      },
    });

    if (!task || task.instance.tenantId !== this.tenantId) {
      throw new Error("Task not found");
    }

    const updateData: Prisma.OffboardingTaskUpdateInput = {};

    if (updates.status) {
      updateData.status = updates.status;
      if (updates.status === OnboardingTaskStatus.COMPLETED) {
        updateData.completedAt = new Date();
        if (updates.completedBy) {
          updateData.completedBy = updates.completedBy;
        }
      }
    }

    if (updates.notes !== undefined) {
      updateData.notes = updates.notes;
    }

    const updatedTask = await db.offboardingTask.update({
      where: { id: taskId },
      data: updateData,
      include: {
        assignee: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });

    // Check if all tasks are completed
    await this.checkOffboardingCompletion(task.instance.id);

    return updatedTask;
  }

  /**
   * Check and update offboarding completion
   */
  private async checkOffboardingCompletion(instanceId: string) {
    const instance = await db.offboardingInstance.findUnique({
      where: { id: instanceId },
      include: {
        tasks: true,
      },
    });

    if (!instance) return;

    const allCompleted = instance.tasks.every(
      (t) => t.status === OnboardingTaskStatus.COMPLETED,
    );

    if (allCompleted && instance.status !== OffboardingStatus.COMPLETED) {
      await db.offboardingInstance.update({
        where: { id: instanceId },
        data: {
          status: OffboardingStatus.COMPLETED,
        },
      });

      // Update employee status
      await db.employee.update({
        where: { id: instance.employeeId },
        data: {
          status: "RESIGNED",
          resignationDate: instance.lastWorkingDay,
        },
      });
    }
  }

  /**
   * Add custom task to offboarding
   */
  async addTask(instanceId: string, task: OffboardingTaskInput) {
    const instance = await db.offboardingInstance.findFirst({
      where: {
        id: instanceId,
        tenantId: this.tenantId,
        status: {
          notIn: [OffboardingStatus.COMPLETED, OffboardingStatus.CANCELLED],
        },
      },
    });

    if (!instance) {
      throw new Error("Offboarding not found or already completed");
    }

    // Calculate due date if daysBeforeExit provided
    let dueDate = task.dueDate;
    if (!dueDate && task.daysBeforeExit !== undefined) {
      dueDate = new Date(instance.lastWorkingDay);
      dueDate.setDate(dueDate.getDate() - task.daysBeforeExit);
    }

    return db.offboardingTask.create({
      data: {
        instanceId,
        title: task.title,
        description: task.description,
        category: task.category,
        assigneeId: task.assigneeId,
        dueDate,
        sortOrder: task.sortOrder || 0,
        status: OnboardingTaskStatus.PENDING,
      },
      include: {
        assignee: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });
  }

  /**
   * Get all offboardings for a tenant
   */
  async getAllOffboardings(filters?: {
    status?: OffboardingStatus[];
    departmentId?: string;
    fromDate?: Date;
    toDate?: Date;
  }) {
    const where: Prisma.OffboardingInstanceWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters?.status?.length) {
      where.status = { in: filters.status };
    }

    if (filters?.departmentId) {
      where.employee = { departmentId: filters.departmentId };
    }

    if (filters?.fromDate) {
      where.lastWorkingDay = { gte: filters.fromDate };
    }

    if (filters?.toDate) {
      where.lastWorkingDay = {
        ...(where.lastWorkingDay as any),
        lte: filters.toDate,
      };
    }

    const offboardings = await db.offboardingInstance.findMany({
      where,
      orderBy: { lastWorkingDay: "asc" },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
            department: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        _count: {
          select: { tasks: true },
        },
        tasks: {
          where: { status: OnboardingTaskStatus.COMPLETED },
          select: { id: true },
        },
      },
    });

    return offboardings.map((o) => ({
      ...o,
      progress:
        o._count.tasks > 0
          ? Math.round((o.tasks.length / o._count.tasks) * 100)
          : 0,
      completedTasks: o.tasks.length,
      totalTasks: o._count.tasks,
      tasks: undefined,
    }));
  }

  /**
   * Get tasks assigned to an employee
   */
  async getAssignedTasks(assigneeId: string) {
    return db.offboardingTask.findMany({
      where: {
        assigneeId,
        status: { not: OnboardingTaskStatus.COMPLETED },
        instance: {
          tenantId: this.tenantId,
          status: {
            notIn: [OffboardingStatus.COMPLETED, OffboardingStatus.CANCELLED],
          },
        },
      },
      orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }],
      include: {
        instance: {
          include: {
            employee: {
              select: {
                id: true,
                fullName: true,
                avatar: true,
                department: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Cancel offboarding process
   */
  async cancelOffboarding(instanceId: string, reason?: string) {
    const instance = await db.offboardingInstance.findFirst({
      where: {
        id: instanceId,
        tenantId: this.tenantId,
        status: {
          notIn: [OffboardingStatus.COMPLETED, OffboardingStatus.CANCELLED],
        },
      },
    });

    if (!instance) {
      throw new Error("Offboarding not found or already completed/cancelled");
    }

    return db.offboardingInstance.update({
      where: { id: instanceId },
      data: {
        status: OffboardingStatus.CANCELLED,
        reason: reason ? `Cancelled: ${reason}` : instance.reason,
      },
    });
  }

  /**
   * Get offboarding analytics
   */
  async getAnalytics(dateRange?: { from: Date; to: Date }) {
    const where: Prisma.OffboardingInstanceWhereInput = {
      tenantId: this.tenantId,
    };

    if (dateRange) {
      where.lastWorkingDay = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    const [totalOffboardings, bySeparationType, byDepartment] =
      await Promise.all([
        db.offboardingInstance.count({ where }),

        db.offboardingInstance.groupBy({
          by: ["separationType"],
          where,
          _count: true,
        }),

        db.offboardingInstance.findMany({
          where,
          include: {
            employee: {
              select: {
                department: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        }),
      ]);

    // Process by department
    const departmentCounts = byDepartment.reduce(
      (acc: Record<string, number>, o) => {
        const deptName = o.employee.department?.name || "Unknown";
        acc[deptName] = (acc[deptName] || 0) + 1;
        return acc;
      },
      {},
    );

    return {
      total: totalOffboardings,
      bySeparationType: bySeparationType.map((s) => ({
        type: s.separationType,
        count: s._count,
      })),
      byDepartment: Object.entries(departmentCounts).map(([name, count]) => ({
        department: name,
        count,
      })),
    };
  }
}

// Factory function
export function createOffboardingService(tenantId: string): OffboardingService {
  return new OffboardingService(tenantId);
}
