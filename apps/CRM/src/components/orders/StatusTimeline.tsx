"use client";

import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { ArrowRight, Clock, User } from "lucide-react";
import { useTranslation } from "@/i18n";
import { getStatusColor } from "@/lib/orders/state-machine";
import type { OrderStatus } from ".prisma/crm-client";

interface StatusHistoryEntry {
  id: string;
  fromStatus: string;
  toStatus: string;
  note: string | null;
  createdAt: string | Date;
  user: { id: string; name: string | null } | null;
}

interface StatusTimelineProps {
  history: StatusHistoryEntry[];
}

export function StatusTimeline({ history }: StatusTimelineProps) {
  const { t } = useTranslation();

  if (history.length === 0) {
    return (
      <div className="text-sm text-[var(--crm-text-muted)] text-center py-4">
        {t("orders.noHistory")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {history.map((entry) => {
        const fromColor = getStatusColor(entry.fromStatus as OrderStatus);
        const toColor = getStatusColor(entry.toStatus as OrderStatus);

        return (
          <div key={entry.id} className="flex items-start gap-3 relative">
            {/* Timeline dot */}
            <div className="flex-shrink-0 mt-1">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: toColor }}
              />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-xs font-medium px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: `${fromColor}20`,
                    color: fromColor,
                  }}
                >
                  {t(`orderStatus.${statusKey(entry.fromStatus)}`)}
                </span>
                <ArrowRight className="h-3 w-3 text-[var(--crm-text-muted)]" />
                <span
                  className="text-xs font-medium px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: `${toColor}20`, color: toColor }}
                >
                  {t(`orderStatus.${statusKey(entry.toStatus)}`)}
                </span>
              </div>

              {entry.note && (
                <p className="text-xs text-[var(--crm-text-secondary)] mt-1">
                  {entry.note}
                </p>
              )}

              <div className="flex items-center gap-3 mt-1">
                {entry.user?.name && (
                  <span className="flex items-center gap-1 text-[10px] text-[var(--crm-text-muted)]">
                    <User className="h-3 w-3" />
                    {entry.user.name}
                  </span>
                )}
                <span className="flex items-center gap-1 text-[10px] text-[var(--crm-text-muted)]">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(entry.createdAt), {
                    addSuffix: true,
                    locale: vi,
                  })}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Map OrderStatus enum to i18n key suffix */
function statusKey(status: string): string {
  const map: Record<string, string> = {
    PENDING: "pending",
    CONFIRMED: "confirmed",
    IN_PRODUCTION: "inProduction",
    SHIPPED: "shipped",
    DELIVERED: "delivered",
    CANCELLED: "cancelled",
    REFUNDED: "refunded",
  };
  return map[status] ?? status.toLowerCase();
}
