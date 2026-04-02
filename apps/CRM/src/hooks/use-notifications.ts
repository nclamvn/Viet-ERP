"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Notification } from ".prisma/crm-client";
import { authQueryConfig } from "@/lib/query-config";

// ── Types ────────────────────────────────────────────────────────────

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  total: number;
  page: number;
  limit: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Notifications list ──────────────────────────────────────────────

export function useNotifications(params?: {
  page?: number;
  limit?: number;
  unread?: boolean;
  enabled?: boolean;
}) {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 20;
  const unread = params?.unread ?? false;

  return useQuery<NotificationsResponse>({
    queryKey: ["notifications", { page, limit, unread }],
    queryFn: () => {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(unread && { unread: "true" }),
      });
      return fetchJson<NotificationsResponse>(`/api/notifications?${qs}`);
    },
    staleTime: 15_000,
    enabled: params?.enabled ?? true,
    ...authQueryConfig,
  });
}

// ── Unread count (polling every 30s) ────────────────────────────────

export function useUnreadCount(enabled = true) {
  return useQuery<number>({
    queryKey: ["notifications", "unreadCount"],
    queryFn: async () => {
      const data = await fetchJson<NotificationsResponse>(
        "/api/notifications?limit=1",
      );
      return data.unreadCount;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
    ...authQueryConfig,
  });
}

// ── Mark as read ────────────────────────────────────────────────────

export function useMarkAsRead() {
  const qc = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: (id) =>
      fetchJson<{ success: boolean }>(`/api/notifications/${id}/read`, {
        method: "PATCH",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

// ── Mark all as read ────────────────────────────────────────────────

export function useMarkAllAsRead() {
  const qc = useQueryClient();

  return useMutation<{ success: boolean; count: number }, Error, void>({
    mutationFn: () =>
      fetchJson<{ success: boolean; count: number }>(
        "/api/notifications/mark-all-read",
        {
          method: "POST",
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
