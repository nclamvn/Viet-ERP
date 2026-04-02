"use client";

import { useState } from "react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import {
  Check,
  X,
  Clock,
  User,
  Calendar,
  FileText,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RequestStatus } from ".prisma/hrm-unified-client";

interface ApprovalItem {
  id: string;
  stepNumber: number;
  workflowInstance: {
    leaveRequest?: {
      requestCode: string;
      startDate: string | Date;
      endDate: string | Date;
      totalDays: number;
      reason: string;
      status: RequestStatus;
      employee: {
        firstName: string;
        lastName: string;
        employeeCode: string;
      };
      policy: {
        name: string;
      };
    };
  };
  createdAt: string | Date;
}

interface ApprovalCardProps {
  approval: ApprovalItem;
  onApprove: (id: string, comment?: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
}

export function ApprovalCard({
  approval,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [comment, setComment] = useState("");

  const request = approval.workflowInstance.leaveRequest;
  if (!request) return null;

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await onApprove(approval.id, comment);
    } finally {
      setIsApproving(false);
      setComment("");
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setIsRejecting(true);
    try {
      await onReject(approval.id, rejectReason);
      setShowRejectDialog(false);
    } finally {
      setIsRejecting(false);
      setRejectReason("");
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium">
              {request.requestCode}
            </CardTitle>
            <Badge variant="outline">
              <Clock className="mr-1 h-3 w-3" />
              Chờ duyệt
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {request.employee.firstName} {request.employee.lastName}
            </span>
            <span className="text-muted-foreground">
              ({request.employee.employeeCode})
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span>{request.policy.name}</span>
            <Badge variant="secondary">{request.totalDays} ngày</Badge>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>
              {format(new Date(request.startDate), "dd/MM/yyyy", {
                locale: vi,
              })}
              {" - "}
              {format(new Date(request.endDate), "dd/MM/yyyy", { locale: vi })}
            </span>
          </div>

          <div className="text-sm">
            <span className="text-muted-foreground">Lý do: </span>
            {request.reason}
          </div>

          <div className="pt-2">
            <Textarea
              placeholder="Ghi chú (tùy chọn)..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="resize-none"
              rows={2}
            />
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button
            className="flex-1"
            onClick={handleApprove}
            disabled={isApproving || isRejecting}
          >
            {isApproving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Duyệt
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={() => setShowRejectDialog(true)}
            disabled={isApproving || isRejecting}
          >
            <X className="mr-2 h-4 w-4" />
            Từ chối
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Từ chối đơn xin nghỉ</DialogTitle>
            <DialogDescription>
              Vui lòng nhập lý do từ chối đơn xin nghỉ này
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Nhập lý do từ chối..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="resize-none"
            rows={3}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRejectDialog(false)}
            >
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim() || isRejecting}
            >
              {isRejecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Xác nhận từ chối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
