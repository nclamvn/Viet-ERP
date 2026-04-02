import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST NOTIFICATIONS (paginated, filtered for current user)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: NotificationQueryDto, userId: string) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { type, status, channel, search, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    // Build where clause - always scoped to current user
    const where: Prisma.NotificationWhereInput = { userId };

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (channel) {
      where.channel = channel;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = ['createdAt', 'type', 'status', 'title'];
    const orderBy: Prisma.NotificationOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take,
        orderBy,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE NOTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('You do not have access to this notification');
    }

    return notification;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET UNREAD COUNT
  // ═══════════════════════════════════════════════════════════════════════════
  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: {
        userId,
        status: 'UNREAD',
      },
    });

    return { unreadCount: count };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE NOTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: {
        companyId: dto.companyId,
        userId: dto.userId,
        type: dto.type,
        channel: dto.channel || 'IN_APP',
        status: 'UNREAD',
        title: dto.title,
        message: dto.message,
        data: dto.data || undefined,
        actionUrl: dto.actionUrl,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        sentAt: new Date(),
      },
    });

    this.logger.log(`Notification created: ${notification.id} for user ${dto.userId}`);

    return notification;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MARK AS READ
  // ═══════════════════════════════════════════════════════════════════════════
  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('You do not have access to this notification');
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: {
        status: 'READ',
        readAt: new Date(),
      },
    });

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MARK ALL AS READ
  // ═══════════════════════════════════════════════════════════════════════════
  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        status: 'UNREAD',
      },
      data: {
        status: 'READ',
        readAt: new Date(),
      },
    });

    this.logger.log(`Marked ${result.count} notifications as read for user ${userId}`);

    return { updated: result.count };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DISMISS NOTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  async dismissNotification(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('You do not have access to this notification');
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { status: 'DISMISSED' },
    });

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ARCHIVE NOTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  async archiveNotification(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('You do not have access to this notification');
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE NOTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  async delete(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('You do not have access to this notification');
    }

    await this.prisma.notification.delete({
      where: { id },
    });

    this.logger.log(`Notification deleted: ${id} by user ${userId}`);

    return { success: true, message: 'Notification deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET PREFERENCES
  // ═══════════════════════════════════════════════════════════════════════════
  async getPreferences(userId: string) {
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: { notificationType: 'asc' },
    });

    return preferences;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE PREFERENCES (upsert using @@unique([userId, notificationType]))
  // ═══════════════════════════════════════════════════════════════════════════
  async updatePreferences(dto: UpdatePreferencesDto, userId: string) {
    const preference = await this.prisma.notificationPreference.upsert({
      where: {
        userId_notificationType: {
          userId,
          notificationType: dto.notificationType,
        },
      },
      update: {
        channels: dto.channels,
        isEnabled: dto.isEnabled,
        quietHoursStart: dto.quietHoursStart,
        quietHoursEnd: dto.quietHoursEnd,
        timezone: dto.timezone,
      },
      create: {
        userId,
        notificationType: dto.notificationType,
        channels: dto.channels || ['IN_APP'],
        isEnabled: dto.isEnabled ?? true,
        quietHoursStart: dto.quietHoursStart,
        quietHoursEnd: dto.quietHoursEnd,
        timezone: dto.timezone,
      },
    });

    this.logger.log(`Preferences updated for user ${userId}, type ${dto.notificationType}`);

    return preference;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEND BULK NOTIFICATIONS (for internal use)
  // ═══════════════════════════════════════════════════════════════════════════
  async sendBulk(
    notifications: Array<{
      companyId: string;
      userId: string;
      type: string;
      title: string;
      message: string;
      channel?: string;
      data?: object;
      actionUrl?: string;
    }>,
  ) {
    const now = new Date();

    const result = await this.prisma.notification.createMany({
      data: notifications.map((n) => ({
        companyId: n.companyId,
        userId: n.userId,
        type: n.type as any,
        channel: (n.channel as any) || 'IN_APP',
        status: 'UNREAD' as const,
        title: n.title,
        message: n.message,
        data: n.data || undefined,
        actionUrl: n.actionUrl,
        sentAt: now,
      })),
    });

    this.logger.log(`Bulk notifications sent: ${result.count} notifications created`);

    return { created: result.count };
  }
}
