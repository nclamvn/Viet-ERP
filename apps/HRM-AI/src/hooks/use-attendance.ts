// src/hooks/use-attendance.ts
// Attendance management hooks

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AttendanceFilters,
  AttendanceWithRelations,
  PaginatedResponse,
  ClockInRequest,
  ClockOutRequest,
  ClockResponse,
} from "@/types";
import type { Attendance, AttendanceStatus } from ".prisma/hrm-ai-client";

// Fetch functions
async function fetchAttendance(
  filters: AttendanceFilters,
): Promise<PaginatedResponse<AttendanceWithRelations>> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.employeeId) params.set("employeeId", filters.employeeId);
  if (filters.departmentId) params.set("departmentId", filters.departmentId);
  if (filters.shiftId) params.set("shiftId", filters.shiftId);
  if (filters.status) params.set("status", filters.status);
  if (filters.dateFrom) params.set("dateFrom", String(filters.dateFrom));
  if (filters.dateTo) params.set("dateTo", String(filters.dateTo));
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));

  const res = await fetch(`/api/attendance?${params}`);
  if (!res.ok) throw new Error("Failed to fetch attendance");
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

async function fetchAttendanceById(
  id: string,
): Promise<AttendanceWithRelations> {
  const res = await fetch(`/api/attendance/${id}`);
  if (!res.ok) throw new Error("Failed to fetch attendance");
  const json = await res.json();
  return json.data ?? json;
}

async function fetchTodayStatus() {
  const res = await fetch("/api/attendance/clock");
  if (!res.ok) throw new Error("Failed to fetch today status");
  const json = await res.json();
  return json.data ?? json;
}

async function fetchTodayStats() {
  const res = await fetch("/api/attendance/today-stats");
  if (!res.ok) {
    // API might not exist yet, return empty stats
    return {
      present: 0,
      absent: 0,
      late: 0,
      onLeave: 0,
      totalEmployees: 0,
      attendanceRate: 0,
    };
  }
  return res.json();
}

// Hooks
export function useAttendance(filters: AttendanceFilters = {}) {
  return useQuery({
    queryKey: ["attendance", filters],
    queryFn: () => fetchAttendance(filters),
  });
}

export function useAttendanceById(id: string | undefined) {
  return useQuery({
    queryKey: ["attendance", id],
    queryFn: () => fetchAttendanceById(id!),
    enabled: !!id,
  });
}

export function useTodayStatus() {
  return useQuery({
    queryKey: ["attendance", "today-status"],
    queryFn: fetchTodayStatus,
    refetchInterval: 60000, // Refetch every minute
  });
}

export function useTodayStats() {
  return useQuery({
    queryKey: ["attendance", "today-stats"],
    queryFn: fetchTodayStats,
    refetchInterval: 60000,
  });
}

export function useClockIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ClockInRequest): Promise<ClockResponse> => {
      const res = await fetch("/api/attendance/clock?action=in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to clock in");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

export function useClockOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ClockOutRequest): Promise<ClockResponse> => {
      const res = await fetch("/api/attendance/clock?action=out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to clock out");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

export function useCreateAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      employeeId: string;
      date: Date;
      checkIn?: Date;
      checkOut?: Date;
      status: AttendanceStatus;
      notes?: string;
    }) => {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create attendance");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

export function useUpdateAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Attendance>;
    }) => {
      const res = await fetch(`/api/attendance/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update attendance");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance", variables.id] });
    },
  });
}

export function useDeleteAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/attendance/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete attendance");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}
