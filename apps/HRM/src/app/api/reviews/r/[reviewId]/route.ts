import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { reviewId } = await params;

  const review = await prisma.employeeReview.findUnique({
    where: { id: reviewId },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          fullName: true,
          userId: true,
          department: { select: { name: true } },
          position: { select: { name: true } },
        },
      },
      reviewer: { select: { id: true, name: true } },
      period: {
        select: {
          id: true,
          name: true,
          cycle: true,
          endDate: true,
          year: true,
        },
      },
    },
  });

  if (!review)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isHR = HR_ROLES.includes(session.user.role);
  const isReviewer = review.reviewerId === session.user.id;
  const isEmployee = review.employee.userId === session.user.id;

  // Access control
  if (!isHR && !isReviewer && !isEmployee) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Strip sensitive fields for employee if not COMPLETED
  if (isEmployee && !isHR && !isReviewer && review.status !== "COMPLETED") {
    return NextResponse.json({
      data: {
        ...review,
        managerRating: null,
        managerStrengths: null,
        managerWeaknesses: null,
        managerGoals: null,
        finalRating: null,
        hrNotes: null,
      },
    });
  }

  return NextResponse.json({ data: review });
}
