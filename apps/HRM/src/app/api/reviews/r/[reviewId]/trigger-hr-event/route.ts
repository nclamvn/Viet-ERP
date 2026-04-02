import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HREventType } from ".prisma/hrm-client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["SUPER_ADMIN", "HR_MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { reviewId } = await params;

  const review = await prisma.employeeReview.findUnique({
    where: { id: reviewId },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          departmentId: true,
          positionId: true,
          department: { select: { name: true } },
          position: { select: { name: true } },
          contracts: {
            where: { status: "ACTIVE" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { baseSalary: true },
          },
        },
      },
    },
  });

  if (!review)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (review.status !== "COMPLETED") {
    return NextResponse.json(
      { error: "Review must be COMPLETED before triggering HR event" },
      { status: 400 },
    );
  }

  if (review.triggeredHREventId) {
    return NextResponse.json(
      { error: "HR event already triggered for this review" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { eventType, effectiveDate, note } = body;

  const validTypes: HREventType[] = ["PROMOTION", "SALARY_ADJUSTMENT"];
  if (!validTypes.includes(eventType)) {
    return NextResponse.json(
      { error: "eventType must be PROMOTION or SALARY_ADJUSTMENT" },
      { status: 400 },
    );
  }

  // Build enriched payload
  const enrichedPayload: Record<string, string | number | boolean | null> = {
    fromReviewId: reviewId,
    reviewFinalRating: review.finalRating,
  };

  if (eventType === "PROMOTION") {
    enrichedPayload.fromPositionId = review.employee.positionId;
    enrichedPayload.fromPositionName = review.employee.position?.name || null;
  }
  if (eventType === "SALARY_ADJUSTMENT") {
    enrichedPayload.fromSalary = review.employee.contracts[0]?.baseSalary
      ? Number(review.employee.contracts[0].baseSalary)
      : null;
  }

  const hrEvent = await prisma.hREvent.create({
    data: {
      employeeId: review.employee.id,
      type: eventType,
      requestedBy: session.user.id,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
      payload: enrichedPayload,
      note: note || `Từ đánh giá năng lực - ${review.finalRating}`,
    },
  });

  // Link event to review
  await prisma.employeeReview.update({
    where: { id: reviewId },
    data: { triggeredHREventId: hrEvent.id },
  });

  return NextResponse.json({ data: hrEvent }, { status: 201 });
}
