import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-ai-client";
import { randomBytes, createHmac } from "crypto";
import { audit } from "@/lib/audit/logger";
import type { AuditContext } from "@/types/audit";

export const webhookService = {
  async create(
    tenantId: string,
    ctx: AuditContext,
    data: {
      name: string;
      url: string;
      events: string[];
      headers?: Record<string, string>;
    },
  ): Promise<{ id: string; secret: string }> {
    const secret = randomBytes(32).toString("hex");

    const webhook = await db.webhook.create({
      data: {
        tenantId,
        name: data.name,
        url: data.url,
        secret,
        events: data.events,
        headers: data.headers
          ? JSON.parse(JSON.stringify(data.headers))
          : undefined,
      },
    });

    await audit.create(ctx, "Webhook", webhook.id, data.name);
    return { id: webhook.id, secret };
  },

  async update(
    id: string,
    tenantId: string,
    ctx: AuditContext,
    data: { name?: string; url?: string; events?: string[]; status?: string },
  ) {
    const webhook = await db.webhook.findFirst({ where: { id, tenantId } });
    if (!webhook) return null;

    const updated = await db.webhook.update({
      where: { id },
      data: data as Prisma.WebhookUpdateInput,
    });
    await audit.update(ctx, "Webhook", id, undefined, webhook.name);
    return updated;
  },

  async delete(id: string, tenantId: string, ctx: AuditContext) {
    const webhook = await db.webhook.findFirst({ where: { id, tenantId } });
    if (!webhook) return false;

    await db.webhook.delete({ where: { id } });
    await audit.delete(ctx, "Webhook", id, webhook.name);
    return true;
  },

  async getAll(tenantId: string) {
    return db.webhook.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  },

  async getById(id: string, tenantId: string) {
    return db.webhook.findFirst({ where: { id, tenantId } });
  },

  async getDeliveries(webhookId: string, limit = 50) {
    return db.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  async test(id: string, tenantId: string) {
    const webhook = await db.webhook.findFirst({ where: { id, tenantId } });
    if (!webhook) return { success: false, error: "Webhook not found" };

    const payload = {
      id: `evt_test_${Date.now()}`,
      type: "test",
      timestamp: new Date().toISOString(),
      data: { message: "This is a test webhook delivery" },
    };

    const payloadStr = JSON.stringify(payload);
    const signature = createHmac("sha256", webhook.secret)
      .update(payloadStr)
      .digest("hex");

    const startTime = Date.now();
    let status = "failed";
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;

    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": `sha256=${signature}`,
          "X-Webhook-Event": "test",
        },
        body: payloadStr,
        signal: AbortSignal.timeout(10000),
      });
      statusCode = response.status;
      responseBody = await response.text().catch(() => null);
      status = response.ok ? "success" : "failed";
    } catch (error: unknown) {
      errorMessage = error instanceof Error ? error.message : "Unknown error";
    }

    const duration = Date.now() - startTime;

    await db.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        event: "test",
        payload: JSON.parse(JSON.stringify(payload)),
        status,
        statusCode,
        responseBody: responseBody?.substring(0, 1000),
        errorMessage,
        duration,
      },
    });

    return {
      success: status === "success",
      statusCode,
      duration,
      error: errorMessage,
    };
  },
};
