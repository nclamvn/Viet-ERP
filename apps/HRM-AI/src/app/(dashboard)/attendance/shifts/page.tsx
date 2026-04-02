// src/app/(dashboard)/attendance/shifts/page.tsx
// Shift management page

"use client";

import { useState } from "react";
import { Plus, Edit, Trash2, MoreHorizontal, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShiftForm } from "@/components/attendance/shift-form";
import {
  useShifts,
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
} from "@/hooks/use-shifts";
import { useToast } from "@/hooks/use-toast";
import { SHIFT_TYPE_LABELS } from "@/constants/attendance";
import type { Shift } from ".prisma/hrm-ai-client";
import type { ShiftFormData } from "@/lib/validations/shift";

export default function ShiftsPage() {
  const { toast } = useToast();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: shifts, isLoading } = useShifts({ pageSize: 100 });
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();

  const handleCreate = async (data: ShiftFormData) => {
    try {
      await createShift.mutateAsync(data);
      toast({ title: "Tạo ca làm việc thành công" });
      setIsFormOpen(false);
    } catch (error) {
      toast({
        title: "Lỗi",
        description:
          error instanceof Error ? error.message : "Không thể tạo ca làm việc",
        variant: "destructive",
      });
    }
  };

  const handleUpdate = async (data: ShiftFormData) => {
    if (!editingShift) return;

    try {
      await updateShift.mutateAsync({ id: editingShift.id, data });
      toast({ title: "Cập nhật thành công" });
      setEditingShift(null);
    } catch (error) {
      toast({
        title: "Lỗi",
        description:
          error instanceof Error ? error.message : "Không thể cập nhật",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;

    try {
      await deleteShift.mutateAsync(deletingId);
      toast({ title: "Xóa thành công" });
      setDeletingId(null);
    } catch (error) {
      toast({
        title: "Lỗi",
        description: error instanceof Error ? error.message : "Không thể xóa",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Quản lý ca làm việc</h1>
          <p className="text-muted-foreground">
            Thiết lập các ca làm việc cho nhân viên
          </p>
        </div>
        <Button onClick={() => setIsFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Thêm ca mới
        </Button>
      </div>

      {/* Shifts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Danh sách ca làm việc</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tên ca</TableHead>
                <TableHead>Mã</TableHead>
                <TableHead>Loại ca</TableHead>
                <TableHead>Giờ làm việc</TableHead>
                <TableHead>Giờ công</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="w-[70px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Đang tải...
                  </TableCell>
                </TableRow>
              ) : !shifts?.data.length ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Chưa có ca làm việc nào
                  </TableCell>
                </TableRow>
              ) : (
                shifts.data.map((shift) => (
                  <TableRow key={shift.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: shift.color }}
                        />
                        <span className="font-medium">{shift.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-sm">{shift.code}</code>
                    </TableCell>
                    <TableCell>{SHIFT_TYPE_LABELS[shift.shiftType]}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        {shift.startTime} - {shift.endTime}
                      </div>
                    </TableCell>
                    <TableCell>{Number(shift.workHoursPerDay)}h/ngày</TableCell>
                    <TableCell>
                      <Badge variant={shift.isActive ? "default" : "secondary"}>
                        {shift.isActive ? "Hoạt động" : "Ngưng"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setEditingShift(shift as Shift)}
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Chỉnh sửa
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeletingId(shift.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Xóa
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tạo ca làm việc mới</DialogTitle>
          </DialogHeader>
          <ShiftForm
            onSubmit={handleCreate}
            isLoading={createShift.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingShift} onOpenChange={() => setEditingShift(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa ca làm việc</DialogTitle>
          </DialogHeader>
          {editingShift && (
            <ShiftForm
              initialData={editingShift}
              onSubmit={handleUpdate}
              isLoading={updateShift.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xóa</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa ca làm việc này? Hành động này không thể hoàn
              tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Xóa</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
