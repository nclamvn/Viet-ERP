"use client";

import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { MoreHorizontal, Send, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { REQUEST_STATUS_CONFIG } from "@/lib/leave/constants";
import type { RequestStatus, LeaveType } from ".prisma/hrm-ai-client";

interface LeaveRequest {
  id: string;
  requestCode: string;
  startDate: string | Date;
  endDate: string | Date;
  totalDays: number;
  status: RequestStatus;
  reason: string;
  policy: {
    name: string;
    leaveType: LeaveType;
  };
  createdAt: string | Date;
}

interface LeaveRequestListProps {
  requests: LeaveRequest[];
  onSubmit?: (id: string) => void;
  onCancel?: (id: string) => void;
  onView?: (id: string) => void;
}

export function LeaveRequestList({
  requests,
  onSubmit,
  onCancel,
  onView,
}: LeaveRequestListProps) {
  const getStatusBadge = (status: RequestStatus) => {
    const config = REQUEST_STATUS_CONFIG[status];
    return (
      <Badge
        className={`${config?.bgColor || "bg-gray-100"} ${config?.color || "text-gray-600"}`}
      >
        {config?.label || status}
      </Badge>
    );
  };

  if (requests.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Chưa có đơn xin nghỉ nào
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mã đơn</TableHead>
          <TableHead>Loại phép</TableHead>
          <TableHead>Từ ngày</TableHead>
          <TableHead>Đến ngày</TableHead>
          <TableHead className="text-center">Số ngày</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead className="w-[50px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((request) => (
          <TableRow key={request.id}>
            <TableCell className="font-medium">{request.requestCode}</TableCell>
            <TableCell>{request.policy.name}</TableCell>
            <TableCell>
              {format(new Date(request.startDate), "dd/MM/yyyy", {
                locale: vi,
              })}
            </TableCell>
            <TableCell>
              {format(new Date(request.endDate), "dd/MM/yyyy", { locale: vi })}
            </TableCell>
            <TableCell className="text-center">{request.totalDays}</TableCell>
            <TableCell>{getStatusBadge(request.status)}</TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onView && (
                    <DropdownMenuItem onClick={() => onView(request.id)}>
                      Xem chi tiết
                    </DropdownMenuItem>
                  )}
                  {request.status === "DRAFT" && onSubmit && (
                    <DropdownMenuItem onClick={() => onSubmit(request.id)}>
                      <Send className="mr-2 h-4 w-4" />
                      Gửi duyệt
                    </DropdownMenuItem>
                  )}
                  {["DRAFT", "PENDING"].includes(request.status) &&
                    onCancel && (
                      <DropdownMenuItem
                        onClick={() => onCancel(request.id)}
                        className="text-destructive"
                      >
                        <X className="mr-2 h-4 w-4" />
                        Hủy đơn
                      </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
