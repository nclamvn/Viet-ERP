"use client";

import { useEffect, useState } from "react";
import { InsightCard, InsightSummary } from "@/components/insights";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Filter } from "lucide-react";
import type { Insight, InsightCounts } from "@/types/insight";
import type { InsightType, InsightSeverity } from ".prisma/hrm-unified-client";

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [counts, setCounts] = useState<InsightCounts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [filters, setFilters] = useState<{
    type?: InsightType;
    severity?: InsightSeverity;
    includeDismissed: boolean;
  }>({
    includeDismissed: false,
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.type) params.append("type", filters.type);
      if (filters.severity) params.append("severity", filters.severity);
      params.append("includeDismissed", String(filters.includeDismissed));

      const [insightsRes, countsRes] = await Promise.all([
        fetch(`/api/insights?${params}`),
        fetch("/api/insights/counts"),
      ]);

      if (insightsRes.ok) {
        const data = await insightsRes.json();
        setInsights(data.data);
      }

      if (countsRes.ok) {
        const data = await countsRes.json();
        setCounts(data.data);
      }
    } catch (error) {
      console.error("Fetch insights error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filters]);

  const handleDismiss = async (id: string) => {
    try {
      const response = await fetch(`/api/insights/${id}/dismiss`, {
        method: "POST",
      });

      if (response.ok) {
        setInsights((prev) => prev.filter((i) => i.id !== id));
        if (counts) {
          setCounts({ ...counts, total: counts.total - 1 });
        }
      }
    } catch (error) {
      console.error("Dismiss insight error:", error);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/insights/generate", {
        method: "POST",
      });

      if (response.ok) {
        fetchData();
      }
    } catch (error) {
      console.error("Generate insights error:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Smart Insights</h1>
          <p className="text-muted-foreground">
            Phân tích và cảnh báo thông minh từ dữ liệu nhân sự
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Tạo Insights mới
        </Button>
      </div>

      {/* Summary */}
      {counts && <InsightSummary counts={counts} />}

      {/* Filters */}
      <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
        <Filter className="h-5 w-5 text-muted-foreground" />
        <Select
          value={filters.type || "all"}
          onValueChange={(v) =>
            setFilters((prev) => ({
              ...prev,
              type: v === "all" ? undefined : (v as InsightType),
            }))
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Loại insight" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả loại</SelectItem>
            <SelectItem value="ANOMALY">Bất thường</SelectItem>
            <SelectItem value="TREND">Xu hướng</SelectItem>
            <SelectItem value="SUGGESTION">Gợi ý</SelectItem>
            <SelectItem value="WARNING">Cảnh báo</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.severity || "all"}
          onValueChange={(v) =>
            setFilters((prev) => ({
              ...prev,
              severity: v === "all" ? undefined : (v as InsightSeverity),
            }))
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Mức độ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả mức độ</SelectItem>
            <SelectItem value="CRITICAL">Nghiêm trọng</SelectItem>
            <SelectItem value="HIGH">Cao</SelectItem>
            <SelectItem value="MEDIUM">Trung bình</SelectItem>
            <SelectItem value="LOW">Thấp</SelectItem>
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.includeDismissed}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                includeDismissed: e.target.checked,
              }))
            }
            className="rounded"
          />
          Bao gồm đã bỏ qua
        </label>
      </div>

      {/* Insights List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : insights.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Không có insight nào</p>
          <p className="text-sm mt-1">
            Nhấn &quot;Tạo Insights mới&quot; để phân tích dữ liệu
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}
