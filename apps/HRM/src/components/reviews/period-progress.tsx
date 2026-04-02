"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { REVIEW_STATUS_LABELS, RATING_LABELS } from "@/lib/config/competencies";
import { CheckCircle, Clock } from "lucide-react";
import Link from "next/link";
import type { RatingScale, ReviewStatus } from ".prisma/hrm-client";

interface ReviewRow {
  id: string;
  status: ReviewStatus;
  selfSubmittedAt: string | null;
  managerSubmittedAt: string | null;
  finalRating: RatingScale | null;
  employee: {
    employeeCode: string;
    fullName: string;
    department: { name: string } | null;
  };
  reviewer: { name: string | null };
}

interface PeriodProgressProps {
  reviews: ReviewRow[];
  totalCount: number;
  completedCount: number;
}

export function PeriodProgress({
  reviews,
  totalCount,
  completedCount,
}: PeriodProgressProps) {
  const pct =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: "#1E3A5F" }}
          />
        </div>
        <span className="text-sm font-medium shrink-0">
          {completedCount}/{totalCount} ({pct}%)
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nhân viên</TableHead>
              <TableHead>Phòng Ban</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead>Tự đánh giá</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead>Kết quả</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviews.map((r) => {
              const st = REVIEW_STATUS_LABELS[r.status] || {
                label: r.status,
                color: "bg-gray-100 text-gray-700",
              };
              const selfDone = !!r.selfSubmittedAt;
              const mgrDone = !!r.managerSubmittedAt;

              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="text-sm font-medium">
                      {r.employee.fullName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.employee.employeeCode}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.employee.department?.name || ""}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.reviewer.name || ""}
                  </TableCell>
                  <TableCell>
                    {selfDone ? (
                      <span className="flex items-center gap-1 text-emerald-600 text-xs">
                        <CheckCircle className="h-3.5 w-3.5" />
                        {new Date(r.selfSubmittedAt!).toLocaleDateString(
                          "vi-VN",
                        )}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-yellow-600 text-xs">
                        <Clock className="h-3.5 w-3.5" /> Chờ
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {mgrDone ? (
                      <span className="flex items-center gap-1 text-emerald-600 text-xs">
                        <CheckCircle className="h-3.5 w-3.5" />
                        {new Date(r.managerSubmittedAt!).toLocaleDateString(
                          "vi-VN",
                        )}
                      </span>
                    ) : selfDone ? (
                      <span className="flex items-center gap-1 text-yellow-600 text-xs">
                        <Clock className="h-3.5 w-3.5" /> Chờ
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.finalRating ? (
                      <Badge className={RATING_LABELS[r.finalRating].color}>
                        {RATING_LABELS[r.finalRating].label}
                      </Badge>
                    ) : (
                      <Badge className={st.color}>{st.label}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/reviews/r/${r.id}`}>
                      <Button variant="ghost" size="sm">
                        Xem
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
