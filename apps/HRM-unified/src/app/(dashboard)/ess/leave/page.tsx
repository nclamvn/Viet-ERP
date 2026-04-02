"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LeaveBalanceCard,
  LeaveRequestForm,
  LeaveRequestList,
} from "@/components/leave";
import { useToast } from "@/hooks/use-toast";
import type { LeaveType, RequestStatus } from ".prisma/hrm-unified-client";

interface LeavePolicy {
  id: string;
  name: string;
  leaveType: LeaveType;
}

interface LeaveBalance {
  id: string;
  policyId: string;
  year: number;
  entitled: number;
  used: number;
  pending: number;
  carried: number;
  policy: {
    name: string;
    leaveType: LeaveType;
  };
}

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

export default function LeavePage() {
  const { toast } = useToast();
  const [policies, setPolicies] = useState<LeavePolicy[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [policiesRes, balancesRes, requestsRes] = await Promise.all([
        fetch("/api/leave/policies"),
        fetch("/api/leave/balances/my"),
        fetch("/api/leave/requests/my"),
      ]);

      if (policiesRes.ok) {
        const data = await policiesRes.json();
        setPolicies(data.data || []);
      }

      if (balancesRes.ok) {
        const data = await balancesRes.json();
        setBalances(data.data || []);
      }

      if (requestsRes.ok) {
        const data = await requestsRes.json();
        setRequests(data.data || []);
      }
    } catch {
      toast({
        title: "Lỗi",
        description: "Không thể tải dữ liệu",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateRequest = async (data: {
    policyId: string;
    startDate: Date;
    endDate: Date;
    isHalfDayStart: boolean;
    isHalfDayEnd: boolean;
    reason: string;
    submitNow?: boolean;
  }) => {
    try {
      const response = await fetch("/api/leave/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: data.policyId,
          startDate: data.startDate.toISOString(),
          endDate: data.endDate.toISOString(),
          isHalfDayStart: data.isHalfDayStart,
          isHalfDayEnd: data.isHalfDayEnd,
          reason: data.reason,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create request");
      }

      const newRequest = await response.json();

      if (data.submitNow) {
        await fetch(`/api/leave/requests/${newRequest.id}/submit`, {
          method: "POST",
        });
      }

      toast({
        title: "Thành công",
        description: data.submitNow
          ? "Đơn xin nghỉ đã được gửi duyệt"
          : "Đơn xin nghỉ đã được lưu nháp",
      });

      fetchData();
    } catch (error) {
      toast({
        title: "Lỗi",
        description:
          error instanceof Error ? error.message : "Không thể tạo đơn",
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleSubmit = async (id: string) => {
    try {
      const response = await fetch(`/api/leave/requests/${id}/submit`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to submit request");
      }

      toast({
        title: "Thành công",
        description: "Đơn xin nghỉ đã được gửi duyệt",
      });

      fetchData();
    } catch (error) {
      toast({
        title: "Lỗi",
        description:
          error instanceof Error ? error.message : "Không thể gửi đơn",
        variant: "destructive",
      });
    }
  };

  const handleCancel = async (id: string) => {
    try {
      const response = await fetch(`/api/leave/requests/${id}/cancel`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to cancel request");
      }

      toast({
        title: "Thành công",
        description: "Đơn xin nghỉ đã được hủy",
      });

      fetchData();
    } catch (error) {
      toast({
        title: "Lỗi",
        description:
          error instanceof Error ? error.message : "Không thể hủy đơn",
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
        <div>
          <h1 className="text-2xl font-bold">Xin nghỉ phép</h1>
          <p className="text-muted-foreground">
            Quản lý đơn xin nghỉ phép của bạn
          </p>
        </div>
        <LeaveRequestForm
          policies={policies}
          onSubmit={handleCreateRequest}
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Tạo đơn mới
            </Button>
          }
        />
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Đơn xin nghỉ gần đây</CardTitle>
            </CardHeader>
            <CardContent>
              <LeaveRequestList
                requests={requests}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
              />
            </CardContent>
          </Card>
        </div>
        <div>
          <LeaveBalanceCard balances={balances as never} />
        </div>
      </div>
    </div>
  );
}
