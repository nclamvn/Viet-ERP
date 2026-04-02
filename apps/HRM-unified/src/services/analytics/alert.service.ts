// src/services/analytics/alert.service.ts
// Analytics Alert Service

import { db } from "@/lib/db";
import type { AlertSeverity, AlertStatus } from ".prisma/hrm-unified-client";

export interface CreateAlertInput {
  name: string;
  description?: string;
  metricType: string;
  condition: "gt" | "lt" | "eq" | "gte" | "lte" | "change_percent";
  threshold: number;
  compareWith?: "previous_period" | "same_period_last_year" | "fixed_value";
  severity: AlertSeverity;
  departmentId?: string;
  notifyUsers?: string[];
  notifyRoles?: string[];
  notifyEmail?: boolean;
  notifyInApp?: boolean;
  cooldownMinutes?: number;
}

export interface AlertTriggerInput {
  alertId: string;
  metricValue: number;
  message?: string;
}

export interface AlertWithHistory {
  id: string;
  name: string;
  description: string | null;
  metricType: string;
  condition: string;
  threshold: number;
  severity: AlertSeverity;
  status: AlertStatus;
  lastTriggeredAt: Date | null;
  lastValue: number | null;
  triggerCount: number;
  isActive: boolean;
  department: { id: string; name: string } | null;
  recentTriggers: Array<{
    id: string;
    triggeredAt: Date;
    metricValue: number;
    message: string;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
  }>;
}

const METRIC_TYPES = {
  turnover_rate: { name: "Tỷ lệ nghỉ việc", unit: "%", defaultThreshold: 15 },
  attendance_rate: {
    name: "Tỷ lệ chuyên cần",
    unit: "%",
    defaultThreshold: 90,
  },
  overtime_hours: {
    name: "Giờ làm thêm TB",
    unit: "giờ",
    defaultThreshold: 30,
  },
  headcount: { name: "Tổng nhân sự", unit: "người", defaultThreshold: 100 },
  avg_salary: {
    name: "Lương trung bình",
    unit: "VND",
    defaultThreshold: 15000000,
  },
  training_completion: {
    name: "Hoàn thành đào tạo",
    unit: "%",
    defaultThreshold: 80,
  },
  goal_completion: {
    name: "Hoàn thành mục tiêu",
    unit: "%",
    defaultThreshold: 70,
  },
  high_risk_employees: {
    name: "NV nguy cơ cao",
    unit: "người",
    defaultThreshold: 5,
  },
  expiring_contracts: {
    name: "HĐ sắp hết hạn",
    unit: "hợp đồng",
    defaultThreshold: 10,
  },
  open_positions: {
    name: "Vị trí tuyển dụng",
    unit: "vị trí",
    defaultThreshold: 20,
  },
};

export async function createAlert(
  tenantId: string,
  userId: string,
  input: CreateAlertInput,
) {
  const alert = await db.analyticsAlert.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description,
      metricType: input.metricType,
      condition: input.condition,
      threshold: input.threshold,
      compareWith: input.compareWith,
      severity: input.severity,
      departmentId: input.departmentId,
      notifyUsers: input.notifyUsers,
      notifyRoles: input.notifyRoles,
      notifyEmail: input.notifyEmail ?? true,
      notifyInApp: input.notifyInApp ?? true,
      cooldownMinutes: input.cooldownMinutes ?? 60,
      createdById: userId,
    },
    include: {
      department: { select: { id: true, name: true } },
    },
  });

  return alert;
}

