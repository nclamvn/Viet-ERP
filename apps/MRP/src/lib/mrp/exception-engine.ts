// Exception Engine - MRP Exception Detection and Management
import { prisma } from "@/lib/prisma";
import { Decimal } from "decimal.js";

export type ExceptionType =
  | "RESCHEDULE_IN"
  | "RESCHEDULE_OUT"
  | "EXPEDITE"
  | "DEFER"
  | "CANCEL"
  | "PAST_DUE"
  | "SHORTAGE"
  | "EXCESS"
  | "SHORTAGE"
  | "EXCESS"
  | "LEAD_TIME_VIOLATION"
  | "SAFETY_STOCK_VIOLATION";

export type Severity = "INFO" | "WARNING" | "CRITICAL";

export interface DetectedExceptionData {
  exceptionType: ExceptionType;
  severity: Severity;
  entityType: string;
  entityId: string;
  partId: string;
  siteId?: string;
  message: string;
  currentDate?: Date;
  suggestedDate?: Date;
  quantity?: number;
}

export interface ExceptionSummary {
  total: number;
  bySeverity: { INFO: number; WARNING: number; CRITICAL: number };
  byType: Record<string, number>;
  openCount: number;
}

/**
 * Detect MRP exceptions
 */
export async function detectExceptions(
  mrpRunId?: string,
): Promise<DetectedExceptionData[]> {
  const exceptions: DetectedExceptionData[] = [];

  // Detect past due purchase orders
  const pastDuePOs = await detectPastDuePurchaseOrders();
  exceptions.push(...pastDuePOs);

  // Detect shortages from planned orders
  const shortages = await detectShortages();
  exceptions.push(...shortages);

  // Detect reschedule opportunities
  const reschedules = await detectRescheduleOpportunities();
  exceptions.push(...reschedules);

  // Save exceptions to database
  for (const exc of exceptions) {
    await prisma.mRPException.create({
      data: {
        exceptionType: exc.exceptionType,
        severity: exc.severity,
        entityType: exc.entityType,
        entityId: exc.entityId,
        partId: exc.partId,
        siteId: exc.siteId,
        message: exc.message,
        currentDate: exc.currentDate,
        suggestedDate: exc.suggestedDate,
        quantity: exc.quantity ? new Decimal(exc.quantity) : null,
        mrpRunId,
        status: "OPEN",
      },
    });
  }

  return exceptions;
}

/**
 * Detect past due purchase orders
 */
async function detectPastDuePurchaseOrders(): Promise<DetectedExceptionData[]> {
  const exceptions: DetectedExceptionData[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pastDuePOs = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ["approved", "sent"] },
      expectedDate: { lt: today },
    },
    include: {
      lines: {
        include: { part: true },
      },
      supplier: true,
    },
  });

  for (const po of pastDuePOs) {
    for (const line of po.lines) {
      const openQty = line.quantity - line.receivedQty;
      if (openQty > 0) {
        const daysLate = Math.floor(
          (today.getTime() - (po.expectedDate?.getTime() || 0)) /
            (1000 * 60 * 60 * 24),
        );

        exceptions.push({
          exceptionType: "PAST_DUE",
          severity: daysLate > 7 ? "CRITICAL" : "WARNING",
          entityType: "PURCHASE_ORDER",
          entityId: po.id,
          partId: line.partId,
          message: `PO ${po.poNumber} is ${daysLate} days past due. Open qty: ${openQty} for ${line.part.partNumber}`,
          currentDate: po.expectedDate || undefined,
          quantity: openQty,
        });
      }
    }
  }

  return exceptions;
}

/**
 * Detect inventory shortages
 */
async function detectShortages(): Promise<DetectedExceptionData[]> {
  const exceptions: DetectedExceptionData[] = [];

  // Find parts below safety stock
  const parts = await prisma.part.findMany({
    where: {
      status: "active",
    },
    include: {
      inventory: true,
      planning: true,
    },
  });

  for (const part of parts) {
    const totalOnHand = part.inventory.reduce(
      (sum, inv) => sum + inv.quantity - inv.reservedQty,
      0,
    );

    // Check safety stock
    const safetyStock = part.planning?.safetyStock || 0;
    if (totalOnHand < safetyStock) {
      const shortage = safetyStock - totalOnHand;
      let severity: Severity = "INFO";
      if (shortage / safetyStock >= 0.5) {
        severity = "CRITICAL";
      } else if (shortage / safetyStock > 0) {
        severity = "WARNING";
      }

      exceptions.push({
        entityType: "PART",
        entityId: part.id,
        partId: part.id,
        exceptionType: "SAFETY_STOCK_VIOLATION",
        severity: severity,
        message: `${part.partNumber} is ${shortage} units below safety stock (${safetyStock})`,
        quantity: shortage,
      });
    }
  }

  return exceptions;
}

