import { prisma } from "@/lib/prisma";
import type { AuditAction, Prisma } from ".prisma/hrm-client";

export interface AuditEntry {
  action: AuditAction;
  actorId: string;
  actorName: string;
  actorRole: string;
  targetType: string;
  targetId: string;
  targetName: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.actorId,
        action: entry.action,
        entity: entry.targetType,
        entityId: entry.targetId,
        actorName: entry.actorName,
        actorRole: entry.actorRole,
        targetName: entry.targetName,
        newData: entry.metadata
          ? (entry.metadata as Prisma.InputJsonObject)
          : undefined,
        ipAddress: entry.ip,
      },
    });
  } catch (err) {
    console.error("[writeAudit] Failed:", err);
    // Audit failure must not block business operations
  }
}