export async function updateAlert(
  tenantId: string,
  alertId: string,
  input: Partial<CreateAlertInput>,
) {
  const existing = await db.analyticsAlert.findFirst({
    where: { id: alertId, tenantId },
  });

  if (!existing) {
    throw new Error("Alert not found");
  }

  return db.analyticsAlert.update({
    where: { id: alertId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.metricType !== undefined && { metricType: input.metricType }),
      ...(input.condition !== undefined && { condition: input.condition }),
      ...(input.threshold !== undefined && { threshold: input.threshold }),
      ...(input.compareWith !== undefined && {
        compareWith: input.compareWith,
      }),
      ...(input.severity !== undefined && { severity: input.severity }),
      ...(input.departmentId !== undefined && {
        departmentId: input.departmentId,
      }),
      ...(input.notifyUsers !== undefined && {
        notifyUsers: input.notifyUsers,
      }),
      ...(input.notifyRoles !== undefined && {
        notifyRoles: input.notifyRoles,
      }),
      ...(input.notifyEmail !== undefined && {
        notifyEmail: input.notifyEmail,
      }),
      ...(input.notifyInApp !== undefined && {
        notifyInApp: input.notifyInApp,
      }),
      ...(input.cooldownMinutes !== undefined && {
        cooldownMinutes: input.cooldownMinutes,
      }),
    },
  });
}

export async function deleteAlert(tenantId: string, alertId: string) {
  const existing = await db.analyticsAlert.findFirst({
    where: { id: alertId, tenantId },
  });

  if (!existing) {
    throw new Error("Alert not found");
  }

  await db.analyticsAlert.delete({ where: { id: alertId } });
}

export async function listAlerts(
  tenantId: string,
  options: {
    status?: AlertStatus;
    severity?: AlertSeverity;
    isActive?: boolean;
    departmentId?: string;
  } = {},
) {
  return db.analyticsAlert.findMany({
    where: {
      tenantId,
      ...(options.status && { status: options.status }),
      ...(options.severity && { severity: options.severity }),
      ...(options.isActive !== undefined && { isActive: options.isActive }),
      ...(options.departmentId && { departmentId: options.departmentId }),
    },
    include: {
      department: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { history: true } },
    },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
  });
}

export async function getAlertById(
  tenantId: string,
  alertId: string,
): Promise<AlertWithHistory | null> {
  const alert = await db.analyticsAlert.findFirst({
    where: { id: alertId, tenantId },
    include: {
      department: { select: { id: true, name: true } },
      history: {
        orderBy: { triggeredAt: "desc" },
        take: 10,
      },
    },
  });

  if (!alert) return null;

  return {
    id: alert.id,
    name: alert.name,
    description: alert.description,
    metricType: alert.metricType,
    condition: alert.condition,
    threshold: Number(alert.threshold),
    severity: alert.severity,
    status: alert.status,
    lastTriggeredAt: alert.lastTriggeredAt,
    lastValue: alert.lastValue ? Number(alert.lastValue) : null,
    triggerCount: alert.triggerCount,
    isActive: alert.isActive,
    department: alert.department,
    recentTriggers: alert.history.map((h) => ({
      id: h.id,
      triggeredAt: h.triggeredAt,
      metricValue: Number(h.metricValue),
      message: h.message,
      acknowledgedAt: h.acknowledgedAt,
      resolvedAt: h.resolvedAt,
    })),
  };
}

