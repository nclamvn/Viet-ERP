"use client";

import { useState, use } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, CheckCircle, Zap } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { ReviewForm } from "@/components/reviews/review-form";
import { CompetencyRater } from "@/components/reviews/competency-rater";
import { REVIEW_STATUS_LABELS, RATING_LABELS } from "@/lib/config/competencies";
import { useSession } from "next-auth/react";
import type { RatingScale, ReviewStatus } from ".prisma/hrm-client";

const RATING_OPTIONS: RatingScale[] = [
  "EXCELLENT",
  "GOOD",
  "SATISFACTORY",
  "NEEDS_IMPROVEMENT",
  "UNSATISFACTORY",
];

export default function ReviewDetailPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = use(params);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<"self" | "manager" | "result">(
    "self",
  );
  const [finalRating, setFinalRating] = useState<RatingScale | "">("");
  const [hrNotes, setHrNotes] = useState("");
  const [showTrigger, setShowTrigger] = useState(false);
  const [triggerType, setTriggerType] = useState("PROMOTION");

  const { data, isLoading } = useQuery({
    queryKey: ["review", reviewId],
    queryFn: async () => {
      const res = await fetch(`/api/reviews/r/${reviewId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const completeMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reviews/r/${reviewId}/complete`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalRating, hrNotes }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review", reviewId] });
      toast({ title: "Đánh giá đã hoàn tất" });
    },
    onError: (err) => {
      toast({ title: "Lỗi", description: err.message, variant: "destructive" });
    },
  });

  const triggerMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reviews/r/${reviewId}/trigger-hr-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: triggerType }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review", reviewId] });
      setShowTrigger(false);
      toast({ title: "HR Event đã được tạo — chờ approve" });
    },
    onError: (err) => {
      toast({ title: "Lỗi", description: err.message, variant: "destructive" });
    },
  });

  const review = data?.data;
  if (isLoading)
    return (
      <div className="py-8 text-center text-muted-foreground">Đang tải...</div>
    );
  if (!review)
    return (
      <div className="py-8 text-center text-muted-foreground">
        Không tìm thấy đánh giá
      </div>
    );

  const role = session?.user?.role;
  const userId = session?.user?.id;
  const isHR = ["SUPER_ADMIN", "HR_MANAGER"].includes(role || "");
  const isReviewer = review.reviewerId === userId;
  const isEmployee = review.employee?.userId === userId;
  const status: ReviewStatus = review.status;
  const st = REVIEW_STATUS_LABELS[status] || {
    label: status,
    color: "bg-gray-100 text-gray-700",
  };

  const canSelfSubmit = (isEmployee || isHR) && status === "SELF_PENDING";
  const canManagerSubmit = (isReviewer || isHR) && status === "MANAGER_PENDING";
  const canComplete = isHR && status === "HR_REVIEWING";
  const canTrigger =
    isHR && status === "COMPLETED" && !review.triggeredHREventId;

  const selfScores = (review.competencyScores as Record<string, number>) || {};

  // Determine which tab to show by default
  const defaultTab = canSelfSubmit
    ? "self"
    : canManagerSubmit
      ? "manager"
      : "result";
  if (
    activeTab !== defaultTab &&
    !canSelfSubmit &&
    activeTab === "self" &&
    status !== "COMPLETED" &&
    !isHR
  ) {
    // auto-switch handled by initial state
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={review.period?.id ? `/reviews/${review.period.id}` : "/reviews"}
        >
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold" style={{ color: "#1E3A5F" }}>
            {review.employee?.fullName || ""}
          </h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{review.employee?.employeeCode}</span>
            <span>•</span>
            <span>{review.period?.name}</span>
            <Badge className={st.color}>{st.label}</Badge>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b pb-1">
        <Button
          variant={activeTab === "self" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("self")}
          style={
            activeTab === "self" ? { backgroundColor: "#1E3A5F" } : undefined
          }
        >
          Tự đánh giá
        </Button>
        <Button
          variant={activeTab === "manager" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("manager")}
          style={
            activeTab === "manager" ? { backgroundColor: "#1E3A5F" } : undefined
          }
        >
          Manager đánh giá
        </Button>
        <Button
          variant={activeTab === "result" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("result")}
          style={
            activeTab === "result" ? { backgroundColor: "#1E3A5F" } : undefined
          }
        >
          Kết quả tổng hợp
        </Button>
      </div>

      {/* Tab content */}
      {activeTab === "self" &&
        (canSelfSubmit ? (
          <ReviewForm
            reviewId={reviewId}
            type="self"
            initialData={{
              rating: review.selfRating,
              strengths: review.selfStrengths,
              weaknesses: review.selfWeaknesses,
              goals: review.selfGoals,
              competencyScores: selfScores,
            }}
          />
        ) : review.selfRating ? (
          <ReviewForm
            reviewId={reviewId}
            type="self"
            initialData={{
              rating: review.selfRating,
              strengths: review.selfStrengths,
              weaknesses: review.selfWeaknesses,
              goals: review.selfGoals,
              competencyScores: selfScores,
            }}
            readOnly
          />
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Nhân viên chưa hoàn thành tự đánh giá
            </CardContent>
          </Card>
        ))}

      {activeTab === "manager" &&
        (canManagerSubmit ? (
          <>
            {/* Show self-assessment read-only for comparison */}
            {review.selfRating && (
              <Card className="border-blue-200 bg-blue-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-blue-700">
                    Tham khảo: Tự đánh giá của NV
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  <div>
                    <strong>Đánh giá:</strong>{" "}
                    {RATING_LABELS[review.selfRating as RatingScale]?.label}
                  </div>
                  <div>
                    <strong>Điểm mạnh:</strong> {review.selfStrengths}
                  </div>
                  <div>
                    <strong>Điểm cần cải thiện:</strong> {review.selfWeaknesses}
                  </div>
                  {Object.keys(selfScores).length > 0 && (
                    <CompetencyRater
                      scores={selfScores}
                      onChange={() => {}}
                      readOnly
                    />
                  )}
                </CardContent>
              </Card>
            )}
            <ReviewForm
              reviewId={reviewId}
              type="manager"
              initialData={{
                rating: review.managerRating,
                strengths: review.managerStrengths,
                weaknesses: review.managerWeaknesses,
                goals: review.managerGoals,
                competencyScores: selfScores,
              }}
            />
          </>
        ) : review.managerRating ? (
          <ReviewForm
            reviewId={reviewId}
            type="manager"
            initialData={{
              rating: review.managerRating,
              strengths: review.managerStrengths,
              weaknesses: review.managerWeaknesses,
              goals: review.managerGoals,
              competencyScores:
                (review.competencyScores as Record<string, number>) || {},
            }}
            readOnly
          />
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {status === "SELF_PENDING" || status === "DRAFT"
                ? "Đang chờ nhân viên tự đánh giá"
                : "Manager chưa hoàn thành đánh giá"}
            </CardContent>
          </Card>
        ))}

      {activeTab === "result" && (
        <div className="space-y-4">
          {/* Summary comparison */}
          {review.selfRating || review.managerRating || review.finalRating ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Kết Quả Tổng Hợp</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">
                      Tự đánh giá
                    </div>
                    {review.selfRating ? (
                      <Badge
                        className={
                          RATING_LABELS[review.selfRating as RatingScale].color
                        }
                      >
                        {RATING_LABELS[review.selfRating as RatingScale].label}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">
                      Manager
                    </div>
                    {review.managerRating ? (
                      <Badge
                        className={
                          RATING_LABELS[review.managerRating as RatingScale]
                            .color
                        }
                      >
                        {
                          RATING_LABELS[review.managerRating as RatingScale]
                            .label
                        }
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">
                      Kết quả cuối
                    </div>
                    {review.finalRating ? (
                      <Badge
                        className={
                          RATING_LABELS[review.finalRating as RatingScale].color
                        }
                      >
                        {RATING_LABELS[review.finalRating as RatingScale].label}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                </div>

                {review.hrNotes && (
                  <div className="border-t pt-3">
                    <div className="text-sm font-medium mb-1">Ghi chú HR:</div>
                    <div className="text-sm text-muted-foreground">
                      {review.hrNotes}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Chưa có kết quả
              </CardContent>
            </Card>
          )}

          {/* HR finalize form */}
          {canComplete && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  HR Tổng Hợp & Hoàn Tất
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-sm font-medium">
                    Kết quả cuối cùng *
                  </label>
                  <Select
                    value={finalRating || undefined}
                    onValueChange={(v) => setFinalRating(v as RatingScale)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Chọn đánh giá..." />
                    </SelectTrigger>
                    <SelectContent>
                      {RATING_OPTIONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {RATING_LABELS[r].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Ghi chú HR</label>
                  <Textarea
                    className="mt-1"
                    rows={3}
                    value={hrNotes}
                    onChange={(e) => setHrNotes(e.target.value)}
                    placeholder="Ghi chú (không bắt buộc)..."
                  />
                </div>
                <Button
                  className="w-full"
                  style={{ backgroundColor: "#1E3A5F" }}
                  disabled={!finalRating || completeMut.isPending}
                  onClick={() => completeMut.mutate()}
                >
                  <CheckCircle className="h-4 w-4 mr-1" />
                  {completeMut.isPending ? "Đang lưu..." : "Hoàn Tất Đánh Giá"}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Trigger HR Event */}
          {canTrigger && (
            <Card>
              <CardContent className="pt-4">
                {!showTrigger ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowTrigger(true)}
                  >
                    <Zap className="h-4 w-4 mr-1" />
                    Trigger HR Event (Thăng chức / Tăng lương)
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium">
                        Loại sự kiện
                      </label>
                      <Select
                        value={triggerType}
                        onValueChange={setTriggerType}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PROMOTION">Thăng chức</SelectItem>
                          <SelectItem value="SALARY_ADJUSTMENT">
                            Điều chỉnh lương
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        style={{ backgroundColor: "#1E3A5F" }}
                        disabled={triggerMut.isPending}
                        onClick={() => triggerMut.mutate()}
                      >
                        {triggerMut.isPending ? "Đang tạo..." : "Tạo HR Event"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setShowTrigger(false)}
                      >
                        Hủy
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {review.triggeredHREventId && (
            <Card className="border-emerald-200">
              <CardContent className="pt-4 flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle className="h-4 w-4" />
                HR Event đã được tạo — chờ approve trong Biến Động NS
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
