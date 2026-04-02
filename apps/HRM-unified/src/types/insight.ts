import type { InsightType, InsightSeverity } from ".prisma/hrm-unified-client";

export interface Insight {
  id: string;
  tenantId: string;
  type: InsightType;
  severity: InsightSeverity;
  category: string;
  title: string;
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  metrics?: Record<string, unknown> | null;
  suggestions?: string[] | null;
  isRead: boolean;
  isDismissed: boolean;
  dismissedBy?: string | null;
  dismissedAt?: Date | null;
  validFrom: Date;
  validUntil?: Date | null;
  createdAt: Date;
}

export interface InsightCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface InsightFilters {
  type?: InsightType;
  category?: string;
  severity?: InsightSeverity;
  includeDismissed?: boolean;
}
