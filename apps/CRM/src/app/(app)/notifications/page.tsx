"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
} from "@/hooks/use-notifications";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Notification } from ".prisma/crm-client";

const TYPE_ICONS: Record<string, string> = {
  quote_accepted: "✅",
  quote_rejected: "❌",
  ticket_new: "🎫",
  ticket_reply: "💬",
  order_status_changed: "📦",
  quote_expiring: "⏰",
  campaign_sent: "📧",
};

export default function NotificationsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const limit = 20;

  const { data, isLoading } = useNotifications({
    page,
    limit,
    unread: showUnreadOnly,
  });
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const notifications = data?.notifications ?? [];
  const total = data?.total ?? 0;
  const unreadCount = data?.unreadCount ?? 0;
  const totalPages = Math.ceil(total / limit);

  const handleClick = (n: Notification) => {
    if (!n.read) {
      markAsRead.mutate(n.id);
    }
    if (n.link) {
      router.push(n.link);
    }
  };

  return (
    <PageShell
      title={t("notifications.title")}
      actions={
        unreadCount > 0 ? (
          <Button
            variant="outline"
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
            className="border-[var(--crm-border)] text-[var(--crm-text-secondary)] hover:text-[var(--crm-text-primary)] hover:bg-[var(--crm-bg-subtle)]"
          >
            <CheckCheck className="h-4 w-4 mr-1.5" />
            {t("notifications.markAllRead")}
          </Button>
        ) : undefined
      }
    >
      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setShowUnreadOnly(false);
            setPage(1);
          }}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
            !showUnreadOnly
              ? "bg-[#10B981]/10 text-[#10B981]"
              : "text-[var(--crm-text-secondary)] hover:text-[var(--crm-text-primary)] hover:bg-[var(--crm-bg-subtle)]",
          )}
        >
          {t("notifications.all")}
        </button>
        <button
          onClick={() => {
            setShowUnreadOnly(true);
            setPage(1);
          }}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
            showUnreadOnly
              ? "bg-[#10B981]/10 text-[#10B981]"
              : "text-[var(--crm-text-secondary)] hover:text-[var(--crm-text-primary)] hover:bg-[var(--crm-bg-subtle)]",
          )}
        >
          {t("notifications.unread")} {unreadCount > 0 && `(${unreadCount})`}
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-16 w-full bg-[var(--crm-bg-subtle)]"
            />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="glass-card-static py-16 flex flex-col items-center justify-center">
          <Bell className="h-12 w-12 text-[var(--crm-text-muted)]" />
          <p className="mt-4 text-sm font-medium text-[var(--crm-text-primary)]">
            {t("notifications.empty")}
          </p>
        </div>
      ) : (
        <>
          <div className="glass-card-static overflow-hidden divide-y divide-[var(--crm-border-subtle)]">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  "w-full text-left px-5 py-4 hover:bg-[var(--crm-bg-subtle)] transition-colors flex items-start gap-3",
                  !n.read && "bg-[var(--crm-bg-subtle)]/50",
                  n.link && "cursor-pointer",
                )}
              >
                {/* Unread indicator */}
                <div className="flex-shrink-0 mt-2">
                  {!n.read ? (
                    <div className="w-2 h-2 rounded-full bg-[#10B981]" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-[var(--crm-border)]" />
                  )}
                </div>

                {/* Icon */}
                <span className="flex-shrink-0 text-lg mt-0.5">
                  {TYPE_ICONS[n.type] || "🔔"}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm",
                      n.read
                        ? "text-[var(--crm-text-secondary)]"
                        : "text-[var(--crm-text-primary)] font-medium",
                    )}
                  >
                    {n.title}
                  </p>
                  <p className="text-xs text-[var(--crm-text-muted)] mt-0.5">
                    {n.message}
                  </p>
                </div>

                {/* Time */}
                <span className="flex-shrink-0 text-[10px] text-[var(--crm-text-muted)] mt-1">
                  {formatDistanceToNow(new Date(n.createdAt), {
                    addSuffix: true,
                    locale: vi,
                  })}
                </span>
              </button>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-[var(--crm-text-muted)]">
                {t("common.showing")} {(page - 1) * limit + 1}-
                {Math.min(page * limit, total)} {t("common.of")} {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="h-7 border-[var(--crm-border)] text-[var(--crm-text-secondary)] hover:text-[var(--crm-text-primary)]"
                >
                  {t("notifications.prev")}
                </Button>
                <span className="text-xs text-[var(--crm-text-secondary)]">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-7 border-[var(--crm-border)] text-[var(--crm-text-secondary)] hover:text-[var(--crm-text-primary)]"
                >
                  {t("notifications.next")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
