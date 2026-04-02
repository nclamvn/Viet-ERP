import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { notificationService } from "@/lib/services/notification.service";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

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
      employee: { select: { userId: true, fullName: true } },
      period: { select: { name: true } },
    },
  });

  if (!review)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Access: only the employee themselves or HR
  const isHR = HR_ROLES.includes(session.user.role);
  const isEmployee = review.employee.userId === session.user.id;

  if (!isHR && !isEmployee) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (review.status !== "SELF_PENDING") {
    return NextResponse.json(
      { error: "Review is not in SELF_PENDING status" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const {
    selfRating,
    selfStrengths,
    selfWeaknesses,
    selfGoals,
    competencyScores,
  } = body;

  if (!selfRating || !selfStrengths || !selfWeaknesses || !selfGoals) {
    return NextResponse.json(
      { error: "All self-assessment fields required" },
      { status: 400 },
    );
  }

  const updated = await prisma.employeeReview.update({
    where: { id: reviewId },
    data: {
      selfRating,
      selfStrengths,
      selfWeaknesses,
      selfGoals,
      competencyScores: competencyScores ?? undefined,
      selfSubmittedAt: new Date(),
      status: "MANAGER_PENDING",
    },
  });

  // Notify reviewer (manager)
  try {
    await notificationService.create({
      userId: review.reviewerId,
      type: "REVIEW",
      title: "Nhân viên đã tự đánh giá",
      message: `${review.employee.fullName} đã hoàn thành tự đánh giá trong đợt "${review.period.name}". Đến lượt bạn đánh giá.`,
      link: `/reviews/r/${reviewId}`,
    });
  } catch {
    /* non-blocking */
  }

  return NextResponse.json({ data: updated });
}
