"use client";

import { useState, useEffect, useCallback } from "react";
import { formatDistanceToNow, format } from "date-fns";
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
  Filter,
  Check,
  X,
  ChevronRight,
  Zap,
  Brain,
  BellOff,
  Search,
  Trash2,
  Archive,
  RefreshCw,
  MoreVertical,
  CheckCheck,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { NotificationType } from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type NotificationPriority = "critical" | "high" | "medium" | "low";
type NotificationCategory =
  | "approval"
  | "system"
  | "ai_insight"
  | "reminder"
  | "update";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  actionUrl?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string | Date;
  priority?: NotificationPriority;
  category?: NotificationCategory;
}

interface AIInsight {
  id: string;
  type: "trend" | "anomaly" | "prediction" | "recommendation";
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  actionUrl?: string;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const NOTIFICATION_ICONS: Record<NotificationType, React.ReactNode> = {
  REQUEST_SUBMITTED: <Bell className="h-5 w-5 text-blue-500" />,
  PENDING_APPROVAL: <Clock className="h-5 w-5 text-amber-500" />,
  REQUEST_APPROVED: <CheckCircle className="h-5 w-5 text-green-500" />,
  REQUEST_REJECTED: <XCircle className="h-5 w-5 text-red-500" />,
  REQUEST_CANCELLED: <XCircle className="h-5 w-5 text-muted-foreground" />,
  DELEGATION_ASSIGNED: <Info className="h-5 w-5 text-purple-500" />,
  BALANCE_LOW: <AlertTriangle className="h-5 w-5 text-orange-500" />,
  GENERAL: <Info className="h-5 w-5 text-muted-foreground" />,
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

const CATEGORY_LABELS: Record<NotificationCategory | "all", string> = {
  all: "Tất cả",
  approval: "Phê duyệt",
  system: "Hệ thống",
  ai_insight: "AI Insights",
  reminder: "Nhắc nhở",
  update: "Cập nhật",
};

const INSIGHT_ICONS: Record<AIInsight["type"], React.ReactNode> = {
  trend: <TrendingUp className="h-5 w-5 text-blue-500" />,
  anomaly: <AlertTriangle className="h-5 w-5 text-amber-500" />,
  prediction: <Brain className="h-5 w-5 text-purple-500" />,
  recommendation: <Sparkles className="h-5 w-5 text-green-500" />,
};

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function inferPriority(notification: Notification): NotificationPriority {
  const type = notification.type;
  const message = notification.message.toLowerCase();

  if (
    type === "PENDING_APPROVAL" ||
    message.includes("khẩn") ||
    message.includes("urgent")
  ) {
    return "critical";
  }
  if (type === "REQUEST_REJECTED" || type === "BALANCE_LOW") {
    return "high";
  }
  if (type === "REQUEST_APPROVED" || type === "DELEGATION_ASSIGNED") {
    return "medium";
  }
  return "low";
}

function inferCategory(notification: Notification): NotificationCategory {
  switch (notification.type) {
    case "PENDING_APPROVAL":
    case "REQUEST_APPROVED":
    case "REQUEST_REJECTED":
    case "REQUEST_SUBMITTED":
    case "REQUEST_CANCELLED":
      return "approval";
    case "DELEGATION_ASSIGNED":
      return "system";
    case "BALANCE_LOW":
      return "reminder";
    default:
      return "update";
  }
}

// ═══════════════════════════════════════════════════════════════
// Components
// ═══════════════════════════════════════════════════════════════

interface NotificationRowProps {
  notification: Notification;
  selected: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}

function NotificationRow({
  notification,
  selected,
  onSelect,
  onMarkAsRead,
  onDelete,
}: NotificationRowProps) {
  const priority = notification.priority || inferPriority(notification);
  const category = notification.category || inferCategory(notification);

  return (
    <div
      className={cn(
        "group flex items-start gap-4 p-4 border-b transition-all duration-200",
        !notification.isRead && "bg-primary/5",
        "hover:bg-muted/50",
      )}
    >
      {/* Priority indicator */}
      <div
        className={cn(
          "w-1 h-full min-h-[60px] rounded-full",
          PRIORITY_COLORS[priority],
        )}
      />

      {/* Checkbox */}
      <Checkbox
        checked={selected}
        onCheckedChange={(checked) =>
          onSelect(notification.id, checked as boolean)
        }
        className="mt-1"
      />

      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">
        {NOTIFICATION_ICONS[notification.type]}
      </div>

      {/* Content */}
      <div
        className="flex-1 min-w-0 space-y-1 cursor-pointer"
        onClick={() => onMarkAsRead(notification.id)}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p
              className={cn("font-medium", !notification.isRead && "font-bold")}
            >
              {notification.title}
            </p>
            <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
              {notification.message}
            </p>
          </div>
          {!notification.isRead && (
            <div className="flex-shrink-0 h-2.5 w-2.5 rounded-full bg-primary mt-1.5" />
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {formatDistanceToNow(new Date(notification.createdAt), {
              addSuffix: true,
              locale: vi,
            })}
          </span>
          <Badge variant="outline" className="text-[10px] h-5">
            {CATEGORY_LABELS[category]}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] h-5",
              priority === "critical" && "border-red-500 text-red-500",
              priority === "high" && "border-orange-500 text-orange-500",
            )}
          >
            {PRIORITY_LABELS[priority]}
          </Badge>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!notification.isRead && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => onMarkAsRead(notification.id)}
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={() => onDelete(notification.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        {notification.actionUrl && (
          <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
            <a href={notification.actionUrl}>
              <ChevronRight className="h-4 w-4" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function AIInsightCard({ insight }: { insight: AIInsight }) {
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-background border">
            {INSIGHT_ICONS[insight.type]}
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                AI{" "}
                {insight.type === "trend"
                  ? "Xu hướng"
                  : insight.type === "anomaly"
                    ? "Bất thường"
                    : insight.type === "prediction"
                      ? "Dự đoán"
                      : "Đề xuất"}
              </span>
              <Badge
                variant={
                  insight.severity === "critical"
                    ? "destructive"
                    : insight.severity === "warning"
                      ? "secondary"
                      : "outline"
                }
                className="text-[10px] h-4"
              >
                {insight.severity === "critical"
                  ? "Nghiêm trọng"
                  : insight.severity === "warning"
                    ? "Cảnh báo"
                    : "Thông tin"}
              </Badge>
            </div>
            <h4 className="font-semibold">{insight.title}</h4>
            <p className="text-sm text-muted-foreground">
              {insight.description}
            </p>
            {insight.actionUrl && (
              <Button
                variant="link"
                className="h-auto p-0 text-primary"
                asChild
              >
                <a href={insight.actionUrl}>
                  Xem chi tiết <ChevronRight className="h-3 w-3 ml-1" />
                </a>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [aiInsights, setAIInsights] = useState<AIInsight[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "unread" | "read">("all");
  const [categoryFilter, setCategoryFilter] = useState<
    NotificationCategory | "all"
  >("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Settings state
  const [settings, setSettings] = useState({
    sound: true,
    desktop: true,
    email: true,
    groupByCategory: true,
    showAIInsights: true,
  });

  // Fetch data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [notifRes, insightRes] = await Promise.all([
        fetch("/api/notifications?limit=100"),
        fetch("/api/insights?limit=10&status=active"),
      ]);

      if (notifRes.ok) {
        const data = await notifRes.json();
        const notifs = (data.data?.data || data.data || []).map(
          (n: Notification) => ({
            ...n,
            priority: inferPriority(n),
            category: inferCategory(n),
          }),
        );
        setNotifications(notifs);
      }

      if (insightRes.ok) {
        const data = await insightRes.json();
        setAIInsights(
          (data.data || []).map((i: AIInsight) => ({
            ...i,
            createdAt: new Date(i.createdAt),
          })),
        );
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter notifications
  const filteredNotifications = notifications.filter((n) => {
    // Tab filter
    if (activeTab === "unread" && n.isRead) return false;
    if (activeTab === "read" && !n.isRead) return false;

    // Category filter
    if (categoryFilter !== "all") {
      const category = n.category || inferCategory(n);
      if (category !== categoryFilter) return false;
    }

    // Search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        n.title.toLowerCase().includes(query) ||
        n.message.toLowerCase().includes(query)
      );
    }

    return true;
  });

  // Stats
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const criticalCount = notifications.filter(
    (n) => (n.priority || inferPriority(n)) === "critical" && !n.isRead,
  ).length;

  // Handlers
  const handleMarkAsRead = async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      );
    } catch {
      // Silent fail
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await fetch("/api/notifications/mark-all-read", { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      // Silent fail
    }
  };

  const handleMarkSelectedAsRead = async () => {
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await handleMarkAsRead(id);
    }
    setSelectedIds(new Set());
  };

  const handleDelete = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    setNotifications((prev) => prev.filter((n) => !selectedIds.has(n.id)));
    setSelectedIds(new Set());
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(filteredNotifications.map((n) => n.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelect = (id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Bell className="h-8 w-8 text-primary" />
            Thông báo
          </h1>
          <p className="text-muted-foreground mt-1">
            Quản lý tất cả thông báo và AI insights của bạn
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchData}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4 mr-2" />
            Cài đặt
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Chưa đọc</p>
                <p className="text-2xl font-bold">{unreadCount}</p>
              </div>
              <Bell className="h-8 w-8 text-primary opacity-80" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Khẩn cấp</p>
                <p className="text-2xl font-bold text-red-500">
                  {criticalCount}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500 opacity-80" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">AI Insights</p>
                <p className="text-2xl font-bold text-purple-500">
                  {aiInsights.length}
                </p>
              </div>
              <Brain className="h-8 w-8 text-purple-500 opacity-80" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tổng cộng</p>
                <p className="text-2xl font-bold">{notifications.length}</p>
              </div>
              <Archive className="h-8 w-8 text-muted-foreground opacity-80" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Insights Section */}
      {settings.showAIInsights && aiInsights.length > 0 && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">AI Insights</CardTitle>
            </div>
            <CardDescription>
              Phân tích thông minh dựa trên dữ liệu HR của bạn
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {aiInsights.slice(0, 4).map((insight) => (
                <AIInsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            {/* Tabs */}
            <Tabs
              value={activeTab}
              onValueChange={(v) =>
                setActiveTab(v as "all" | "unread" | "read")
              }
            >
              <TabsList>
                <TabsTrigger value="all">
                  Tất cả{" "}
                  <Badge variant="secondary" className="ml-1.5">
                    {notifications.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="unread">
                  Chưa đọc{" "}
                  <Badge variant="secondary" className="ml-1.5">
                    {unreadCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="read">Đã đọc</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Tìm kiếm thông báo..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-[250px]"
                />
              </div>
              <Select
                value={categoryFilter}
                onValueChange={(v) =>
                  setCategoryFilter(v as NotificationCategory | "all")
                }
              >
                <SelectTrigger className="w-[150px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Danh mục" />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(CATEGORY_LABELS) as (
                      | NotificationCategory
                      | "all"
                    )[]
                  ).map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        {/* Bulk Actions */}
        {selectedIds.size > 0 && (
          <div className="px-6 pb-3">
            <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
              <span className="text-sm font-medium">
                {selectedIds.size} được chọn
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleMarkSelectedAsRead}
                >
                  <CheckCheck className="h-4 w-4 mr-1.5" />
                  Đánh dấu đã đọc
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteSelected}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Xóa
                </Button>
              </div>
            </div>
          </div>
        )}

        <CardContent className="p-0">
          {/* Select All Header */}
          <div className="flex items-center gap-4 px-4 py-2 bg-muted/50 border-y">
            <Checkbox
              checked={
                selectedIds.size === filteredNotifications.length &&
                filteredNotifications.length > 0
              }
              onCheckedChange={handleSelectAll}
            />
            <span className="text-sm text-muted-foreground">
              {selectedIds.size > 0
                ? `${selectedIds.size} được chọn`
                : "Chọn tất cả"}
            </span>
            {unreadCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={handleMarkAllAsRead}
              >
                <CheckCheck className="h-4 w-4 mr-1.5" />
                Đánh dấu tất cả đã đọc
              </Button>
            )}
          </div>

          {/* Notifications List */}
          <ScrollArea className="h-[600px]">
            {isLoading ? (
              <div className="p-4 space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-start gap-4 p-4">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <BellOff className="h-16 w-16 text-muted-foreground/30 mb-4" />
                <p className="text-lg font-medium">Không có thông báo</p>
                <p className="text-sm text-muted-foreground">
                  {searchQuery
                    ? "Không tìm thấy kết quả phù hợp"
                    : "Bạn đã xem hết tất cả thông báo"}
                </p>
              </div>
            ) : (
              filteredNotifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  selected={selectedIds.has(notification.id)}
                  onSelect={handleSelect}
                  onMarkAsRead={handleMarkAsRead}
                  onDelete={handleDelete}
                />
              ))
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Cài đặt thông báo
            </DialogTitle>
            <DialogDescription>
              Tùy chỉnh cách bạn nhận và hiển thị thông báo
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Sound */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {settings.sound ? (
                  <Volume2 className="h-5 w-5" />
                ) : (
                  <VolumeX className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <Label>Âm thanh</Label>
                  <p className="text-sm text-muted-foreground">
                    Phát âm thanh khi có thông báo mới
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.sound}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, sound: checked })
                }
              />
            </div>

            {/* Desktop */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5" />
                <div>
                  <Label>Thông báo desktop</Label>
                  <p className="text-sm text-muted-foreground">
                    Hiển thị thông báo trên màn hình
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.desktop}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, desktop: checked })
                }
              />
            </div>

            {/* Email */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Star className="h-5 w-5" />
                <div>
                  <Label>Email</Label>
                  <p className="text-sm text-muted-foreground">
                    Nhận email cho thông báo quan trọng
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.email}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, email: checked })
                }
              />
            </div>

            {/* AI Insights */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Brain className="h-5 w-5 text-purple-500" />
                <div>
                  <Label>AI Insights</Label>
                  <p className="text-sm text-muted-foreground">
                    Hiển thị phân tích AI thông minh
                  </p>
                </div>
              </div>
              <Switch
                checked={settings.showAIInsights}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, showAIInsights: checked })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Hủy
            </Button>
            <Button onClick={() => setSettingsOpen(false)}>Lưu thay đổi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