export async function triggerAlert(tenantId: string, input: AlertTriggerInput) {
  const alert = await db.analyticsAlert.findFirst({
    where: { id: input.alertId, tenantId, isActive: true },
  });

  if (!alert) {
    throw new Error("Alert not found or not active");
  }

  // Check cooldown
  if (alert.lastTriggeredAt) {
    const cooldownMs = alert.cooldownMinutes * 60 * 1000;
    const timeSinceLastTrigger = Date.now() - alert.lastTriggeredAt.getTime();
    if (timeSinceLastTrigger < cooldownMs) {
      return null; // Skip due to cooldown
    }
  }

  // Check if condition is met
  const threshold = Number(alert.threshold);
  let shouldTrigger = false;

  switch (alert.condition) {
    case "gt":
      shouldTrigger = input.metricValue > threshold;
      break;
    case "lt":
      shouldTrigger = input.metricValue < threshold;
      break;
    case "eq":
      shouldTrigger = input.metricValue === threshold;
      break;
    case "gte":
      shouldTrigger = input.metricValue >= threshold;
      break;
    case "lte":
      shouldTrigger = input.metricValue <= threshold;
      break;
    case "change_percent":
      // Would need previous value to calculate
      shouldTrigger = Math.abs(input.metricValue) >= threshold;
      break;
  }

  if (!shouldTrigger) {
    return null;
  }

  // Create trigger history
  const message =
    input.message || generateAlertMessage(alert, input.metricValue);

  const triggerHistory = await db.alertTriggerHistory.create({
    data: {
      alertId: alert.id,
      metricValue: input.metricValue,
      thresholdValue: threshold,
      message,
    },
  });

  // Update alert
  await db.analyticsAlert.update({
    where: { id: alert.id },
    data: {
      status: "ACTIVE",
      lastTriggeredAt: new Date(),
      lastValue: input.metricValue,
      triggerCount: { increment: 1 },
    },
  });

  // Send notifications
  if (alert.notifyInApp) {
    await sendInAppNotifications(tenantId, alert, message);
  }

  return triggerHistory;
}

function generateAlertMessage(
  alert: {
    name: string;
    metricType: string;
    condition: string;
    threshold: number | unknown;
  },
  value: number,
): string {
  const metricInfo =
    METRIC_TYPES[alert.metricType as keyof typeof METRIC_TYPES];
  const metricName = metricInfo?.name || alert.metricType;
  const unit = metricInfo?.unit || "";
  const threshold = Number(alert.threshold);

  const conditionText: Record<string, string> = {
    gt: "vượt quá",
    lt: "thấp hơn",
    eq: "bằng",
    gte: "đạt hoặc vượt",
    lte: "đạt hoặc dưới",
    change_percent: "thay đổi",
  };

  return `${alert.name}: ${metricName} hiện tại ${value}${unit}, ${conditionText[alert.condition] || ""} ngưỡng ${threshold}${unit}`;
}

async function sendInAppNotifications(
  tenantId: string,
  alert: {
    name: string;
    notifyUsers: unknown;
    notifyRoles: unknown;
    severity: AlertSeverity;
  },
  message: string,
) {
  const userIds: string[] = [];

  // Add specific users
  if (alert.notifyUsers) {
    userIds.push(...(alert.notifyUsers as string[]));
  }

  // Add users by role
  if (alert.notifyRoles) {
    const roles = alert.notifyRoles as string[];
    const validRoles = roles.filter((r) =>
      ["SUPER_ADMIN", "ADMIN", "HR_MANAGER", "HR_STAFF", "VIEWER"].includes(r),
    ) as ("SUPER_ADMIN" | "ADMIN" | "HR_MANAGER" | "HR_STAFF" | "VIEWER")[];

    if (validRoles.length > 0) {
      const roleUsers = await db.user.findMany({
        where: {
          tenantId,
          role: { in: validRoles },
          isActive: true,
        },
        select: { id: true },
      });
      userIds.push(...roleUsers.map((u) => u.id));
    }
  }

  // Create notifications
  if (userIds.length > 0) {
    await db.notification.createMany({
      data: userIds.map((userId) => ({
        tenantId,
        userId,
        title: `Cảnh báo: ${alert.name}`,
        message,
        type: "GENERAL" as const,
        isRead: false,
      })),
    });
  }
}

export async function acknowledgeAlert(
  tenantId: string,
  triggerId: string,
  userId: string,
) {
  const trigger = await db.alertTriggerHistory.findFirst({
    where: { id: triggerId },
    include: { alert: { select: { tenantId: true } } },
  });

  if (!trigger || trigger.alert.tenantId !== tenantId) {
    throw new Error("Alert trigger not found");
  }

  return db.alertTriggerHistory.update({
    where: { id: triggerId },
    data: {
      acknowledgedById: userId,
      acknowledgedAt: new Date(),
    },
  });
}

