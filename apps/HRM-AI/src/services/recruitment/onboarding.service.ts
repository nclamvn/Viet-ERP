import { db } from "@/lib/db";
import type { OnboardingStatus } from ".prisma/hrm-ai-client";
import { addDays } from "date-fns";

export async function createOnboarding(
  tenantId: string,
  data: {
    employeeId: string;
    templateId?: string;
    startDate: Date;
    buddyId?: string;
    hrContactId?: string;
  },
) {
  const expectedEndDate = addDays(data.startDate, 30);

  const onboarding = await db.onboarding.create({
    data: {
      tenantId,
      employeeId: data.employeeId,
      templateId: data.templateId,
      startDate: data.startDate,
      expectedEndDate,
      buddyId: data.buddyId,
      hrContactId: data.hrContactId,
      status: "NOT_STARTED",
      progress: 0,
    },
  });

  if (data.templateId) {
    const template = await db.onboardingTemplate.findUnique({
      where: { id: data.templateId },
      include: { tasks: { orderBy: { order: "asc" } } },
    });

    if (template) {
      for (const task of template.tasks) {
        const dueDate = addDays(data.startDate, task.daysOffset);

        await db.onboardingTask.create({
          data: {
            onboardingId: onboarding.id,
            title: task.title,
            description: task.description,
            category: task.category,
            dueDate,
            assigneeType: task.assigneeType,
            isRequired: task.isRequired,
            order: task.order,
            status: "PENDING",
          },
        });
      }
    }
  }

  return db.onboarding.findUnique({
    where: { id: onboarding.id },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          position: { select: { name: true } },
        },
      },
      tasks: { orderBy: { order: "asc" } },
    },
  });
}

export async function getOnboardings(
  tenantId: string,
  filters?: {
    status?: string;
    hrContactId?: string;
  },
  page = 1,
  limit = 20,
) {
  const where: Record<string, unknown> = { tenantId };

  if (filters?.status) where.status = filters.status;
  if (filters?.hrContactId) where.hrContactId = filters.hrContactId;

  const [onboardings, total] = await Promise.all([
    db.onboarding.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeCode: true,
            position: { select: { name: true } },
          },
        },
        buddy: { select: { id: true, fullName: true } },
        hrContact: { select: { id: true, name: true } },
        _count: { select: { tasks: true } },
      },
      orderBy: { startDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.onboarding.count({ where }),
  ]);

  return { onboardings, total, page, limit };
}

export async function getOnboardingById(id: string, tenantId: string) {
  return db.onboarding.findFirst({
    where: { id, tenantId },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          position: { select: { name: true } },
        },
      },
      buddy: { select: { id: true, fullName: true } },
      hrContact: { select: { id: true, name: true, email: true } },
      template: true,
      tasks: {
        orderBy: [{ category: "asc" }, { order: "asc" }],
        include: {
          assignee: { select: { id: true, name: true } },
          completedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function updateTaskStatus(
  taskId: string,
  status: string,
  userId: string,
  notes?: string,
) {
  const task = await db.onboardingTask.findUnique({
    where: { id: taskId },
    include: { onboarding: true },
  });

  if (!task) return null;

  const updateData: Record<string, unknown> = { status, notes };

  if (status === "COMPLETED") {
    updateData.completedAt = new Date();
    updateData.completedById = userId;
  }

  const updated = await db.onboardingTask.update({
    where: { id: taskId },
    data: updateData,
  });

  await updateOnboardingProgress(task.onboardingId);

  return updated;
}

export async function updateOnboardingProgress(onboardingId: string) {
  const tasks = await db.onboardingTask.findMany({
    where: { onboardingId, isRequired: true },
  });

  const completedCount = tasks.filter((t) => t.status === "COMPLETED").length;
  const progress =
    tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  let status: string = "IN_PROGRESS";
  if (progress === 0) status = "NOT_STARTED";
  if (progress === 100) status = "COMPLETED";

  await db.onboarding.update({
    where: { id: onboardingId },
    data: {
      progress,
      status: status as OnboardingStatus,
      completedAt: progress === 100 ? new Date() : null,
    },
  });
}

export async function getOnboardingTemplates(tenantId: string) {
  return db.onboardingTemplate.findMany({
    where: { tenantId, isActive: true },
    include: {
      department: { select: { id: true, name: true } },
      _count: { select: { tasks: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function createOnboardingTemplate(
  tenantId: string,
  data: {
    name: string;
    description?: string;
    departmentId?: string;
    positionLevel?: string;
    tasks: {
      title: string;
      description?: string;
      category: string;
      daysOffset: number;
      assigneeType: string;
      isRequired?: boolean;
    }[];
  },
) {
  const template = await db.onboardingTemplate.create({
    data: {
      tenantId,
      name: data.name,
      description: data.description,
      departmentId: data.departmentId,
      positionLevel: data.positionLevel,
    },
  });

  for (let i = 0; i < data.tasks.length; i++) {
    const task = data.tasks[i];
    await db.onboardingTemplateTask.create({
      data: {
        templateId: template.id,
        title: task.title,
        description: task.description,
        category: task.category,
        daysOffset: task.daysOffset,
        assigneeType: task.assigneeType,
        isRequired: task.isRequired ?? true,
        order: i,
      },
    });
  }

  return db.onboardingTemplate.findUnique({
    where: { id: template.id },
    include: { tasks: { orderBy: { order: "asc" } } },
  });
}
