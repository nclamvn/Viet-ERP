// lib/audit-logger.ts
import { prisma } from "./prisma";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { Prisma } from ".prisma/mrp-client";

type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "VIEW"
  | "EXPORT"
  | "IMPORT"
  | "LOGIN"
  | "LOGOUT";

interface AuditLogParams {
  action: AuditAction;
  entityType: string;
  entityId: string;
  entityName?: string;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}

export async function logAudit(params: AuditLogParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) return;

    const headersList = headers();
    const ipAddress = headersList.get("x-forwarded-for") || "unknown";
    const userAgent = headersList.get("user-agent") || "unknown";

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        entityName: params.entityName,
        oldValues: params.oldValues,
        newValues: params.newValues,
        ipAddress,
        userAgent,
        metadata: params.metadata,
      },
    });
  } catch (error) {
    console.error("Failed to log audit:", error);
    // Don't throw - audit logging should not break the main operation
  }
}

// Helper for tracking changes
export function getChangedFields(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
): { oldValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  allKeys.forEach((key) => {
    if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
      oldValues[key] = oldObj[key];
      newValues[key] = newObj[key];
    }
  });

  return { oldValues, newValues };
}

// Log activity (for activity feed)
export async function logActivity(params: {
  type: string;
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  link?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    const session = await auth();
    if (!session?.user?.id) return;

    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        type: params.type,
        title: params.title,
        description: params.description,
        icon: params.icon,
        color: params.color,
        link: params.link,
        metadata: params.metadata,
      },
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
}

// Create notification
export async function createNotification(params: {
  userId: string;
  type: string;
  title: string;
  message: string;
  priority?: string;
  link?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        priority: params.priority || "normal",
        link: params.link,
        metadata: params.metadata,
      },
    });
  } catch (error) {
    console.error("Failed to create notification:", error);
  }
}

// Get recent activity for a user
export async function getRecentActivity(userId: string, limit: number = 20) {
  return prisma.activityLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// Get audit trail for an entity
export async function getAuditTrail(entityType: string, entityId: string) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
  });
}

// Pre-built activity loggers
export const ActivityLoggers = {
  orderCreated: async (
    orderNumber: string,
    customerName: string,
    total: number,
  ) => {
    return logActivity({
      type: "order_created",
      title: `Sales Order ${orderNumber} created`,
      description: `Customer: ${customerName} • Total: $${total.toLocaleString()}`,
      icon: "shopping-cart",
      color: "green",
      link: `/orders?q=${orderNumber}`,
    });
  },

  stockAlert: async (
    partNumber: string,
    partName: string,
    currentStock: number,
    reorderPoint: number,
  ) => {
    return logActivity({
      type: "stock_alert",
      title: `Stock Alert: ${partNumber}`,
      description: `${partName} is at ${currentStock} units (reorder point: ${reorderPoint})`,
      icon: "alert-triangle",
      color: "amber",
      link: `/inventory?q=${partNumber}`,
    });
  },

  poReceived: async (
    poNumber: string,
    supplierName: string,
    itemsReceived: number,
  ) => {
    return logActivity({
      type: "po_received",
      title: `PO ${poNumber} received`,
      description: `Supplier: ${supplierName} • ${itemsReceived} items received`,
      icon: "package",
      color: "blue",
      link: `/purchasing?q=${poNumber}`,
    });
  },

  mrpCompleted: async (
    runNumber: string,
    totalParts: number,
    suggestions: number,
  ) => {
    return logActivity({
      type: "mrp_complete",
      title: `MRP Run ${runNumber} completed`,
      description: `${totalParts} parts analyzed • ${suggestions} suggestions generated`,
      icon: "brain",
      color: "purple",
      link: `/mrp`,
    });
  },

  workOrderCompleted: async (
    woNumber: string,
    productName: string,
    quantity: number,
  ) => {
    return logActivity({
      type: "wo_complete",
      title: `Work Order ${woNumber} completed`,
      description: `${productName} • ${quantity} units completed`,
      icon: "check-circle",
      color: "green",
      link: `/production?q=${woNumber}`,
    });
  },
};