export async function resolveAlert(
  tenantId: string,
  triggerId: string,
  userId: string,
  resolution: string,
) {
  const trigger = await db.alertTriggerHistory.findFirst({
    where: { id: triggerId },
    include: { alert: { select: { id: true, tenantId: true } } },
  });

  if (!trigger || trigger.alert.tenantId !== tenantId) {
    throw new Error("Alert trigger not found");
  }

  // Update trigger history
  await db.alertTriggerHistory.update({
    where: { id: triggerId },
    data: {
      resolvedById: userId,
      resolvedAt: new Date(),
      resolution,
    },
  });

  // Check if all triggers are resolved
  const unresolvedCount = await db.alertTriggerHistory.count({
    where: {
      alertId: trigger.alert.id,
      resolvedAt: null,
    },
  });

  if (unresolvedCount === 0) {
    await db.analyticsAlert.update({
      where: { id: trigger.alert.id },
      data: { status: "RESOLVED" },
    });
  }

  return trigger;
}

export async function toggleAlertActive(
  tenantId: string,
  alertId: string,
  isActive: boolean,
) {
  const existing = await db.analyticsAlert.findFirst({
    where: { id: alertId, tenantId },
  });

  if (!existing) {
    throw new Error("Alert not found");
  }

  return db.analyticsAlert.update({
    where: { id: alertId },
    data: { isActive },
  });
}

export async function checkAlerts(tenantId: string) {
  // Get all active alerts
  const alerts = await db.analyticsAlert.findMany({
    where: { tenantId, isActive: true },
  });

  const results: Array<{
    alertId: string;
    triggered: boolean;
    message?: string;
  }> = [];

  for (const alert of alerts) {
    const metricValue = await getMetricValue(
      tenantId,
      alert.metricType,
      alert.departmentId,
    );

    if (metricValue !== null) {
      const trigger = await triggerAlert(tenantId, {
        alertId: alert.id,
        metricValue,
      });

      results.push({
        alertId: alert.id,
        triggered: trigger !== null,
        message: trigger?.message,
      });
    }
  }

  return results;
}

async function getMetricValue(
  tenantId: string,
  metricType: string,
  departmentId?: string | null,
): Promise<number | null> {
  const departmentFilter = departmentId ? { departmentId } : {};

  switch (metricType) {
    case "turnover_rate": {
      const total = await db.employee.count({
        where: { tenantId, deletedAt: null, ...departmentFilter },
      });
      const terminated = await db.employee.count({
        where: {
          tenantId,
          status: { in: ["RESIGNED", "TERMINATED"] },
          updatedAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
          ...departmentFilter,
        },
      });
      return total > 0 ? (terminated / total) * 100 : 0;
    }

    case "headcount": {
      return db.employee.count({
        where: {
          tenantId,
          deletedAt: null,
          status: "ACTIVE",
          ...departmentFilter,
        },
      });
    }

    case "high_risk_employees": {
      return db.turnoverPrediction.count({
        where: {
          tenantId,
          riskLevel: { in: ["HIGH", "CRITICAL"] },
          validUntil: { gte: new Date() },
        },
      });
    }

    case "expiring_contracts": {
      return db.contract.count({
        where: {
          tenantId,
          status: "ACTIVE",
          endDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        },
      });
    }

    case "open_positions": {
      return db.jobRequisition.count({
        where: {
          tenantId,
          status: "OPEN",
          ...(departmentId && { departmentId }),
        },
      });
    }

    default:
      return null;
  }
}

export function getAvailableMetricTypes() {
  return Object.entries(METRIC_TYPES).map(([key, value]) => ({
    id: key,
    ...value,
  }));
}

export const alertService = {
  createAlert,
  updateAlert,
  deleteAlert,
  listAlerts,
  getAlertById,
  triggerAlert,
  acknowledgeAlert,
  resolveAlert,
  toggleAlertActive,
  checkAlerts,
  getAvailableMetricTypes,
};
