import { db } from "@/lib/db";
import type { AuditAction } from ".prisma/hrm-ai-client";
import type { AuditContext } from "@/types/audit";

export async function logAudit(
  context: AuditContext,
  action: AuditAction,
  entityType: string,
  entityId?: string,
  options?: {
    entityName?: string;
    changes?: Record<string, { old: unknown; new: unknown }>;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await db.auditLog.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId,
        userEmail: context.userEmail,
        action,
        entityType,
        entityId,
        entityName: options?.entityName,
        changes: options?.changes
          ? JSON.parse(JSON.stringify(options.changes))
          : undefined,
        metadata: options?.metadata
          ? JSON.parse(JSON.stringify(options.metadata))
          : undefined,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
  } catch (error) {
    console.error("Audit log error:", error);
  }
}

export function computeChanges(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  fields?: string[],
): Record<string, { old: unknown; new: unknown }> | undefined {
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const keysToCheck = fields || Object.keys(newData);

  for (const key of keysToCheck) {
    const oldVal = oldData[key];
    const newVal = newData[key];
    if (oldVal == null && newVal == null) continue;
    const oldStr = JSON.stringify(oldVal);
    const newStr = JSON.stringify(newVal);
    if (oldStr !== newStr) {
      changes[key] = { old: oldVal, new: newVal };
    }
  }

  return Object.keys(changes).length > 0 ? changes : undefined;
}

export const audit = {
  create: (
    ctx: AuditContext,
    entityType: string,
    entityId: string,
    entityName?: string,
  ) => logAudit(ctx, "CREATE", entityType, entityId, { entityName }),

  update: (
    ctx: AuditContext,
    entityType: string,
    entityId: string,
    changes?: Record<string, { old: unknown; new: unknown }>,
    entityName?: string,
  ) => logAudit(ctx, "UPDATE", entityType, entityId, { changes, entityName }),

  delete: (
    ctx: AuditContext,
    entityType: string,
    entityId: string,
    entityName?: string,
  ) => logAudit(ctx, "DELETE", entityType, entityId, { entityName }),

  login: (ctx: AuditContext) => logAudit(ctx, "LOGIN", "User", ctx.userId),

  logout: (ctx: AuditContext) => logAudit(ctx, "LOGOUT", "User", ctx.userId),

  export: (
    ctx: AuditContext,
    exportType: string,
    params?: Record<string, unknown>,
  ) => logAudit(ctx, "EXPORT", exportType, undefined, { metadata: params }),

  import: (
    ctx: AuditContext,
    importType: string,
    jobId: string,
    summary?: Record<string, unknown>,
  ) => logAudit(ctx, "IMPORT", importType, jobId, { metadata: summary }),

  approve: (
    ctx: AuditContext,
    entityType: string,
    entityId: string,
    entityName?: string,
  ) => logAudit(ctx, "APPROVE", entityType, entityId, { entityName }),

  reject: (
    ctx: AuditContext,
    entityType: string,
    entityId: string,
    entityName?: string,
  ) => logAudit(ctx, "REJECT", entityType, entityId, { entityName }),
};
