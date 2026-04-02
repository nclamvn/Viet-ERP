// src/components/attendance/shift-form.tsx
// Shift create/edit form

"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { shiftSchema, type ShiftFormData } from "@/lib/validations/shift";
import { SHIFT_TYPE_LABELS, SHIFT_TYPE_COLORS } from "@/constants/attendance";
import type { Shift } from ".prisma/hrm-unified-client";

interface ShiftFormProps {
  initialData?: Shift;
  onSubmit: (data: ShiftFormData) => Promise<void>;
  isLoading?: boolean;
}

export function ShiftForm({
  initialData,
  onSubmit,
  isLoading,
}: ShiftFormProps) {
  const form = useForm({
    resolver: zodResolver(shiftSchema),
    defaultValues: {
      name: initialData?.name || "",
      code: initialData?.code || "",
      shiftType: initialData?.shiftType || "STANDARD",
      startTime: initialData?.startTime || "08:00",
      endTime: initialData?.endTime || "17:00",
      breakStartTime: initialData?.breakStartTime || "12:00",
      breakEndTime: initialData?.breakEndTime || "13:00",
      breakMinutes: initialData?.breakMinutes ?? 60,
      workHoursPerDay: initialData?.workHoursPerDay
        ? Number(initialData.workHoursPerDay)
        : 8,
      lateGrace: initialData?.lateGrace ?? 15,
      earlyGrace: initialData?.earlyGrace ?? 15,
      otStartAfter: initialData?.otStartAfter ?? 30,
      nightShiftStart: initialData?.nightShiftStart || null,
      nightShiftEnd: initialData?.nightShiftEnd || null,
      isOvernight: initialData?.isOvernight ?? false,
      color: initialData?.color || "#3B82F6",
      isActive: initialData?.isActive ?? true,
    },
  });

  const handleFormSubmit = form.handleSubmit(async (data) => {
    await onSubmit(data as ShiftFormData);
  });

  return (
    <Form {...form}>
      <form onSubmit={handleFormSubmit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tên ca *</FormLabel>
                <FormControl>
                  <Input placeholder="VD: Ca hành chính" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mã ca *</FormLabel>
                <FormControl>
                  <Input placeholder="VD: HC" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="shiftType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Loại ca</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn loại ca" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.entries(SHIFT_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{
                              backgroundColor: SHIFT_TYPE_COLORS[value],
                            }}
                          />
                          {label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Màu hiển thị</FormLabel>
                <FormControl>
                  <div className="flex gap-2">
                    <Input type="color" className="w-12 h-10 p-1" {...field} />
                    <Input {...field} placeholder="#3B82F6" />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Giờ bắt đầu *</FormLabel>
                <FormControl>
                  <Input type="time" {...field} />
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
                  <Input type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="breakStartTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Giờ nghỉ trưa bắt đầu</FormLabel>
                <FormControl>
                  <Input type="time" {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="breakEndTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Giờ nghỉ trưa kết thúc</FormLabel>
                <FormControl>
                  <Input type="time" {...field} value={field.value || ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="breakMinutes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Thời gian nghỉ (phút)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    {...field}
                    onChange={(e) =>
                      field.onChange(parseInt(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="workHoursPerDay"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Số giờ làm việc/ngày</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  {...field}
                  onChange={(e) =>
                    field.onChange(parseFloat(e.target.value) || 0)
                  }
                />
              </FormControl>
              <FormDescription>Số giờ công chuẩn mỗi ngày</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="lateGrace"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cho phép đi trễ (phút)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    {...field}
                    onChange={(e) =>
                      field.onChange(parseInt(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="earlyGrace"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cho phép về sớm (phút)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    {...field}
                    onChange={(e) =>
                      field.onChange(parseInt(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="otStartAfter"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tính OT sau (phút)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    {...field}
                    onChange={(e) =>
                      field.onChange(parseInt(e.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="isOvernight"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Ca qua đêm</FormLabel>
                <FormDescription>Ca làm việc kéo dài qua 00:00</FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">
                  Trạng thái hoạt động
                </FormLabel>
                <FormDescription>
                  Ca làm việc có thể được gán cho nhân viên
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-3">
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {initialData ? "Cập nhật" : "Tạo mới"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
