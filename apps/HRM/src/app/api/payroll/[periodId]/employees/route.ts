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

// GET /api/payroll/[periodId]/employees — List employee payrolls
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
    select: { id: true, status: true },
  });
  if (!period) {
    return NextResponse.json(
      { error: "Không tìm thấy bảng lương" },
      { status: 404 },
    );
  }

  const employeePayrolls = await prisma.employeePayroll.findMany({
    where: { periodId },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          fullName: true,
          status: true,
          department: { select: { name: true } },
          position: { select: { name: true } },
        },
      },
      _count: { select: { items: true } },
    },
    orderBy: { employee: { employeeCode: "asc" } },
  });

  // Summary
  const totals = {
    totalNet: 0,
    totalEmployeeIns: 0,
    totalEmployerIns: 0,
    totalPIT: 0,
    totalIncome: 0,
  };
  for (const ep of employeePayrolls) {
    totals.totalNet += Number(ep.netSalary);
    totals.totalEmployeeIns += Number(ep.totalEmployeeIns);
    totals.totalEmployerIns += Number(ep.totalEmployerIns);
    totals.totalPIT += Number(ep.pitAmount);
    totals.totalIncome += Number(ep.totalIncome);
  }

  return NextResponse.json({
    data: employeePayrolls,
    totals,
    periodStatus: period.status,
  });
}
