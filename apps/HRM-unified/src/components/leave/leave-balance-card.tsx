"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LEAVE_TYPE_CONFIG } from "@/lib/leave/constants";
import type { LeaveType } from ".prisma/hrm-unified-client";

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

interface LeaveBalanceCardProps {
  balances: LeaveBalance[];
}

export function LeaveBalanceCard({ balances }: LeaveBalanceCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Số ngày phép còn lại</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {balances.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Chưa có dữ liệu phép năm
          </p>
        ) : (
          balances.map((balance) => {
            const config = LEAVE_TYPE_CONFIG[balance.policy.leaveType];
            const total = balance.entitled + balance.carried;
            const available = total - balance.used - balance.pending;
            const usedPercent = total > 0 ? (balance.used / total) * 100 : 0;
            const pendingPercent =
              total > 0 ? (balance.pending / total) * 100 : 0;

            return (
              <div key={balance.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{config?.icon || "📋"}</span>
                    <span className="font-medium">{balance.policy.name}</span>
                  </div>
                  <span className="font-semibold">
                    {available} / {total} ngày
                  </span>
                </div>
                <Progress
                  value={usedPercent + pendingPercent}
                  className="h-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Đã dùng: {balance.used} ngày</span>
                  {balance.pending > 0 && (
                    <span>Chờ duyệt: {balance.pending} ngày</span>
                  )}
                  {balance.carried > 0 && (
                    <span>Năm trước: {balance.carried} ngày</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