/**
 * Detect reschedule opportunities
 */
async function detectRescheduleOpportunities(): Promise<
  DetectedExceptionData[]
> {
  const exceptions: DetectedExceptionData[] = [];

  // Get planning settings
  const settings = await prisma.planningSettings.findFirst({
    where: { siteId: null },
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const rescheduleInDays = settings?.rescheduleInDays || 3;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const rescheduleOutDays = settings?.rescheduleOutDays || 5;

  // Check planned orders for reschedule opportunities
  const plannedOrders = await prisma.plannedOrder.findMany({
    where: {
      status: { in: ["PLANNED", "FIRM"] },
      isFirm: false,
    },
    include: {
      part: true,
    },
  });

  // This is simplified - in real implementation, would compare to actual demand dates
  const today = new Date();

  for (const order of plannedOrders) {
    const daysUntilDue = Math.floor(
      (order.dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    // If due date is far in the future, suggest rescheduling out
    if (daysUntilDue > 30) {
      exceptions.push({
        exceptionType: "RESCHEDULE_OUT",
        severity: "INFO",
        entityType: "PLANNED_ORDER",
        entityId: order.id,
        partId: order.partId,
        message: `Planned order ${order.orderNumber} due in ${daysUntilDue} days may be rescheduled`,
        currentDate: order.dueDate,
        quantity: Number(order.quantity),
      });
    }
  }

  return exceptions;
}

/**
 * Get exception summary
 */
export async function getExceptionSummary(
  siteId?: string,
): Promise<ExceptionSummary> {
  const where = {
    status: "OPEN",
    ...(siteId && { siteId }),
  };

  const exceptions = await prisma.mRPException.findMany({ where });

  const bySeverity = { INFO: 0, WARNING: 0, CRITICAL: 0 };
  const byType: Record<string, number> = {};

  for (const exc of exceptions) {
    bySeverity[exc.severity as keyof typeof bySeverity]++;
    byType[exc.exceptionType] = (byType[exc.exceptionType] || 0) + 1;
  }

  return {
    total: exceptions.length,
    bySeverity,
    byType,
    openCount: exceptions.filter((e) => e.status === "OPEN").length,
  };
}

/**
 * Get exceptions with filters
 */
export async function getExceptions(options: {
  status?: string;
  severity?: string;
  exceptionType?: string;
  partId?: string;
  siteId?: string;
  limit?: number;
}) {
  const where: Record<string, unknown> = {};

  if (options.status) where.status = options.status;
  if (options.severity) where.severity = options.severity;
  if (options.exceptionType) where.exceptionType = options.exceptionType;
  if (options.partId) where.partId = options.partId;
  if (options.siteId) where.siteId = options.siteId;

  return prisma.mRPException.findMany({
    where,
    include: {
      part: true,
    },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: options.limit || 100,
  });
}

/**
 * Resolve an exception
 */
export async function resolveException(
  exceptionId: string,
  resolution: string,
  userId: string,
): Promise<void> {
  await prisma.mRPException.update({
    where: { id: exceptionId },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedBy: userId,
      resolution,
    },
  });
}

/**
 * Acknowledge an exception
 */
export async function acknowledgeException(
  exceptionId: string,
  userId: string,
): Promise<void> {
  await prisma.mRPException.update({
    where: { id: exceptionId },
    data: {
      status: "ACKNOWLEDGED",
      resolvedBy: userId,
    },
  });
}

/**
 * Ignore an exception
 */
export async function ignoreException(
  exceptionId: string,
  userId: string,
  reason?: string,
): Promise<void> {
  await prisma.mRPException.update({
    where: { id: exceptionId },
    data: {
      status: "IGNORED",
      resolvedAt: new Date(),
      resolvedBy: userId,
      resolution: reason || "Ignored by user",
    },
  });
}

/**
 * Clear old resolved exceptions
 */
export async function clearOldExceptions(
  daysOld: number = 30,
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await prisma.mRPException.deleteMany({
    where: {
      status: { in: ["RESOLVED", "IGNORED"] },
      resolvedAt: { lt: cutoffDate },
    },
  });

  return result.count;
}
