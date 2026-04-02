import { prisma } from "@/lib/prisma";
import { NotificationType, Prisma } from ".prisma/hrm-client";

// Cache HR user IDs to avoid querying on every notification
let hrUserCache: { ids: string[]; expiresAt: number } | null = null;
const HR_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getHRUserIds(): Promise<string[]> {
  const now = Date.now();
  if (hrUserCache && now < hrUserCache.expiresAt) {
    return hrUserCache.ids;
  }
  const hrUsers = await prisma.user.findMany({
    where: {
      role: { in: ["HR_MANAGER", "HR_STAFF"] },
      isActive: true,
    },
    select: { id: true },
  });
  const ids = hrUsers.map((u) => u.id);
  hrUserCache = { ids, expiresAt: now + HR_CACHE_TTL };
  return ids;
}

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Prisma.InputJsonObject;
}

interface BulkNotificationInput {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Prisma.InputJsonObject;
}

export const notificationService = {
  async create(input: CreateNotificationInput) {
    return prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link || null,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  },

  async createForMany(input: BulkNotificationInput) {
    if (input.userIds.length === 0) return { count: 0 };
    return prisma.notification.createMany({
      data: input.userIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link || null,
        metadata: input.metadata ?? Prisma.JsonNull,
      })),
    });
  },

  async getByUser(userId: string, limit = 20) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
      take: limit,
    });
  },

  async countUnread(userId: string) {
    return prisma.notification.count({
      where: { userId, isRead: false },
    });
  },

  async markRead(notificationId: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  },

  async markAllRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  },

  async notifyHR(input: Omit<BulkNotificationInput, "userIds">) {
    const userIds = await getHRUserIds();
    return this.createForMany({ ...input, userIds });
  },

  async notifyDeptManagers(
    departmentId: string,
    input: Omit<BulkNotificationInput, "userIds">,
  ) {
    const dept = await prisma.department.findUnique({
      where: { id: departmentId },
      select: {
        manager: {
          select: { userId: true },
        },
      },
    });
    if (!dept?.manager?.userId) return { count: 0 };
    return this.createForMany({
      ...input,
      userIds: [dept.manager.userId],
    });
  },
};
