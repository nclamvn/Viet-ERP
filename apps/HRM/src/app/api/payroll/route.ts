import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const PAYROLL_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "HR_MANAGER",
  "HR_STAFF",
  "ACCOUNTANT",
];

// GET /api/payroll — List payroll periods
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!PAYROLL_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const periods = await prisma.payrollPeriod.findMany({
    include: {
      _count: { select: { employeePayrolls: true } },
      employeePayrolls: {
        select: { netSalary: true, totalEmployerIns: true },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });

  const data = periods.map((p) => {
    const totalNet = p.employeePayrolls.reduce(
      (sum, ep) => sum + Number(ep.netSalary),
      0,
    );
    const totalEmployerIns = p.employeePayrolls.reduce(
      (sum, ep) => sum + Number(ep.totalEmployerIns),
      0,
    );
    return {
      id: p.id,
      month: p.month,
      year: p.year,
      status: p.status,
      employeeCount: p._count.employeePayrolls,
      totalNet,
      totalCost: totalNet + totalEmployerIns,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    };
  });

  return NextResponse.json({ data });
}

// POST /api/payroll — Create new period
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { month, year, notes } = body;

  if (!month || !year || month < 1 || month > 12) {
    return NextResponse.json(
      { error: "Tháng/năm không hợp lệ" },
      { status: 400 },
    );
  }

  const existing = await prisma.payrollPeriod.findUnique({
    where: { month_year: { month, year } },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Bảng lương tháng ${month}/${year} đã tồn tại` },
      { status: 409 },
    );
  }

  const period = await prisma.payrollPeriod.create({
    data: {
      month,
      year,
      notes: notes || null,
      createdBy: session.user.id,
    },
  });

  return NextResponse.json({ data: period }, { status: 201 });
}
