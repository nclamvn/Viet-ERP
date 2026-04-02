"use client";

import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { Bell, CheckCircle, Clock, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NotificationType } from ".prisma/hrm-ai-client";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  link?: string | null;
  createdAt: string | Date;
}

interface NotificationListProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onNotificationClick?: (notification: Notification) => void;
}

const NOTIFICATION_ICONS: Record<NotificationType, React.ReactNode> = {
  REQUEST_SUBMITTED: <Bell className="h-5 w-5 text-blue-500" />,
  PENDING_APPROVAL: <Clock className="h-5 w-5 text-amber-500" />,
  REQUEST_APPROVED: <CheckCircle className="h-5 w-5 text-green-500" />,
  REQUEST_REJECTED: <XCircle className="h-5 w-5 text-red-500" />,
  REQUEST_CANCELLED: <XCircle className="h-5 w-5 text-gray-500" />,
  DELEGATION_ASSIGNED: <Info className="h-5 w-5 text-purple-500" />,
  BALANCE_LOW: <Bell className="h-5 w-5 text-orange-500" />,
  GENERAL: <Info className="h-5 w-5 text-gray-500" />,
};

export function NotificationList({
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onNotificationClick,
}: NotificationListProps) {
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-semibold">Thông báo</h3>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onMarkAllAsRead}>
            Đánh dấu đã đọc tất cả
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Bell className="h-12 w-12 mb-2 opacity-50" />
            <p>Không có thông báo nào</p>
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  "flex gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors",
                  !notification.isRead && "bg-muted/30",
                )}
                onClick={() => {
                  if (!notification.isRead) {
                    onMarkAsRead(notification.id);
                  }
                  onNotificationClick?.(notification);
                }}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {NOTIFICATION_ICONS[notification.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm",
                      !notification.isRead && "font-medium",
                    )}
                  >
                    {notification.title}
                  </p>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {notification.message}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(notification.createdAt), {
                      addSuffix: true,
                      locale: vi,
                    })}
                  </p>
                </div>
                {!notification.isRead && (
                  <div className="flex-shrink-0">
                    <div className="h-2 w-2 rounded-full bg-blue-500" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
