import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/mrp-client";
import { getClientIp, getRequestId, getRoute } from "@/lib/request-context";
import { logger } from "@/lib/logger";

interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  displayName?: string; // Human-readable field name
}

interface AuditLogInput {
  entityType: string;
  entityId: string;
  entityName?: string;
  action: string;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
  summary?: string;
  userId: string;
  userRole?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

// API-level logging (Gate 5.3)
interface ApiLog {
  requestId: string;
  route: string;
  method: string;
  status: number;
  timestamp: string;
  userId: string;
  ip: string;
  error?: string;
}

export class AuditLogger {
  /**
   * Log a data change
   */
  async log(input: AuditLogInput): Promise<string> {
    // Merge userRole and sessionId into metadata (not in schema)
    const mergedMetadata = {
      ...(input.metadata || {}),
      ...(input.userRole ? { userRole: input.userRole } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    };

    const auditLog = await prisma.auditLog.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        entityName: input.entityName,
        action: input.action,
        oldValues: input.oldValues ?? Prisma.JsonNull,
        newValues: input.newValues ?? Prisma.JsonNull,
        userId: input.userId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata:
          Object.keys(mergedMetadata).length > 0
            ? mergedMetadata
            : Prisma.JsonNull,
      },
    });

    return auditLog.id;
  }

  /**
   * Log CREATE action
   */
  async logCreate(
    entityType: string,
    entityId: string,
    entityName: string,
    userId: string,
    newData?: Record<string, unknown>,
    context?: { userRole?: string; ipAddress?: string; userAgent?: string },
  ): Promise<string> {
    return this.log({
      entityType,
      entityId,
      entityName,
      action: "CREATE",
      newValues: newData as Prisma.InputJsonValue,
      summary: `Created ${entityType.toLowerCase().replace("_", " ")} "${entityName}"`,
      userId,
      ...context,
    });
  }

  /**
   * Log UPDATE action with field changes
   */
  async logUpdate(
    entityType: string,
    entityId: string,
    entityName: string,
    userId: string,
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
    context?: { userRole?: string; ipAddress?: string; userAgent?: string },
  ): Promise<string | null> {
    const fieldChanges = this.calculateFieldChanges(oldData, newData);

    if (fieldChanges.length === 0) {
      // No actual changes
      return null;
    }

    return this.log({
      entityType,
      entityId,
      entityName,
      action: "UPDATE",
      oldValues: oldData as Prisma.InputJsonValue,
      newValues: newData as Prisma.InputJsonValue,
      summary: this.generateUpdateSummary(entityType, entityName, fieldChanges),
      userId,
      metadata: { fieldChanges },
      ...context,
    });
  }

  /**
   * Log DELETE action
   */
  async logDelete(
    entityType: string,
    entityId: string,
    entityName: string,
    userId: string,
    deletedData?: Record<string, unknown>,
    context?: { userRole?: string; ipAddress?: string; userAgent?: string },
  ): Promise<string> {
    return this.log({
      entityType,
      entityId,
      entityName,
      action: "DELETE",
      oldValues: deletedData as Prisma.InputJsonValue,
      summary: `Deleted ${entityType.toLowerCase().replace("_", " ")} "${entityName}"`,
      userId,
      ...context,
    });
  }

  /**
   * Log STATUS_CHANGE action
   */
  async logStatusChange(
    entityType: string,
    entityId: string,
    entityName: string,
    userId: string,
    oldStatus: string,
    newStatus: string,
    context?: { userRole?: string; ipAddress?: string; userAgent?: string },
  ): Promise<string> {
    return this.log({
      entityType,
      entityId,
      entityName,
      action: "STATUS_CHANGE",
      oldValues: { status: oldStatus },
      newValues: { status: newStatus },
      summary: `Changed status of "${entityName}" from "${oldStatus}" to "${newStatus}"`,
      userId,
      metadata: {
        fieldChanges: [
          { field: "status", oldValue: oldStatus, newValue: newStatus },
        ],
      },
      ...context,
    });
  }

  /**
   * Log APPROVE action
   */
  async logApprove(
    entityType: string,
    entityId: string,
    entityName: string,
    userId: string,
    context?: {
      userRole?: string;
      ipAddress?: string;
      userAgent?: string;
      notes?: string;
    },
  ): Promise<string> {
    return this.log({
      entityType,
      entityId,
      entityName,
      action: "APPROVE",
      summary: `Approved ${entityType.toLowerCase().replace("_", " ")} "${entityName}"`,
      userId,
      metadata: context?.notes ? { notes: context.notes } : undefined,
      ...context,
    });
  }

  /**
   * Log REJECT action
   */
  async logReject(
    entityType: string,
    entityId: string,
    entityName: string,
    userId: string,
    reason?: string,
    context?: { userRole?: string; ipAddress?: string; userAgent?: string },
  ): Promise<string> {
    return this.log({
      entityType,
      entityId,
      entityName,
      action: "REJECT",
      summary: `Rejected ${entityType.toLowerCase().replace("_", " ")} "${entityName}"${reason ? `: ${reason}` : ""}`,
      userId,
      metadata: reason ? { reason } : undefined,
      ...context,
    });
  }

  /**
   * Calculate field changes between old and new data
   */
  private calculateFieldChanges(
    oldData: Record<string, any>,
    newData: Record<string, any>,
  ): FieldChange[] {
    const changes: FieldChange[] = [];
    const allKeys = Array.from(
      new Set([...Object.keys(oldData), ...Object.keys(newData)]),
    );

    // Fields to ignore
    const ignoreFields = [
      "id",
      "createdAt",
      "updatedAt",
      "version",
      "deletedAt",
    ];

    for (const key of allKeys) {
      if (ignoreFields.includes(key)) continue;

      const oldValue = oldData[key];
      const newValue = newData[key];

      // Deep comparison for objects/arrays
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({
          field: key,
          oldValue: this.sanitizeValue(oldValue),
          newValue: this.sanitizeValue(newValue),
          displayName: this.toDisplayName(key),
        });
      }
    }

    return changes;
  }

  /**
   * Sanitize value for storage (handle dates, objects, etc.)
   */
  private sanitizeValue(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return value;
  }

  /**
   * Convert field name to display name
   */
  private toDisplayName(field: string): string {
    return field
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase())
      .replace(/_/g, " ")
      .trim();
  }

  /**
   * Generate summary for an audit log entry
   */
  private generateSummary(input: AuditLogInput): string {
    const entity = input.entityType.toLowerCase().replace("_", " ");
    const title = input.entityName || input.entityId;

    switch (input.action.toUpperCase()) {
      case "CREATE":
        return `Created ${entity} "${title}"`;
      case "UPDATE":
        return `Updated ${entity} "${title}"`;
      case "DELETE":
        return `Deleted ${entity} "${title}"`;
      case "STATUS_CHANGE":
        return `Changed status of ${entity} "${title}"`;
      case "APPROVE":
        return `Approved ${entity} "${title}"`;
      case "REJECT":
        return `Rejected ${entity} "${title}"`;
      case "VIEW":
        return `Viewed ${entity} "${title}"`;
      case "EXPORT":
        return `Exported ${entity} "${title}"`;
      case "IMPORT":
        return `Imported ${entity} "${title}"`;
      default:
        return `${input.action} on ${entity} "${title}"`;
    }
  }

  /**
   * Generate detailed update summary
   */
  private generateUpdateSummary(
    entityType: string,
    entityName: string,
    changes: FieldChange[],
  ): string {
    const entity = entityType.toLowerCase().replace("_", " ");

    if (changes.length === 0) {
      return `Updated ${entity} "${entityName}"`;
    }

    if (changes.length === 1) {
      const change = changes[0];
      const oldVal =
        change.oldValue === null ? "(empty)" : String(change.oldValue);
      const newVal =
        change.newValue === null ? "(empty)" : String(change.newValue);
      return `Updated ${change.displayName || change.field} of "${entityName}": "${oldVal}" → "${newVal}"`;
    }

    const fieldNames = changes.map((c) => c.displayName || c.field).join(", ");
    return `Updated ${changes.length} fields of "${entityName}": ${fieldNames}`;
  }

  /**
   * Get audit logs for an entity
   */
  async getLogsForEntity(
    entityType: string,
    entityId: string,
    options?: { limit?: number; cursor?: string },
  ) {
    const logs = await prisma.auditLog.findMany({
      where: { entityType, entityId },
      take: (options?.limit || 50) + 1,
      cursor: options?.cursor ? { id: options.cursor } : undefined,
      skip: options?.cursor ? 1 : 0,
      orderBy: { createdAt: "desc" },
      // Note: user and conversationLinks relations removed (not in schema)
    });

    const hasMore = logs.length > (options?.limit || 50);
    if (hasMore) logs.pop();

    return {
      data: logs,
      hasMore,
      nextCursor: hasMore ? logs[logs.length - 1]?.id : null,
    };
  }
}

/**
 * Log API request (Gate 5.3 requirement)
 * Logs structured JSON with requestId, route, method, status, timestamp, userId, ip
 */
export function logApi(
  req: Request,
  status: number,
  userId?: string,
  error?: unknown,
): void {
  const payload: ApiLog = {
    requestId: getRequestId(req),
    route: getRoute(req),
    method: req.method,
    status,
    timestamp: new Date().toISOString(),
    userId: userId || "anon",
    ip: getClientIp(req),
    ...(error
      ? { error: error instanceof Error ? error.message : String(error) }
      : {}),
  };

  logger.info("API audit log", payload);
}

export const auditLogger = new AuditLogger();
