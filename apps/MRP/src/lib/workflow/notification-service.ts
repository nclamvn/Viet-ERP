/**
 * Notification Service - Handles workflow notification delivery
 * Supports in-app and email notifications
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { NotificationChannel } from ".prisma/mrp-client";
import { emailService } from "@/lib/email/email-service";

export interface NotificationPayload {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  channel?: NotificationChannel;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface BulkNotificationPayload {
  recipientIds: string[];
  type: string;
  title: string;
  message: string;
  channel?: NotificationChannel;
  actionUrl?: string;
}

/**
 * Notification Service - manages notification delivery
 */
export class NotificationService {
  /**
   * Send a notification to a single recipient
   */
  async sendNotification(
    instanceId: string,
    payload: NotificationPayload,
  ): Promise<{ success: boolean; notificationId?: string; error?: string }> {
    try {
      const notification = await prisma.workflowNotification.create({
        data: {
          instanceId,
          recipientId: payload.recipientId,
          type: payload.type,
          channel: payload.channel || "IN_APP",
          title: payload.title,
          message: payload.message,
          actionUrl: payload.actionUrl,
          sentAt: new Date(),
          deliveryStatus: "sent",
        },
      });

      // If email channel, trigger email sending
      if (payload.channel === "EMAIL") {
        await this.sendEmailNotification(payload);
      }

      return { success: true, notificationId: notification.id };
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "notification-service", operation: "send" },
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send notification",
      };
    }
  }

  /**
   * Send notifications to multiple recipients
   */
  async sendBulkNotifications(
    instanceId: string,
    payload: BulkNotificationPayload,
  ): Promise<{ success: boolean; count: number }> {
    try {
      const notifications = payload.recipientIds.map((recipientId) => ({
        instanceId,
        recipientId,
        type: payload.type,
        channel: payload.channel || ("IN_APP" as NotificationChannel),
        title: payload.title,
        message: payload.message,
        actionUrl: payload.actionUrl,
        sentAt: new Date(),
        deliveryStatus: "sent",
      }));

      const result = await prisma.workflowNotification.createMany({
        data: notifications,
      });

      return { success: true, count: result.count };
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "notification-service", operation: "bulkSend" },
      );
      return { success: false, count: 0 };
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<boolean> {
    try {
      await prisma.workflowNotification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });
      return true;
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "notification-service", operation: "markRead" },
      );
      return false;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<number> {
    try {
      const result = await prisma.workflowNotification.updateMany({
        where: {
          recipientId: userId,
          readAt: null,
        },
        data: { readAt: new Date() },
      });
      return result.count;
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "notification-service", operation: "markAllRead" },
      );
      return 0;
    }
  }

  /**
   * Get unread notifications for a user
   */
  async getUnreadNotifications(userId: string, limit = 20) {
    return prisma.workflowNotification.findMany({
      where: {
        recipientId: userId,
        readAt: null,
      },
      include: {
        instance: {
          include: {
            workflow: { select: { name: true, code: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /**
   * Get all notifications for a user with pagination
   */
  async getNotifications(
    userId: string,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {},
  ) {
    const { page = 1, limit = 20, unreadOnly = false } = options;
    const skip = (page - 1) * limit;

    const where = {
      recipientId: userId,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [notifications, total] = await Promise.all([
      prisma.workflowNotification.findMany({
        where,
        include: {
          instance: {
            include: {
              workflow: { select: { name: true, code: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.workflowNotification.count({ where }),
    ]);

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    return prisma.workflowNotification.count({
      where: {
        recipientId: userId,
        readAt: null,
      },
    });
  }

  /**
   * Send reminder notifications for overdue approvals
   */
  async sendOverdueReminders(): Promise<{ sent: number; errors: number }> {
    let sent = 0;
    let errors = 0;

    try {
      // Find overdue pending approvals
      const overdueApprovals = await prisma.workflowApproval.findMany({
        where: {
          decision: "PENDING",
          dueDate: {
            lt: new Date(),
          },
          reminderCount: {
            lt: 3, // Max 3 reminders
          },
        },
        include: {
          instance: {
            include: {
              workflow: true,
            },
          },
          approver: true,
          step: true,
        },
      });

      for (const approval of overdueApprovals) {
        try {
          await this.sendNotification(approval.instanceId, {
            recipientId: approval.approverId,
            type: "REMINDER",
            title: `Overdue Approval: ${approval.instance.workflow.name}`,
            message: `Your approval for ${approval.step.name} is overdue. Please review as soon as possible.`,
            actionUrl: `/approvals/${approval.instanceId}`,
          });

          await prisma.workflowApproval.update({
            where: { id: approval.id },
            data: {
              reminderCount: { increment: 1 },
              lastReminderAt: new Date(),
            },
          });

          sent++;
        } catch {
          errors++;
        }
      }
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "notification-service", operation: "reminder" },
      );
    }

    return { sent, errors };
  }

  /**
   * Delete old notifications (cleanup)
   */
  async cleanupOldNotifications(daysOld = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await prisma.workflowNotification.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        readAt: { not: null },
      },
    });

    return result.count;
  }

  /**
   * Send email notification using the email service
   */
  private async sendEmailNotification(
    payload: NotificationPayload,
  ): Promise<void> {
    try {
      // Get user email
      const user = await prisma.user.findUnique({
        where: { id: payload.recipientId },
        select: { email: true, name: true },
      });

      if (!user?.email) {
        logger.warn("[NotificationService] No email for user", {
          context: "notification-service",
          recipientId: payload.recipientId,
        });
        return;
      }

      // Determine email type and send appropriate template
      const recipientName = user.name || "User";

      switch (payload.type) {
        case "APPROVAL_REQUEST":
          await emailService.sendWorkflowApproval(user.email, recipientName, {
            workflowName: payload.title,
            instanceId: (payload.metadata?.instanceId as string) || "",
            stepName: (payload.metadata?.stepName as string) || "Approval",
            submittedBy: (payload.metadata?.submittedBy as string) || "System",
          });
          break;

        case "REMINDER":
          await emailService.sendOverdueReminder(user.email, recipientName, {
            workflowName: payload.title,
            instanceId: (payload.metadata?.instanceId as string) || "",
            stepName: (payload.metadata?.stepName as string) || "Approval",
            dueDate:
              (payload.metadata?.dueDate as string) || new Date().toISOString(),
          });
          break;

        case "ALERT":
          await emailService.sendAlertNotification(user.email, recipientName, {
            alertType: (payload.metadata?.alertType as string) || "System",
            title: payload.title,
            message: payload.message,
            severity:
              (payload.metadata?.severity as
                | "low"
                | "medium"
                | "high"
                | "critical") || "medium",
            actionUrl: payload.actionUrl,
          });
          break;

        default:
          // Generic email for other notification types
          await emailService.send({
            to: user.email,
            subject: payload.title,
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                  .header { background: #30a46c; color: white; padding: 20px; text-align: center; }
                  .content { padding: 20px; background: #f9fafb; }
                  .button { display: inline-block; padding: 12px 24px; background: #30a46c; color: white; text-decoration: none; border-radius: 6px; margin-top: 16px; }
                  .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h1>VietERP MRP Notification</h1>
                  </div>
                  <div class="content">
                    <p>Hi ${recipientName},</p>
                    <h2>${payload.title}</h2>
                    <p>${payload.message}</p>
                    ${payload.actionUrl ? `<a href="${payload.actionUrl}" class="button">View Details</a>` : ""}
                  </div>
                  <div class="footer">
                    <p>This is an automated message from VietERP MRP System.</p>
                  </div>
                </div>
              </body>
              </html>
            `,
            text: `
Hi ${recipientName},

${payload.title}

${payload.message}

${payload.actionUrl ? `View details at: ${payload.actionUrl}` : ""}

This is an automated message from VietERP MRP System.
            `,
          });
          break;
      }

      logger.info("[NotificationService] Email sent successfully", {
        to: user.email,
      });
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "notification-service", operation: "sendEmail" },
      );
      // Don't throw - email failure shouldn't block notification creation
    }
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
