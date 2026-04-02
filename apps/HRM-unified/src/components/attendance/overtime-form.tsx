// src/components/attendance/overtime-form.tsx
// Overtime request form

"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  overtimeRequestSchema,
  type OvertimeRequestFormData,
} from "@/lib/validations/attendance";
import {
  DAY_TYPE_LABELS,
  OT_MULTIPLIERS,
  NIGHT_BONUS,
} from "@/constants/attendance";
import type { OvertimeRequest, Employee } from ".prisma/hrm-unified-client";

interface OvertimeFormProps {
  initialData?: OvertimeRequest;
  employees?: Pick<Employee, "id" | "employeeCode" | "fullName">[];
  currentEmployeeId?: string;
  onSubmit: (data: OvertimeRequestFormData) => Promise<void>;
  isLoading?: boolean;
}

export function OvertimeForm({
  initialData,
  employees,
  currentEmployeeId,
  onSubmit,
  isLoading,
}: OvertimeFormProps) {
  const form = useForm({
    resolver: zodResolver(overtimeRequestSchema),
    defaultValues: {
      employeeId: initialData?.employeeId || currentEmployeeId || "",
      date: initialData?.date ? new Date(initialData.date) : new Date(),
      startTime: initialData?.startTime
        ? new Date(initialData.startTime)
        : new Date(),
      endTime: initialData?.endTime
        ? new Date(initialData.endTime)
        : new Date(),
      dayType: initialData?.dayType || "NORMAL",
      reason: initialData?.reason || "",
      attachmentUrl: initialData?.attachmentUrl || null,
      notes: initialData?.notes || null,
    },
  });

  const selectedDayType = form.watch("dayType");

  const getMultiplierText = () => {
    const base =
      OT_MULTIPLIERS[
        selectedDayType === "HOLIDAY"
          ? "HOLIDAY"
          : selectedDayType === "WEEKEND"
            ? "WEEKEND"
            : "WEEKDAY"
      ];
    return `${Math.round(base * 100)}%${selectedDayType !== "HOLIDAY" ? ` (+ ${Math.round(NIGHT_BONUS * 100)}% nếu ca đêm)` : ""}`;
  };

  const handleFormSubmit = form.handleSubmit(async (data) => {
    await onSubmit(data as OvertimeRequestFormData);
  });

  return (
    <Form {...form}>
      <form onSubmit={handleFormSubmit} className="space-y-6">
        {employees && employees.length > 0 && (
          <FormField
            control={form.control}
            name="employeeId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nhân viên *</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn nhân viên" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.fullName} ({emp.employeeCode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Ngày tăng ca *</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground",
                      )}
                    >
                      {field.value ? (
                        format(field.value as Date, "dd/MM/yyyy")
                      ) : (
                        <span>Chọn ngày</span>
                      )}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value as Date}
                    onSelect={field.onChange}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Giờ bắt đầu *</FormLabel>
                <FormControl>
                  <Input
                    type="time"
                    value={
                      field.value ? format(field.value as Date, "HH:mm") : ""
                    }
                    onChange={(e) => {
                      const [hours, minutes] = e.target.value
                        .split(":")
                        .map(Number);
                      const date = new Date(form.getValues("date") as Date);
                      date.setHours(hours, minutes, 0, 0);
                      field.onChange(date);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="endTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Giờ kết thúc *</FormLabel>
                <FormControl>
                  <Input
                    type="time"
                    value={
                      field.value ? format(field.value as Date, "HH:mm") : ""
                    }
                    onChange={(e) => {
                      const [hours, minutes] = e.target.value
                        .split(":")
                        .map(Number);
                      const date = new Date(form.getValues("date") as Date);
                      date.setHours(hours, minutes, 0, 0);
                      field.onChange(date);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="dayType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Loại ngày</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn loại ngày" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(DAY_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Hệ số lương: {getMultiplierText()}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Lý do tăng ca *</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Nhập lý do cần tăng ca..."
                  className="resize-none"
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ghi chú</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Ghi chú thêm (nếu có)..."
                  className="resize-none"
                  rows={2}
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-3">
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {initialData ? "Cập nhật" : "Gửi đơn"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
