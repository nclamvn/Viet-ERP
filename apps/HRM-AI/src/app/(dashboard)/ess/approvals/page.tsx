"use client";

import { useEffect, useState } from "react";
import { Loader2, ClipboardCheck, Inbox } from "lucide-react";
import { ApprovalCard } from "@/components/workflow";
import { useToast } from "@/hooks/use-toast";
import type { RequestStatus } from ".prisma/hrm-ai-client";

interface ApprovalItem {
  id: string;
  stepNumber: number;
  workflowInstance: {
    leaveRequest?: {
      requestCode: string;
      startDate: string;
      endDate: string;
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
  createdAt: string;
}

export default function ApprovalsPage() {
  const { toast } = useToast();
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchApprovals = async () => {
    try {
      const response = await fetch("/api/approvals/pending");
      if (response.ok) {
        const data = await response.json();
        setApprovals(data.data || []);
      }
    } catch {
      toast({
        title: "Lỗi",
        description: "Không thể tải danh sách phê duyệt",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchApprovals();
  }, []);

  const handleApprove = async (id: string, comment?: string) => {
    try {
      const response = await fetch(`/api/approvals/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to approve");
      }

      toast({
        title: "Thành công",
        description: "Đã phê duyệt đơn xin nghỉ",
      });

      fetchApprovals();
    } catch (error) {
      toast({
        title: "Lỗi",
        description:
          error instanceof Error ? error.message : "Không thể phê duyệt",
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleReject = async (id: string, reason: string) => {
    try {
      const response = await fetch(`/api/approvals/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to reject");
      }

      toast({
        title: "Thành công",
        description: "Đã từ chối đơn xin nghỉ",
      });

      fetchApprovals();
    } catch (error) {
      toast({
        title: "Lỗi",
        description:
          error instanceof Error ? error.message : "Không thể từ chối",
        variant: "destructive",
      });
      throw error;
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
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-bold">Phê duyệt</h1>
          <p className="text-muted-foreground">
            Xem và xử lý các đơn chờ phê duyệt của bạn
          </p>
        </div>
      </div>

      {approvals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Inbox className="h-16 w-16 mb-4 opacity-50" />
          <p className="text-lg font-medium">Không có đơn chờ duyệt</p>
          <p className="text-sm">Các đơn cần phê duyệt sẽ xuất hiện ở đây</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </div>
  );
}
