"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Bell,
  FileText,
  UserPlus,
  AlertTriangle,
  DollarSign,
  ClipboardCheck,
  Clock,
  Info,
  CheckCircle2,
  GitPullRequest,
  LogOut,
  Star,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import type { NotificationType } from ".prisma/hrm-client";

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

const typeIcons: Record<NotificationType, typeof Bell> = {
  CONTRACT_EXPIRY: AlertTriangle,
  EMPLOYEE_CREATED: UserPlus,
  EMPLOYEE_UPDATED: UserPlus,
  CONTRACT_CREATED: FileText,
  SALARY_UPDATED: DollarSign,
  REPORT_SUBMITTED: ClipboardCheck,
  REPORT_APPROVED: ClipboardCheck,
  REPORT_RETURNED: ClipboardCheck,
  OT_REQUEST: Clock,
  ONBOARDING_COMPLETE: CheckCircle2,
  HR_EVENT: GitPullRequest,
  OFFBOARDING: LogOut,
  PAYROLL: DollarSign,
  GENERAL: Info,
  REVIEW: Star,
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=20");
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json();
    },
    refetchInterval: 60000, // 1 minute (reduce DB load: 70 users × 1/min = 70 queries/min)
    staleTime: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/read-all", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  function handleNotificationClick(notification: Notification) {
    if (!notification.isRead) {
      markReadMutation.mutate(notification.id);
    }
    if (notification.link) {
      router.push(notification.link);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Thông báo</h3>
          {unreadCount > 0 && (
            <button
              className="text-xs text-blue-600 hover:underline"
              onClick={() => markAllReadMutation.mutate()}
            >
              Đọc tất cả
            </button>
          )}
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              Không có thông báo
            </div>
          ) : (
            notifications.map((n) => {
              const Icon = typeIcons[n.type] || Info;
              return (
                <button
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`flex w-full items-start gap-3 px-4 py-3 min-h-[48px] text-left hover:bg-slate-50 ${
                    !n.isRead ? "bg-blue-50/50" : ""
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <Icon
                      className={`h-4 w-4 ${!n.isRead ? "text-blue-600" : "text-slate-400"}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm ${!n.isRead ? "font-semibold" : "text-slate-700"}`}
                      >
                        {n.title}
                      </span>
                      {!n.isRead && (
                        <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">
                      {n.message}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatDistanceToNow(new Date(n.createdAt), {
                        addSuffix: true,
                        locale: vi,
                      })}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
