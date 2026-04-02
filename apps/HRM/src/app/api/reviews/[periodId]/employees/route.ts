import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ periodId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { periodId } = await params;
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");

  // HR can see all, DEPT_MANAGER sees their reviews, EMPLOYEE sees own
  const isHR = HR_ROLES.includes(session.user.role);
  const isDeptManager = session.user.role === "DEPT_MANAGER";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { periodId };
  if (statusFilter) where.status = statusFilter;

  if (!isHR) {
    if (isDeptManager) {
      where.reviewerId = session.user.id;
    } else {
      // Employee: find their employee record
      const emp = await prisma.employee.findFirst({
        where: { userId: session.user.id },
        select: { id: true },
      });
      if (!emp)
        return NextResponse.json({
          data: [],
          totalCount: 0,
          completedCount: 0,
        });
      where.employeeId = emp.id;
    }
  }

  const reviews = await prisma.employeeReview.findMany({
    where,
    include: {
      employee: {
        select: {
          employeeCode: true,
          fullName: true,
          department: { select: { name: true } },
          position: { select: { name: true } },
        },
      },
      reviewer: { select: { name: true } },
    },
    orderBy: { employee: { fullName: "asc" } },
  });

  // Count stats
  const totalCount = reviews.length;
  const completedCount = reviews.filter((r) => r.status === "COMPLETED").length;

  return NextResponse.json({ data: reviews, totalCount, completedCount });
}
