// src/stores/notification-store.ts
// Notification Store with AI-powered features

import { create } from "zustand";
import type { NotificationType } from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type NotificationPriority = "critical" | "high" | "medium" | "low";
export type NotificationCategory =
  | "approval"
  | "system"
  | "ai_insight"
  | "reminder"
  | "update";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  link?: string | null;
  actionUrl?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string | Date;
  // AI-enhanced fields
  priority?: NotificationPriority;
  category?: NotificationCategory;
  aiSummary?: string;
  suggestedActions?: SuggestedAction[];
  sentiment?: "positive" | "neutral" | "negative" | "urgent";
}

export interface SuggestedAction {
  id: string;
  label: string;
  action: "navigate" | "approve" | "reject" | "dismiss" | "snooze" | "view";
  url?: string;
  variant?: "default" | "primary" | "destructive";
}

export interface AIInsight {
  id: string;
  type: "trend" | "anomaly" | "prediction" | "recommendation";
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  actionUrl?: string;
  createdAt: Date;
  isRead: boolean;
}

export interface NotificationPreferences {
  sound: boolean;
  desktop: boolean;
  email: boolean;
  pushNotifications: boolean;
  groupByCategory: boolean;
  showAIInsights: boolean;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
}

interface NotificationState {
  // Data
  notifications: Notification[];
  aiInsights: AIInsight[];
  unreadCount: number;

  // UI State
  isOpen: boolean;
  isLoading: boolean;
  activeTab: "all" | "unread" | "ai_insights";
  filter: NotificationCategory | "all";

  // Preferences
  preferences: NotificationPreferences;

  // Actions
  setIsOpen: (isOpen: boolean) => void;
  setActiveTab: (tab: "all" | "unread" | "ai_insights") => void;
  setFilter: (filter: NotificationCategory | "all") => void;
  setNotifications: (notifications: Notification[]) => void;
  setAIInsights: (insights: AIInsight[]) => void;
  setUnreadCount: (count: number) => void;
  setIsLoading: (loading: boolean) => void;

  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  dismissNotification: (id: string) => void;
  snoozeNotification: (id: string, duration: number) => void;

  updatePreferences: (prefs: Partial<NotificationPreferences>) => void;

  // AI-enhanced actions
  addAIInsight: (insight: AIInsight) => void;
  dismissAIInsight: (id: string) => void;
  getFilteredNotifications: () => Notification[];
  getGroupedNotifications: () => Record<NotificationCategory, Notification[]>;
}

// ═══════════════════════════════════════════════════════════════
// AI Helper Functions
// ═══════════════════════════════════════════════════════════════

function inferPriority(notification: Notification): NotificationPriority {
  const type = notification.type;
  const message = notification.message.toLowerCase();

  // Critical priority
  if (
    type === "PENDING_APPROVAL" ||
    message.includes("khẩn") ||
    message.includes("urgent")
  ) {
    return "critical";
  }

  // High priority
  if (type === "REQUEST_REJECTED" || type === "BALANCE_LOW") {
    return "high";
  }

  // Medium priority
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

function inferSentiment(
  notification: Notification,
): "positive" | "neutral" | "negative" | "urgent" {
  switch (notification.type) {
    case "REQUEST_APPROVED":
      return "positive";
    case "REQUEST_REJECTED":
      return "negative";
    case "PENDING_APPROVAL":
    case "BALANCE_LOW":
      return "urgent";
    default:
      return "neutral";
  }
}

function generateSuggestedActions(
  notification: Notification,
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  switch (notification.type) {
    case "PENDING_APPROVAL":
      actions.push(
        { id: "1", label: "Duyệt", action: "approve", variant: "primary" },
        { id: "2", label: "Từ chối", action: "reject", variant: "destructive" },
        {
          id: "3",
          label: "Xem chi tiết",
          action: "view",
          url: notification.actionUrl || undefined,
        },
      );
      break;
    case "REQUEST_APPROVED":
    case "REQUEST_REJECTED":
      actions.push({
        id: "1",
        label: "Xem chi tiết",
        action: "view",
        url: notification.actionUrl || undefined,
      });
      break;
    case "BALANCE_LOW":
      actions.push(
        {
          id: "1",
          label: "Đăng ký nghỉ phép",
          action: "navigate",
          url: "/leave/request",
          variant: "primary",
        },
        {
          id: "2",
          label: "Xem số dư",
          action: "navigate",
          url: "/leave/balances",
        },
      );
      break;
    default:
      if (notification.actionUrl) {
        actions.push({
          id: "1",
          label: "Xem",
          action: "view",
          url: notification.actionUrl,
        });
      }
  }

  return actions;
}

function enhanceNotification(notification: Notification): Notification {
  return {
    ...notification,
    priority: notification.priority || inferPriority(notification),
    category: notification.category || inferCategory(notification),
    sentiment: notification.sentiment || inferSentiment(notification),
    suggestedActions:
      notification.suggestedActions || generateSuggestedActions(notification),
  };
}

// ═══════════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════════

const defaultPreferences: NotificationPreferences = {
  sound: true,
  desktop: true,
  email: true,
  pushNotifications: false,
  groupByCategory: true,
  showAIInsights: true,
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
  },
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  // Initial state
  notifications: [],
  aiInsights: [],
  unreadCount: 0,
  isOpen: false,
  isLoading: false,
  activeTab: "all",
  filter: "all",
  preferences: defaultPreferences,

  // Actions
  setIsOpen: (isOpen) => set({ isOpen }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setFilter: (filter) => set({ filter }),

  setNotifications: (notifications) =>
    set({
      notifications: notifications.map(enhanceNotification),
    }),

  setAIInsights: (aiInsights) => set({ aiInsights }),
  setUnreadCount: (unreadCount) => set({ unreadCount }),
  setIsLoading: (isLoading) => set({ isLoading }),

  markAsRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n,
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    })),

  markAllAsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    })),

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  snoozeNotification: (id, duration) => {
    // In a real app, this would schedule a reminder
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  updatePreferences: (prefs) =>
    set((state) => ({
      preferences: { ...state.preferences, ...prefs },
    })),

  addAIInsight: (insight) =>
    set((state) => ({
      aiInsights: [insight, ...state.aiInsights],
    })),

  dismissAIInsight: (id) =>
    set((state) => ({
      aiInsights: state.aiInsights.filter((i) => i.id !== id),
    })),

  getFilteredNotifications: () => {
    const { notifications, activeTab, filter } = get();
    let filtered = [...notifications];

    // Filter by read status
    if (activeTab === "unread") {
      filtered = filtered.filter((n) => !n.isRead);
    }

    // Filter by category
    if (filter !== "all") {
      filtered = filtered.filter((n) => n.category === filter);
    }

    // Sort by priority and date
    filtered.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const priorityDiff =
        priorityOrder[a.priority || "low"] - priorityOrder[b.priority || "low"];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return filtered;
  },

  getGroupedNotifications: () => {
    const notifications = get().getFilteredNotifications();
    const grouped: Record<NotificationCategory, Notification[]> = {
      approval: [],
      system: [],
      ai_insight: [],
      reminder: [],
      update: [],
    };

    notifications.forEach((n) => {
      const category = n.category || "update";
      grouped[category].push(n);
    });

    return grouped;
  },
}));
