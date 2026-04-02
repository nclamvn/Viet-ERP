// src/services/notification.service.ts
// Notification Service

import { db } from "@/lib/db";
import type { NotificationType, Prisma } from ".prisma/hrm-unified-client";
import type { PaginatedResponse } from "@/types";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: string;
  actionUrl?: string;
}

export interface NotificationFilters {
  isRead?: boolean;
  type?: NotificationType;
  page?: number;
  pageSize?: number;
}

// ═══════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════

export const notificationService = {
  /**
   * Create a notification
   */
  async create(tenantId: string, data: CreateNotificationInput) {
    return db.notification.create({
      data: {
        tenantId,
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        actionUrl: data.actionUrl,
      },
    });
  },

  /**
   * Create multiple notifications
   */
  async createMany(tenantId: string, notifications: CreateNotificationInput[]) {
    return db.notification.createMany({
      data: notifications.map((n) => ({
        tenantId,
        userId: n.userId,
        type: n.type,
        title: n.title,
        message: n.message,
        referenceType: n.referenceType,
        referenceId: n.referenceId,
        actionUrl: n.actionUrl,
      })),
    });
  },

  /**
   * Get notifications for a user
   */
  async getByUser(
    userId: string,
    filters: NotificationFilters = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<PaginatedResponse<any>> {
    const { isRead, type, page = 1, pageSize = 20 } = filters;
    const skip = (page - 1) * pageSize;

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(isRead !== undefined && { isRead }),
      ...(type && { type }),
    };

    const [data, total] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.notification.count({ where }),
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

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    return db.notification.count({
      where: { userId, isRead: false },
    });
  },

  /**
   * Mark a notification as read
   */
  async markAsRead(notificationId: string, userId: string) {
    return db.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  },

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId: string) {
    return db.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  },

  /**
   * Delete a notification
   */
  async delete(notificationId: string, userId: string) {
    return db.notification.deleteMany({
      where: { id: notificationId, userId },
    });
  },

  /**
   * Delete old notifications (cleanup)
   */
  async deleteOld(daysOld: number = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    return db.notification.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        isRead: true,
      },
    });
  },

  /**
   * Send notification for pending approval
   */
  async notifyPendingApproval(
    tenantId: string,
    approverId: string,
    approvalId: string,
    requesterName: string,
    requestType: string,
  ) {
    return this.create(tenantId, {
      userId: approverId,
      type: "PENDING_APPROVAL",
      title: "Yêu cầu cần duyệt",
      message: `${requesterName} có ${requestType} cần bạn xử lý`,
      referenceType: "APPROVAL",
      referenceId: approvalId,
      actionUrl: `/approvals/${approvalId}`,
    });
  },

  /**
   * Send notification for request approved
   */
  async notifyRequestApproved(
    tenantId: string,
    userId: string,
    requestType: string,
    referenceId: string,
  ) {
    return this.create(tenantId, {
      userId,
      type: "REQUEST_APPROVED",
      title: "Yêu cầu được duyệt",
      message: `${requestType} của bạn đã được duyệt`,
      referenceType: requestType,
      referenceId,
    });
  },

  /**
   * Send notification for request rejected
   */
  async notifyRequestRejected(
    tenantId: string,
    userId: string,
    requestType: string,
    referenceId: string,
    reason?: string,
  ) {
    return this.create(tenantId, {
      userId,
      type: "REQUEST_REJECTED",
      title: "Yêu cầu bị từ chối",
      message: reason
        ? `${requestType} của bạn bị từ chối: ${reason}`
        : `${requestType} của bạn bị từ chối`,
      referenceType: requestType,
      referenceId,
    });
  },
};
