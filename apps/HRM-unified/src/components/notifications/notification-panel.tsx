"use client";

import { useState, useEffect, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import {
  Bell,
  CheckCircle,
  Clock,
  XCircle,
  Info,
  AlertTriangle,
  Sparkles,
  TrendingUp,
  Settings,
  Volume2,
  VolumeX,
  Filter,
  Check,
  X,
  ChevronRight,
  Zap,
  Brain,
  BellOff,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useNotificationStore,
  type Notification,
  type NotificationPriority,
  type NotificationCategory,
  type AIInsight,
} from "@/stores/notification-store";
import type { NotificationType } from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// Constants & Icons
// ═══════════════════════════════════════════════════════════════

const NOTIFICATION_ICONS: Record<NotificationType, React.ReactNode> = {
  REQUEST_SUBMITTED: <Bell className="h-4 w-4 text-blue-500" />,
  PENDING_APPROVAL: <Clock className="h-4 w-4 text-amber-500" />,
  REQUEST_APPROVED: <CheckCircle className="h-4 w-4 text-green-500" />,
  REQUEST_REJECTED: <XCircle className="h-4 w-4 text-red-500" />,
  REQUEST_CANCELLED: <XCircle className="h-4 w-4 text-muted-foreground" />,
  DELEGATION_ASSIGNED: <Info className="h-4 w-4 text-purple-500" />,
  BALANCE_LOW: <AlertTriangle className="h-4 w-4 text-orange-500" />,
  GENERAL: <Info className="h-4 w-4 text-muted-foreground" />,
};

const PRIORITY_COLORS: Record<NotificationPriority, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-blue-500",
  low: "bg-muted-foreground",
};

const PRIORITY_LABELS: Record<NotificationPriority, string> = {
  critical: "Khẩn cấp",
  high: "Quan trọng",
  medium: "Bình thường",
  low: "Thấp",
};

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  approval: "Phê duyệt",
  system: "Hệ thống",
  ai_insight: "AI Insights",
  reminder: "Nhắc nhở",
  update: "Cập nhật",
};

const CATEGORY_ICONS: Record<NotificationCategory, React.ReactNode> = {
  approval: <CheckCircle className="h-3.5 w-3.5" />,
  system: <Settings className="h-3.5 w-3.5" />,
  ai_insight: <Brain className="h-3.5 w-3.5" />,
  reminder: <Clock className="h-3.5 w-3.5" />,
  update: <Info className="h-3.5 w-3.5" />,
};

const INSIGHT_ICONS: Record<AIInsight["type"], React.ReactNode> = {
  trend: <TrendingUp className="h-4 w-4 text-blue-500" />,
  anomaly: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  prediction: <Brain className="h-4 w-4 text-purple-500" />,
  recommendation: <Sparkles className="h-4 w-4 text-green-500" />,
};

// ═══════════════════════════════════════════════════════════════
// Components
// ═══════════════════════════════════════════════════════════════

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string) => void;
  onAction: (notification: Notification, actionId: string) => void;
}

