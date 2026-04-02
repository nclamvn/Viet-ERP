"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllAsRead,
} from "@/hooks/use-notifications";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Notification } from ".prisma/crm-client";

// Notification type → emoji icon mapping
const TYPE_ICONS: Record<string, string> = {
  quote_accepted: "✅",
  quote_rejected: "❌",
  ticket_new: "🎫",
  ticket_reply: "💬",
  order_status_changed: "📦",
  quote_expiring: "⏰",
  campaign_sent: "📧",
};

export function NotificationBell() {
  const router = useRouter();
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);

  const { data: unreadCount = 0 } = useUnreadCount(isAuthenticated);
  const { data } = useNotifications({ limit: 10, enabled: isAuthenticated });
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const notifications = data?.notifications ?? [];

  const handleClick = (notification: Notification) => {
    if (!notification.read) {
      markAsRead.mutate(notification.id);
    }
    if (notification.link) {
      setOpen(false);
      router.push(notification.link);
    }
  };

  const handleMarkAllRead = () => {
    markAllAsRead.mutate();
  };

  const displayCount = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-[var(--crm-text-secondary)] hover:text-[var(--crm-text-primary)] hover:bg-[var(--crm-bg-subtle)] relative"
        >
          <Bell className="w-[18px] h-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none px-1">
              {displayCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[380px] p-0 bg-[var(--crm-bg-card)] border-[var(--crm-border)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--crm-border)]">
          <h3 className="text-sm font-semibold text-[var(--crm-text-primary)]">
            {t("notifications.title")}
          </h3>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="flex items-center gap-1 text-xs text-[#10B981] hover:text-[#059669] transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {t("notifications.markAllRead")}
            </button>
          )}
        </div>

        {/* Notification list */}
        <div className="max-h-[400px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--crm-text-muted)]">
              {t("notifications.empty")}
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-[var(--crm-border-subtle)] hover:bg-[var(--crm-bg-subtle)] transition-colors flex items-start gap-3",
                  !n.read && "bg-[var(--crm-bg-subtle)]/50",
                )}
              >
                {/* Unread indicator */}
                <div className="flex-shrink-0 mt-1.5">
                  {!n.read ? (
                    <div className="w-2 h-2 rounded-full bg-[#10B981]" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-[var(--crm-border)]" />
                  )}
                </div>

                {/* Icon */}
                <span className="flex-shrink-0 text-base mt-0.5">
                  {TYPE_ICONS[n.type] || "🔔"}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm truncate",
                      n.read
                        ? "text-[var(--crm-text-secondary)]"
                        : "text-[var(--crm-text-primary)] font-medium",
                    )}
                  >
                    {n.title}
                  </p>
                  <p className="text-xs text-[var(--crm-text-muted)] mt-0.5 truncate">
                    {n.message}
                  </p>
                  <p className="text-[10px] text-[var(--crm-text-muted)] mt-1">
                    {formatDistanceToNow(new Date(n.createdAt), {
                      addSuffix: true,
                      locale: vi,
                    })}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--crm-border)] px-4 py-2.5">
          <button
            onClick={() => {
              setOpen(false);
              router.push("/notifications");
            }}
            className="w-full text-center text-xs font-medium text-[#10B981] hover:text-[#059669] transition-colors"
          >
            {t("notifications.viewAll")} →
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
