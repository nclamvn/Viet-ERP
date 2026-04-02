import { prisma } from "@/lib/prisma";
import { NOTIFICATION_TYPES, resolveTemplate } from "./types";
import type { NotificationTypeKey } from "./types";
import type { Notification } from ".prisma/crm-client";

// ── Create notification ─────────────────────────────────────────────

export async function createNotification(data: {
  userId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
}): Promise<Notification> {
  return prisma.notification.create({
    data: {
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      link: data.link ?? null,
      metadata: data.metadata ? (data.metadata as any) : undefined,
    },
  });
}

// ── Notify a specific user ──────────────────────────────────────────

export async function notifyUser(
  userId: string,
  type: NotificationTypeKey,
  vars: Record<string, string>,
  link?: string,
): Promise<void> {
  const typeDef = NOTIFICATION_TYPES[type];
  const title = resolveTemplate(typeDef.titleTemplate, vars);
  const message = resolveTemplate(typeDef.messageTemplate, vars);

  await createNotification({
    userId,
    type: typeDef.key,
    title,
    message,
    link,
    metadata: vars,
  });
}

// ── Notify all users with a given role ──────────────────────────────

export async function notifyRole(
  role: "ADMIN" | "MANAGER",
  type: NotificationTypeKey,
  vars: Record<string, string>,
  link?: string,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { role },
    select: { id: true },
  });

  await Promise.all(users.map((user) => notifyUser(user.id, type, vars, link)));
}

// ── Unread count ────────────────────────────────────────────────────

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, read: false },
  });
}

// ── Mark as read ────────────────────────────────────────────────────

export async function markAsRead(
  notificationId: string,
  userId: string,
): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true, readAt: new Date() },
  });
}

// ── Mark all as read ────────────────────────────────────────────────

export async function markAllAsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true, readAt: new Date() },
  });
  return result.count;
}
