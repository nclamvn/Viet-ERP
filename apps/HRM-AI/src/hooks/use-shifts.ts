// src/hooks/use-shifts.ts
// Shift management hooks

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ShiftFilters,
  ShiftWithRelations,
  ShiftAssignmentFilters,
  ShiftAssignmentWithRelations,
  PaginatedResponse,
} from "@/types";
import type { Shift, ShiftAssignment } from ".prisma/hrm-ai-client";

// Fetch functions
async function fetchShifts(
  filters: ShiftFilters,
): Promise<PaginatedResponse<ShiftWithRelations>> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.shiftType) params.set("shiftType", filters.shiftType);
  if (filters.isActive !== undefined)
    params.set("isActive", String(filters.isActive));
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));

  const res = await fetch(`/api/shifts?${params}`);
  if (!res.ok) throw new Error("Failed to fetch shifts");
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

async function fetchShift(id: string): Promise<ShiftWithRelations> {
  const res = await fetch(`/api/shifts/${id}`);
  if (!res.ok) throw new Error("Failed to fetch shift");
  const json = await res.json();
  return json.data ?? json;
}

async function fetchActiveShifts(): Promise<Shift[]> {
  const res = await fetch("/api/shifts?isActive=true&pageSize=100");
  if (!res.ok) throw new Error("Failed to fetch active shifts");
  const data = await res.json();
  return data.data ?? data;
}

async function fetchShiftAssignments(
  filters: ShiftAssignmentFilters,
): Promise<PaginatedResponse<ShiftAssignmentWithRelations>> {
  const params = new URLSearchParams();
  if (filters.employeeId) params.set("employeeId", filters.employeeId);
  if (filters.shiftId) params.set("shiftId", filters.shiftId);
  if (filters.departmentId) params.set("departmentId", filters.departmentId);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));

  const res = await fetch(`/api/shifts/assignments?${params}`);
  if (!res.ok) throw new Error("Failed to fetch shift assignments");
  const sjson = await res.json();
  if (sjson.meta) {
    return {
      data: sjson.data,
      pagination: {
        page: sjson.meta.page,
        pageSize: sjson.meta.pageSize ?? sjson.meta.limit,
        total: sjson.meta.total,
        totalPages: sjson.meta.totalPages,
      },
    };
  }
  return sjson;
}

// Hooks
export function useShifts(filters: ShiftFilters = {}) {
  return useQuery({
    queryKey: ["shifts", filters],
    queryFn: () => fetchShifts(filters),
  });
}

export function useShift(id: string | undefined) {
  return useQuery({
    queryKey: ["shift", id],
    queryFn: () => fetchShift(id!),
    enabled: !!id,
  });
}

export function useActiveShifts() {
  return useQuery({
    queryKey: ["shifts", "active"],
    queryFn: fetchActiveShifts,
  });
}

export function useShiftAssignments(filters: ShiftAssignmentFilters = {}) {
  return useQuery({
    queryKey: ["shift-assignments", filters],
    queryFn: () => fetchShiftAssignments(filters),
  });
}

type ShiftInput = {
  name: string;
  code: string;
  shiftType?:
    | "STANDARD"
    | "MORNING"
    | "AFTERNOON"
    | "NIGHT"
    | "FLEXIBLE"
    | "ROTATING";
  startTime: string;
  endTime: string;
  breakStartTime?: string | null;
  breakEndTime?: string | null;
  breakMinutes?: number;
  workHoursPerDay?: number;
  lateGrace?: number;
  earlyGrace?: number;
  otStartAfter?: number;
  nightShiftStart?: string | null;
  nightShiftEnd?: string | null;
  isOvernight?: boolean;
  color?: string;
  isActive?: boolean;
};

export function useCreateShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ShiftInput) => {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create shift");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}

export function useUpdateShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<ShiftInput>;
    }) => {
      const res = await fetch(`/api/shifts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update shift");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      queryClient.invalidateQueries({ queryKey: ["shift", variables.id] });
    },
  });
}

export function useDeleteShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/shifts/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete shift");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}

export function useAssignShift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      data: Partial<ShiftAssignment> & { employeeIds?: string[] },
    ) => {
      const res = await fetch("/api/shifts/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to assign shift");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shift-assignments"] });
    },
  });
}
