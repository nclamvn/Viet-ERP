"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { REVIEW_STATUS_LABELS, RATING_LABELS } from "@/lib/config/competencies";
import Link from "next/link";
import type { RatingScale, ReviewStatus } from ".prisma/hrm-client";

interface MyReviewRow {
  id: string;
  status: ReviewStatus;
  finalRating: RatingScale | null;
  selfSubmittedAt: string | null;
  period: { name: string; cycle: string; year: number };
}

export function MyReviews({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["my-reviews", employeeId],
    queryFn: async () => {
      const res = await fetch("/api/profile/reviews");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const reviews: MyReviewRow[] = data?.data || [];

  if (isLoading) {
    return (
      <div className="py-8 text-center text-muted-foreground">Đang tải...</div>
    );
  }

  if (reviews.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Chưa có đợt đánh giá nào
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((r) => {
        const st = REVIEW_STATUS_LABELS[r.status] || {
          label: r.status,
          color: "bg-gray-100 text-gray-700",
        };
        return (
          <Card key={r.id}>
            <CardContent className="py-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{r.period.name}</div>
                <div className="text-xs text-muted-foreground">
                  Năm {r.period.year}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {r.finalRating ? (
                  <Badge className={RATING_LABELS[r.finalRating].color}>
                    {RATING_LABELS[r.finalRating].label}
                  </Badge>
                ) : (
                  <Badge className={st.color}>{st.label}</Badge>
                )}
                <Link href={`/reviews/r/${r.id}`}>
                  <Button variant="ghost" size="sm">
                    Xem
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
