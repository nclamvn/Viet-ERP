// src/app/(dashboard)/attendance/page.tsx
// Main attendance page with web clock

"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Search, Plus } from "lucide-react";
import { ExportButton } from "@/components/common/export-button";

import { WebClock } from "@/components/attendance/web-clock";
import { AttendanceTable } from "@/components/attendance/attendance-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAttendance, useTodayStats } from "@/hooks/use-attendance";
import { useDepartments } from "@/hooks/use-departments";
import { ATTENDANCE_STATUS_LABELS } from "@/constants/attendance";
import type { AttendanceStatus } from ".prisma/hrm-ai-client";

export default function AttendancePage() {
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data: todayStats } = useTodayStats();
  const { data: departments } = useDepartments();
  const { data: attendanceData, isLoading } = useAttendance({
    search: search || undefined,
    departmentId: departmentId || undefined,
    status: (status as AttendanceStatus) || undefined,
    dateFrom: dateFrom?.toISOString(),
    dateTo: dateTo?.toISOString(),
    page,
    pageSize,
  });

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Chấm công</h1>
        <p className="text-muted-foreground">
          Quản lý chấm công hàng ngày và theo dõi giờ làm việc
        </p>
      </div>

      {/* Stats Cards + Web Clock */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Web Clock */}
        <div className="lg:col-span-1">
          <WebClock />
        </div>

        {/* Today Stats */}
        <div className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Có mặt hôm nay
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {todayStats?.present || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Vắng mặt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {todayStats?.absent || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Đi trễ
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">
                  {todayStats?.late || 0}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Tỷ lệ chấm công
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">
                  {todayStats?.attendanceRate || 0}%
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Danh sách chấm công</CardTitle>
            <div className="flex gap-2">
              <ExportButton
                endpoint="/api/admin/export/attendance"
                params={{
                  departmentId: departmentId || undefined,
                  dateFrom: dateFrom?.toISOString(),
                  dateTo: dateTo?.toISOString(),
                }}
                label="Xuất Excel"
                fileName="bang-cham-cong.xlsx"
              />
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Thêm thủ công
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm theo tên, mã nhân viên..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select
              value={departmentId || "all"}
              onValueChange={(v) => setDepartmentId(v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Phòng ban" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả phòng ban</SelectItem>
                {departments?.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={status || "all"}
              onValueChange={(v) => setStatus(v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                {Object.entries(ATTENDANCE_STATUS_LABELS).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[140px]">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateFrom ? format(dateFrom, "dd/MM") : "Từ ngày"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateFrom}
                  onSelect={setDateFrom}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[140px]">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateTo ? format(dateTo, "dd/MM") : "Đến ngày"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateTo}
                  onSelect={setDateTo}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            {(search || departmentId || status || dateFrom || dateTo) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setDepartmentId("");
                  setStatus("");
                  setDateFrom(undefined);
                  setDateTo(undefined);
                  setPage(1);
                }}
              >
                Xóa bộ lọc
              </Button>
            )}
          </div>

          {/* Attendance Table */}
          <AttendanceTable
            data={attendanceData}
            isLoading={isLoading}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
