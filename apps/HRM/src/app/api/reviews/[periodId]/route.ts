import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ periodId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!HR_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { periodId } = await params;

  const period = await prisma.reviewPeriod.findUnique({
    where: { id: periodId },
    include: {
      _count: { select: { reviews: true } },
      creator: { select: { name: true } },
    },
  });

  if (!period)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const statusCounts = await prisma.employeeReview.groupBy({
    by: ["status"],
    where: { periodId },
    _count: { id: true },
  });

  return NextResponse.json({
    data: {
      ...period,
      statusCounts: statusCounts.map((s) => ({
        status: s.status,
        count: s._count.id,
      })),
    },
  });
}
