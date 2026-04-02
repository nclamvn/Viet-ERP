// src/hooks/use-overtime.ts
// Overtime request hooks

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  OvertimeFilters,
  OvertimeRequestWithRelations,
  PaginatedResponse,
} from "@/types";
import type { OvertimeRequest, DayType } from ".prisma/hrm-unified-client";

// Fetch functions
async function fetchOvertimeRequests(
  filters: OvertimeFilters,
): Promise<PaginatedResponse<OvertimeRequestWithRelations>> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.employeeId) params.set("employeeId", filters.employeeId);
  if (filters.departmentId) params.set("departmentId", filters.departmentId);
  if (filters.status) params.set("status", filters.status);
  if (filters.dateFrom) params.set("dateFrom", String(filters.dateFrom));
  if (filters.dateTo) params.set("dateTo", String(filters.dateTo));
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));

  const res = await fetch(`/api/overtime?${params}`);
  if (!res.ok) throw new Error("Failed to fetch overtime requests");
  const json = await res.json();
  if (json.meta) {
    return {
      data: json.data,
      pagination: {
        page: json.meta.page,
        pageSize: json.meta.pageSize ?? json.meta.limit,
        total: json.meta.total,
        totalPages: json.meta.totalPages,
      },
    };
  }
  return json;
}

async function fetchOvertimeById(
  id: string,
): Promise<OvertimeRequestWithRelations> {
  const res = await fetch(`/api/overtime/${id}`);
  if (!res.ok) throw new Error("Failed to fetch overtime request");
  const json = await res.json();
  return json.data ?? json;
}

// Hooks
export function useOvertimeRequests(filters: OvertimeFilters = {}) {
  return useQuery({
    queryKey: ["overtime", filters],
    queryFn: () => fetchOvertimeRequests(filters),
  });
}

export function useOvertimeById(id: string | undefined) {
  return useQuery({
    queryKey: ["overtime", id],
    queryFn: () => fetchOvertimeById(id!),
    enabled: !!id,
  });
}

export function usePendingOvertimeCount() {
  return useQuery({
    queryKey: ["overtime", "pending-count"],
    queryFn: async () => {
      const res = await fetch("/api/overtime?status=PENDING&pageSize=1");
      if (!res.ok) return 0;
      const data = await res.json();
      return data.pagination?.total || 0;
    },
  });
}

export function useCreateOvertime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      employeeId: string;
      date: Date;
      startTime: Date;
      endTime: Date;
      dayType?: DayType;
      reason: string;
      attachmentUrl?: string | null;
      notes?: string | null;
    }) => {
      const res = await fetch("/api/overtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create overtime request");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overtime"] });
    },
  });
}

export function useUpdateOvertime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<OvertimeRequest>;
    }) => {
      const res = await fetch(`/api/overtime/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update overtime request");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["overtime"] });
      queryClient.invalidateQueries({ queryKey: ["overtime", variables.id] });
    },
  });
}

export function useDeleteOvertime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/overtime/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete overtime request");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overtime"] });
    },
  });
}

export function useApproveOvertime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      actualHours,
    }: {
      id: string;
      actualHours?: number;
    }) => {
      const res = await fetch(`/api/overtime/${id}?action=approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualHours }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to approve overtime request");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["overtime"] });
      queryClient.invalidateQueries({ queryKey: ["overtime", variables.id] });
    },
  });
}

export function useRejectOvertime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(`/api/overtime/${id}?action=reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to reject overtime request");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["overtime"] });
      queryClient.invalidateQueries({ queryKey: ["overtime", variables.id] });
    },
  });
}

export function useCancelOvertime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/overtime/${id}?action=cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to cancel overtime request");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overtime"] });
    },
  });
}
