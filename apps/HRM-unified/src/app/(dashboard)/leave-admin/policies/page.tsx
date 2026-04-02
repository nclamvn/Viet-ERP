"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Edit, Trash2, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { LEAVE_TYPE_CONFIG } from "@/lib/leave/constants";
import type { LeaveType } from ".prisma/hrm-unified-client";

interface LeavePolicy {
  id: string;
  name: string;
  code: string;
  leaveType: LeaveType;
  defaultDays: number;
  maxCarryOver: number;
  requiresApproval: boolean;
  isActive: boolean;
  createdAt: string;
}

export default function LeavePoliciesPage() {
  const { toast } = useToast();
  const [policies, setPolicies] = useState<LeavePolicy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPolicies = async () => {
    try {
      const response = await fetch("/api/leave/policies");
      if (response.ok) {
        const data = await response.json();
        setPolicies(data.data || []);
      }
    } catch {
      toast({
        title: "Lỗi",
        description: "Không thể tải danh sách chính sách",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchPolicies();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/leave/policies/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete policy");
      }

      toast({
        title: "Thành công",
        description: "Đã xóa chính sách",
      });

      fetchPolicies();
    } catch (error) {
      toast({
        title: "Lỗi",
        description:
          error instanceof Error ? error.message : "Không thể xóa chính sách",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold">Chính sách nghỉ phép</h1>
            <p className="text-muted-foreground">
              Quản lý các loại phép và quy định
            </p>
          </div>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Thêm chính sách
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Thêm chính sách mới</DialogTitle>
              <DialogDescription>
                Tạo chính sách nghỉ phép mới cho tổ chức
              </DialogDescription>
            </DialogHeader>
            <p className="text-muted-foreground text-sm">
              Form thêm chính sách sẽ được triển khai trong phiên bản tiếp theo.
            </p>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Danh sách chính sách</CardTitle>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Chưa có chính sách nào. Hãy tạo chính sách mới để bắt đầu.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tên chính sách</TableHead>
                  <TableHead>Loại phép</TableHead>
                  <TableHead className="text-center">
                    Số ngày mặc định
                  </TableHead>
                  <TableHead className="text-center">
                    Chuyển năm tối đa
                  </TableHead>
                  <TableHead className="text-center">Cần phê duyệt</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((policy) => {
                  const typeConfig = LEAVE_TYPE_CONFIG[policy.leaveType];
                  return (
                    <TableRow key={policy.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{policy.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {policy.code}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{typeConfig?.icon}</span>
                          <span>{typeConfig?.label || policy.leaveType}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {policy.defaultDays}
                      </TableCell>
                      <TableCell className="text-center">
                        {policy.maxCarryOver}
                      </TableCell>
                      <TableCell className="text-center">
                        {policy.requiresApproval ? "Có" : "Không"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={policy.isActive ? "default" : "secondary"}
                        >
                          {policy.isActive ? "Hoạt động" : "Tạm dừng"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Xóa chính sách?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Bạn có chắc muốn xóa chính sách &quot;
                                  {policy.name}&quot;? Hành động này không thể
                                  hoàn tác.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Hủy</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(policy.id)}
                                >
                                  Xóa
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
