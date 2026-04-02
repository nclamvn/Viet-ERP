import { db } from "@/lib/db";
import type { AuditAction } from ".prisma/hrm-unified-client";
import type { AuditContext } from "@/types/audit";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function generateUniqueSlug(
  tenantId: string,
  title: string,
): Promise<string> {
  const baseSlug = slugify(title);
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await db.jobPosting.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
    });
    if (!existing) return slug;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

export async function createAuditLog(
  ctx: AuditContext,
  action: AuditAction,
  entityType: string,
  entityId: string,
  entityName?: string,
  changes?: Record<string, unknown>,
) {
  await db.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userEmail: ctx.userEmail,
      action,
      entityType,
      entityId,
      entityName,
      changes: changes ? JSON.parse(JSON.stringify(changes)) : undefined,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });
}

export const audit = {
  async create(
    ctx: AuditContext,
    entityType: string,
    entityId: string,
    entityName?: string,
  ) {
    await createAuditLog(ctx, "CREATE", entityType, entityId, entityName);
  },
  async update(
    ctx: AuditContext,
    entityType: string,
    entityId: string,
    changes?: Record<string, unknown>,
    entityName?: string,
  ) {
    await createAuditLog(
      ctx,
      "UPDATE",
      entityType,
      entityId,
      entityName,
      changes,
    );
  },
  async approve(
    ctx: AuditContext,
    entityType: string,
    entityId: string,
    entityName?: string,
  ) {
    await createAuditLog(ctx, "APPROVE", entityType, entityId, entityName);
  },
  async reject(
    ctx: AuditContext,
    entityType: string,
    entityId: string,
    entityName?: string,
  ) {
    await createAuditLog(ctx, "REJECT", entityType, entityId, entityName);
  },
};
