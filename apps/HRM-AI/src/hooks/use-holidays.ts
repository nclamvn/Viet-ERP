// src/hooks/use-holidays.ts
// Holiday management hooks

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  HolidayFilters,
  HolidayWithRelations,
  PaginatedResponse,
} from "@/types";
import type { Holiday, DayType } from ".prisma/hrm-ai-client";

// Fetch functions
async function fetchHolidays(
  filters: HolidayFilters,
): Promise<PaginatedResponse<HolidayWithRelations>> {
  const params = new URLSearchParams();
  if (filters.year) params.set("year", String(filters.year));
  if (filters.isNational !== undefined)
    params.set("isNational", String(filters.isNational));
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));

  const res = await fetch(`/api/holidays?${params}`);
  if (!res.ok) throw new Error("Failed to fetch holidays");
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

async function fetchHolidayById(id: string): Promise<HolidayWithRelations> {
  const res = await fetch(`/api/holidays/${id}`);
  if (!res.ok) throw new Error("Failed to fetch holiday");
  const json = await res.json();
  return json.data ?? json;
}

// Hooks
export function useHolidays(filters: HolidayFilters = {}) {
  return useQuery({
    queryKey: ["holidays", filters],
    queryFn: () => fetchHolidays(filters),
  });
}

export function useHolidayById(id: string | undefined) {
  return useQuery({
    queryKey: ["holiday", id],
    queryFn: () => fetchHolidayById(id!),
    enabled: !!id,
  });
}

export function useYearHolidays(year: number) {
  return useQuery({
    queryKey: ["holidays", { year }],
    queryFn: () => fetchHolidays({ year, pageSize: 100 }),
    select: (data) => data.data,
  });
}

export function useCreateHoliday() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      date: Date;
      endDate?: Date | null;
      dayType?: DayType;
      compensatoryDate?: Date | null;
      isRecurring?: boolean;
      isNational?: boolean;
      notes?: string;
    }) => {
      const res = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create holiday");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
  });
}

export function useUpdateHoliday() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Holiday>;
    }) => {
      const res = await fetch(`/api/holidays/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update holiday");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      queryClient.invalidateQueries({ queryKey: ["holiday", variables.id] });
    },
  });
}

export function useDeleteHoliday() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/holidays/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete holiday");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
  });
}

export function useSeedNationalHolidays() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (year: number) => {
      const res = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed", year }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to seed national holidays");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
  });
}
