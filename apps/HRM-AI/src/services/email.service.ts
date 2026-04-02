import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-ai-client";
import { sendEmail, renderTemplate } from "@/lib/email/client";

export const emailService = {
  async queueEmail(
    tenantId: string,
    to: string,
    templateCode: string,
    data: Record<string, unknown>,
    options?: { cc?: string; bcc?: string; scheduledFor?: Date },
  ) {
    const template = await db.emailTemplate.findUnique({
      where: { tenantId_code: { tenantId, code: templateCode } },
    });

    if (!template) throw new Error(`Template not found: ${templateCode}`);

    const subject = renderTemplate(template.subject, data);

    return db.emailQueue.create({
      data: {
        tenantId,
        to,
        cc: options?.cc,
        bcc: options?.bcc,
        subject,
        template: templateCode,
        data: JSON.parse(JSON.stringify(data)),
        scheduledFor: options?.scheduledFor,
      },
    });
  },

  async processQueue(tenantId: string, batchSize = 10) {
    const now = new Date();

    const emails = await db.emailQueue.findMany({
      where: {
        tenantId,
        status: "PENDING",
        attempts: { lt: 3 },
        OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
      },
      take: batchSize,
      orderBy: { createdAt: "asc" },
    });

    let sent = 0;
    for (const email of emails) {
      const template = await db.emailTemplate.findUnique({
        where: {
          tenantId_code: { tenantId: email.tenantId, code: email.template },
        },
      });

      if (!template) {
        await db.emailQueue.update({
          where: { id: email.id },
          data: {
            status: "FAILED",
            errorMessage: "Template not found",
            lastAttemptAt: new Date(),
          },
        });
        continue;
      }

      const html = renderTemplate(
        template.bodyHtml,
        email.data as Record<string, unknown>,
      );
      const text = template.bodyText
        ? renderTemplate(
            template.bodyText,
            email.data as Record<string, unknown>,
          )
        : undefined;

      const result = await sendEmail(
        email.tenantId,
        email.to,
        email.subject,
        html,
        text,
      );

      await db.emailQueue.update({
        where: { id: email.id },
        data: {
          status: result.success
            ? "SENT"
            : email.attempts >= 2
              ? "FAILED"
              : "PENDING",
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          sentAt: result.success ? new Date() : undefined,
          errorMessage: result.error,
        },
      });

      if (result.success) sent++;
    }

    return { processed: emails.length, sent };
  },

  async getTemplates(tenantId: string) {
    return db.emailTemplate.findMany({
      where: { tenantId },
      orderBy: { code: "asc" },
    });
  },

  async getTemplate(tenantId: string, id: string) {
    return db.emailTemplate.findFirst({ where: { id, tenantId } });
  },

  async createTemplate(
    tenantId: string,
    data: {
      code: string;
      name: string;
      description?: string;
      subject: string;
      bodyHtml: string;
      bodyText?: string;
      variables?: string[];
    },
  ) {
    return db.emailTemplate.create({
      data: { tenantId, ...data, variables: data.variables },
    });
  },

  async updateTemplate(
    tenantId: string,
    id: string,
    data: {
      name?: string;
      description?: string;
      subject?: string;
      bodyHtml?: string;
      bodyText?: string;
      variables?: string[];
      isActive?: boolean;
    },
  ) {
    return db.emailTemplate.updateMany({
      where: { id, tenantId, isSystem: false },
      data,
    });
  },

  async getQueue(tenantId: string, status?: string, page = 1, pageSize = 50) {
    const where: Prisma.EmailQueueWhereInput = { tenantId };
    if (status) where.status = status as Prisma.EnumEmailStatusFilter;

    const [data, total] = await Promise.all([
      db.emailQueue.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.emailQueue.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },
};
