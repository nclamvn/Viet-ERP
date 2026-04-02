import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { notificationService } from "@/lib/services/notification.service";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER"];

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { reviewId } = await params;

  const review = await prisma.employeeReview.findUnique({
    where: { id: reviewId },
    include: {
      employee: { select: { fullName: true } },
      period: { select: { name: true } },
      reviewer: { select: { id: true, name: true } },
    },
  });

  if (!review)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Access: only the assigned reviewer or HR_MANAGER+
  const isHR = HR_ROLES.includes(session.user.role);
  const isReviewer = review.reviewerId === session.user.id;

  if (!isHR && !isReviewer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (review.status !== "MANAGER_PENDING") {
    return NextResponse.json(
      { error: "Review is not in MANAGER_PENDING status" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const {
    managerRating,
    managerStrengths,
    managerWeaknesses,
    managerGoals,
    competencyScores,
  } = body;

  if (
    !managerRating ||
    !managerStrengths ||
    !managerWeaknesses ||
    !managerGoals
  ) {
    return NextResponse.json(
      { error: "All manager assessment fields required" },
      { status: 400 },
    );
  }

  const updated = await prisma.employeeReview.update({
    where: { id: reviewId },
    data: {
      managerRating,
      managerStrengths,
      managerWeaknesses,
      managerGoals,
      competencyScores: competencyScores ?? undefined,
      managerSubmittedAt: new Date(),
      status: "HR_REVIEWING",
    },
  });

  // Notify HR
  try {
    await notificationService.notifyHR({
      type: "REVIEW",
      title: "Đánh giá Manager hoàn thành",
      message: `${review.reviewer.name} đã đánh giá ${review.employee.fullName} trong đợt "${review.period.name}". Cần tổng hợp.`,
      link: `/reviews/r/${reviewId}`,
    });
  } catch {
    /* non-blocking */
  }

  return NextResponse.json({ data: updated });
}
