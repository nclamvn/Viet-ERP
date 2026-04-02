"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CompetencyRater } from "./competency-rater";
import { RATING_LABELS } from "@/lib/config/competencies";
import type { RatingScale } from ".prisma/hrm-client";

const RATING_OPTIONS: RatingScale[] = [
  "EXCELLENT",
  "GOOD",
  "SATISFACTORY",
  "NEEDS_IMPROVEMENT",
  "UNSATISFACTORY",
];

interface ReviewFormProps {
  reviewId: string;
  type: "self" | "manager";
  initialData?: {
    rating: RatingScale | null;
    strengths: string | null;
    weaknesses: string | null;
    goals: string | null;
    competencyScores: Record<string, number> | null;
  };
  readOnly?: boolean;
}

export function ReviewForm({
  reviewId,
  type,
  initialData,
  readOnly,
}: ReviewFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const prefix = type === "self" ? "Tự" : "Manager";

  const [rating, setRating] = useState<RatingScale | "">(
    initialData?.rating || "",
  );
  const [strengths, setStrengths] = useState(initialData?.strengths || "");
  const [weaknesses, setWeaknesses] = useState(initialData?.weaknesses || "");
  const [goals, setGoals] = useState(initialData?.goals || "");
  const [scores, setScores] = useState<Record<string, number>>(
    initialData?.competencyScores || {},
  );

  const submitMut = useMutation({
    mutationFn: async () => {
      const endpoint =
        type === "self"
          ? `/api/reviews/r/${reviewId}/self`
          : `/api/reviews/r/${reviewId}/manager`;

      const body =
        type === "self"
          ? {
              selfRating: rating,
              selfStrengths: strengths,
              selfWeaknesses: weaknesses,
              selfGoals: goals,
              competencyScores: scores,
            }
          : {
              managerRating: rating,
              managerStrengths: strengths,
              managerWeaknesses: weaknesses,
              managerGoals: goals,
              competencyScores: scores,
            };

      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review"] });
      toast({ title: `${prefix} đánh giá đã được gửi` });
    },
    onError: (err) => {
      toast({ title: "Lỗi", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{prefix} Đánh Giá</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rating */}
        <div>
          <Label>Điểm tổng thể *</Label>
          <Select
            value={rating || undefined}
            onValueChange={(v) => setRating(v as RatingScale)}
            disabled={readOnly}
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

        {/* Competency scores */}
        <div>
          <Label className="mb-2 block">Năng Lực Cốt Lõi</Label>
          <CompetencyRater
            scores={scores}
            onChange={setScores}
            readOnly={readOnly}
          />
        </div>

        {/* Text fields */}
        <div>
          <Label>Điểm mạnh *</Label>
          <Textarea
            className="mt-1"
            rows={3}
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            placeholder="Mô tả điểm mạnh (tối thiểu 50 ký tự)..."
            disabled={readOnly}
          />
          <div className="text-xs text-muted-foreground text-right">
            {strengths.length}/50
          </div>
        </div>

        <div>
          <Label>Điểm cần cải thiện *</Label>
          <Textarea
            className="mt-1"
            rows={3}
            value={weaknesses}
            onChange={(e) => setWeaknesses(e.target.value)}
            placeholder="Mô tả điểm cần cải thiện (tối thiểu 50 ký tự)..."
            disabled={readOnly}
          />
          <div className="text-xs text-muted-foreground text-right">
            {weaknesses.length}/50
          </div>
        </div>

        <div>
          <Label>Mục tiêu *</Label>
          <Textarea
            className="mt-1"
            rows={3}
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            placeholder="Mô tả mục tiêu phát triển (tối thiểu 50 ký tự)..."
            disabled={readOnly}
          />
          <div className="text-xs text-muted-foreground text-right">
            {goals.length}/50
          </div>
        </div>

        {!readOnly && (
          <Button
            className="w-full"
            style={{ backgroundColor: "#1E3A5F" }}
            disabled={
              submitMut.isPending ||
              !rating ||
              strengths.length < 50 ||
              weaknesses.length < 50 ||
              goals.length < 50
            }
            onClick={() => submitMut.mutate()}
          >
            {submitMut.isPending ? "Đang gửi..." : `Nộp ${prefix} Đánh Giá`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