function NotificationItem({
  notification,
  onMarkAsRead,
  onDismiss,
  onSnooze,
  onAction,
}: NotificationItemProps) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className={cn(
        "group relative flex gap-3 p-3 transition-all duration-200 border-b border-border/50 last:border-0",
        !notification.isRead && "bg-primary/5",
        "hover:bg-muted/50",
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Priority indicator */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 rounded-l",
          PRIORITY_COLORS[notification.priority || "low"],
        )}
      />

      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5 ml-2">
        {NOTIFICATION_ICONS[notification.type]}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              "text-sm leading-snug",
              !notification.isRead && "font-semibold",
            )}
          >
            {notification.title}
          </p>
          {!notification.isRead && (
            <div className="flex-shrink-0 h-2 w-2 rounded-full bg-primary mt-1" />
          )}
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2">
          {notification.message}
        </p>

        {/* Meta info */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>
            {formatDistanceToNow(new Date(notification.createdAt), {
              addSuffix: true,
              locale: vi,
            })}
          </span>
          {notification.category && (
            <>
              <span>•</span>
              <Badge
                variant="outline"
                className="h-4 px-1 text-[10px] font-normal"
              >
                {CATEGORY_LABELS[notification.category]}
              </Badge>
            </>
          )}
        </div>

        {/* AI Suggested Actions */}
        {notification.suggestedActions &&
          notification.suggestedActions.length > 0 && (
            <div className="flex items-center gap-1.5 pt-1">
              {notification.suggestedActions.slice(0, 3).map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  variant={
                    action.variant === "primary"
                      ? "default"
                      : action.variant === "destructive"
                        ? "destructive"
                        : "outline"
                  }
                  className="h-6 px-2 text-[10px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAction(notification, action.id);
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
      </div>

      {/* Quick Actions (on hover) */}
      {showActions && (
        <div className="absolute right-2 top-2 flex items-center gap-1 bg-background/95 rounded-md shadow-sm border p-0.5">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkAsRead(notification.id);
                  }}
                >
                  <Check className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Đánh dấu đã đọc</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSnooze(notification.id);
                  }}
                >
                  <Clock className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Nhắc lại sau</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(notification.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Bỏ qua</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}

interface AIInsightCardProps {
  insight: AIInsight;
  onDismiss: (id: string) => void;
  onView: (insight: AIInsight) => void;
}

function AIInsightCard({ insight, onDismiss, onView }: AIInsightCardProps) {
  return (
    <div
      className={cn(
        "relative p-3 rounded-lg border transition-all duration-200 cursor-pointer",
        "bg-gradient-to-r from-primary/5 to-transparent",
        "hover:border-primary/30 hover:shadow-sm",
        insight.severity === "critical" && "border-red-500/50 from-red-500/10",
        insight.severity === "warning" &&
          "border-amber-500/50 from-amber-500/10",
      )}
      onClick={() => onView(insight)}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 p-1.5 rounded-md bg-background border">
          {INSIGHT_ICONS[insight.type]}
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-medium text-primary uppercase tracking-wider">
              AI Insight
            </span>
          </div>
          <p className="text-sm font-medium">{insight.title}</p>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {insight.description}
          </p>
        </div>

        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(insight.id);
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      <div className="absolute bottom-2 right-2">
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

export function NotificationPanel() {
  const {
    notifications,
    aiInsights,
    unreadCount,
    isOpen,
    isLoading,
    activeTab,
    filter,
    preferences,
    setIsOpen,
    setActiveTab,
    setFilter,
    setNotifications,
    setAIInsights,
    setUnreadCount,
    setIsLoading,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    snoozeNotification,
    dismissAIInsight,
    updatePreferences,
    getFilteredNotifications,
    getGroupedNotifications,
  } = useNotificationStore();

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const [notifRes, insightRes] = await Promise.all([
        fetch("/api/notifications?limit=30"),
        fetch("/api/insights?limit=5&status=active"),
      ]);

      if (notifRes.ok) {
        const data = await notifRes.json();
        const notifs = data.data?.data || data.data || [];
        setNotifications(notifs);
        setUnreadCount(notifs.filter((n: Notification) => !n.isRead).length);
      }

      if (insightRes.ok) {
        const data = await insightRes.json();
        const insights = (data.data || []).map(
          (i: AIInsight & { id: string }) => ({
            ...i,
            type: i.type || "recommendation",
            severity: i.severity || "info",
            createdAt: new Date(i.createdAt),
            isRead: false,
          }),
        );
        setAIInsights(insights);
      }
    } catch (error) {
      console.error("Error fetching notifications:", error);
    } finally {
      setIsLoading(false);
    }
  }, [setNotifications, setAIInsights, setUnreadCount, setIsLoading]);

  // Fetch unread count for badge
  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/unread-count");
      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.count || 0);
      }
    } catch {
      // Silent fail
    }
  }, [setUnreadCount]);

  // Initial fetch and polling
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch when panel opens
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // Handlers
  const handleMarkAsRead = async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      markAsRead(id);
    } catch {
      // Silent fail
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await fetch("/api/notifications/mark-all-read", { method: "POST" });
      markAllAsRead();
    } catch {
      // Silent fail
    }
  };

  const handleAction = (notification: Notification, actionId: string) => {
    const action = notification.suggestedActions?.find(
      (a) => a.id === actionId,
    );
    if (!action) return;

    if (!notification.isRead) {
      handleMarkAsRead(notification.id);
    }

    if (action.url) {
      window.location.href = action.url;
    }
  };

  const handleInsightView = (insight: AIInsight) => {
    if (insight.actionUrl) {
      window.location.href = insight.actionUrl;
    }
  };

  const filteredNotifications = getFilteredNotifications();
  const groupedNotifications = getGroupedNotifications();
  const hasUnread = unreadCount > 0;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative h-8 w-8 transition-all",
            hasUnread && "animate-pulse",
          )}
        >
          <Bell className={cn("h-4 w-4", hasUnread && "text-primary")} />
          {hasUnread && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow-sm">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[420px] p-0 shadow-2xl border-2"
        align="end"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-base">Thông báo</h3>
            {hasUnread && (
              <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                {unreadCount} mới
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Sound toggle */}
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() =>
                      updatePreferences({ sound: !preferences.sound })
                    }
                  >
                    {preferences.sound ? (
                      <Volume2 className="h-3.5 w-3.5" />
                    ) : (
                      <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    {preferences.sound ? "Tắt âm thanh" : "Bật âm thanh"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Filter dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7">
                  <Filter className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setFilter("all")}>
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      filter !== "all" && "invisible",
                    )}
                  />
                  Tất cả
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map(
                  (cat) => (
                    <DropdownMenuItem key={cat} onClick={() => setFilter(cat)}>
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          filter !== cat && "invisible",
                        )}
                      />
                      {CATEGORY_ICONS[cat]}
                      <span className="ml-2">{CATEGORY_LABELS[cat]}</span>
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* More options */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={handleMarkAllAsRead}
                  disabled={!hasUnread}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Đánh dấu tất cả đã đọc
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    updatePreferences({
                      showAIInsights: !preferences.showAIInsights,
                    })
                  }
                >
                  <Brain className="mr-2 h-4 w-4" />
                  {preferences.showAIInsights
                    ? "Ẩn AI Insights"
                    : "Hiện AI Insights"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  Cài đặt thông báo
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* AI Insights Section */}
        {preferences.showAIInsights && aiInsights.length > 0 && (
          <div className="px-3 py-2 border-b bg-gradient-to-r from-primary/5 via-transparent to-transparent">
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary">
                AI Insights
              </span>
            </div>
            <div className="space-y-2">
              {aiInsights.slice(0, 2).map((insight) => (
                <AIInsightCard
                  key={insight.id}
                  insight={insight}
                  onDismiss={dismissAIInsight}
                  onView={handleInsightView}
                />
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="px-3 py-2 border-b">
          <Tabs
            value={activeTab}
            onValueChange={(v) =>
              setActiveTab(v as "all" | "unread" | "ai_insights")
            }
          >
            <TabsList className="w-full h-8 bg-muted/50">
              <TabsTrigger value="all" className="flex-1 text-xs h-6">
                Tất cả
              </TabsTrigger>
              <TabsTrigger value="unread" className="flex-1 text-xs h-6">
                Chưa đọc
                {hasUnread && (
                  <span className="ml-1 text-[10px] text-primary">
                    ({unreadCount})
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="ai_insights" className="flex-1 text-xs h-6">
                <Brain className="h-3 w-3 mr-1" />
                AI
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Content */}
        <ScrollArea className="h-[400px]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <p className="text-sm text-muted-foreground mt-3">Đang tải...</p>
            </div>
          ) : activeTab === "ai_insights" ? (
            <div className="p-3 space-y-3">
              {aiInsights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Brain className="h-12 w-12 text-muted-foreground/30 mb-3" />
                  <p className="text-sm font-medium">Chưa có AI Insights</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    AI đang phân tích dữ liệu của bạn
                  </p>
                </div>
              ) : (
                aiInsights.map((insight) => (
                  <AIInsightCard
                    key={insight.id}
                    insight={insight}
                    onDismiss={dismissAIInsight}
                    onView={handleInsightView}
                  />
                ))
              )}
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <BellOff className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium">
                {activeTab === "unread"
                  ? "Không có thông báo chưa đọc"
                  : "Không có thông báo"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Bạn đã xem hết tất cả thông báo
              </p>
            </div>
          ) : preferences.groupByCategory ? (
            <div>
              {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map(
                (category) => {
                  const items = groupedNotifications[category];
                  if (items.length === 0) return null;

                  return (
                    <div key={category}>
                      <div className="sticky top-0 px-3 py-1.5 bg-muted/70 border-b flex items-center gap-1.5">
                        {CATEGORY_ICONS[category]}
                        <span className="text-xs font-semibold text-muted-foreground">
                          {CATEGORY_LABELS[category]}
                        </span>
                        <Badge
                          variant="secondary"
                          className="ml-auto h-4 px-1 text-[10px]"
                        >
                          {items.length}
                        </Badge>
                      </div>
                      {items.map((notification) => (
                        <NotificationItem
                          key={notification.id}
                          notification={notification}
                          onMarkAsRead={handleMarkAsRead}
                          onDismiss={dismissNotification}
                          onSnooze={(id) => snoozeNotification(id, 30)}
                          onAction={handleAction}
                        />
                      ))}
                    </div>
                  );
                },
              )}
            </div>
          ) : (
            <div>
              {filteredNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={handleMarkAsRead}
                  onDismiss={dismissNotification}
                  onSnooze={(id) => snoozeNotification(id, 30)}
                  onAction={handleAction}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/30">
          <Button variant="ghost" size="sm" className="text-xs h-7" asChild>
            <a href="/notifications">Xem tất cả</a>
          </Button>

          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            <span>Powered by AI</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
