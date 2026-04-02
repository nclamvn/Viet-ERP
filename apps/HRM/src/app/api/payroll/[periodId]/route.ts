import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const PAYROLL_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "HR_MANAGER",
  "HR_STAFF",
  "ACCOUNTANT",
];

// GET /api/payroll/[periodId] — Period detail
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ periodId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!PAYROLL_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { periodId } = await params;

  const period = await prisma.payrollPeriod.findUnique({
    where: { id: periodId },
    include: {
      createdByUser: { select: { name: true } },
      _count: { select: { employeePayrolls: true } },
    },
  });

  if (!period) {
    return NextResponse.json(
      { error: "Không tìm thấy bảng lương" },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: period });
}
