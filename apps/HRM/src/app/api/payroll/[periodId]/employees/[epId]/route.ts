import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { calculatePayroll } from "@/lib/calculators/payroll";

const PAYROLL_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "HR_MANAGER",
  "HR_STAFF",
  "ACCOUNTANT",
];

// GET /api/payroll/[periodId]/employees/[epId] — Employee payroll detail
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ periodId: string; epId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!PAYROLL_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { epId } = await params;

  const ep = await prisma.employeePayroll.findUnique({
    where: { id: epId },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          fullName: true,
          status: true,
          department: { select: { name: true } },
        },
      },
      items: { orderBy: { createdAt: "asc" } },
      period: { select: { status: true } },
    },
  });

  if (!ep) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  return NextResponse.json({ data: ep });
}

// PUT /api/payroll/[periodId]/employees/[epId] — Update + auto recalculate
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ periodId: string; epId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { periodId, epId } = await params;

  const period = await prisma.payrollPeriod.findUnique({
    where: { id: periodId },
    select: { status: true },
  });
  if (!period) {
    return NextResponse.json(
      { error: "Không tìm thấy bảng lương" },
      { status: 404 },
    );
  }
  if (period.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Bảng lương đã duyệt, không thể chỉnh sửa" },
      { status: 400 },
    );
  }

  const body = await request.json();
  const { actualDays, standardDays, advanceDeduction, notes } = body;

  // Update allowed fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {};
  if (actualDays !== undefined) updateData.actualDays = actualDays;
  if (standardDays !== undefined) updateData.standardDays = standardDays;
  if (advanceDeduction !== undefined)
    updateData.advanceDeduction = advanceDeduction;
  if (notes !== undefined) updateData.notes = notes;

  await prisma.employeePayroll.update({
    where: { id: epId },
    data: updateData,
  });

  // Recalculate
  const ep = await prisma.employeePayroll.findUnique({
    where: { id: epId },
    include: {
      items: true,
      employee: { select: { status: true } },
    },
  });
  if (!ep) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  const itemSums: Record<string, number> = {};
  for (const item of ep.items) {
    itemSums[item.type] = (itemSums[item.type] || 0) + Number(item.amount);
  }

  const isProbation = ep.employee.status === "PROBATION";

  const result = calculatePayroll({
    baseSalary: Number(ep.baseSalary),
    mealAllowance: Number(ep.mealAllowance),
    phoneAllowance: Number(ep.phoneAllowance),
    fuelAllowance: Number(ep.fuelAllowance),
    perfAllowance: Number(ep.perfAllowance),
    actualDays: Number(ep.actualDays),
    standardDays: Number(ep.standardDays),
    otWeekday: itemSums["OT_WEEKDAY"] || 0,
    otWeekend: itemSums["OT_WEEKEND"] || 0,
    otHoliday: itemSums["OT_HOLIDAY"] || 0,
    nightShift: itemSums["NIGHT_SHIFT"] || 0,
    businessTrip: itemSums["BUSINESS_TRIP"] || 0,
    hazardAllowance: itemSums["HAZARD_ALLOWANCE"] || 0,
    otherAllowance: itemSums["OTHER_ALLOWANCE"] || 0,
    kpiCurrent: itemSums["KPI_CURRENT"] || 0,
    kpiPrev1: itemSums["KPI_PREV1"] || 0,
    kpiPrev2: itemSums["KPI_PREV2"] || 0,
    advanceDeduction: Number(ep.advanceDeduction),
    dependentCount: ep.dependentCount,
    isProbation,
  });

  const updated = await prisma.employeePayroll.update({
    where: { id: epId },
    data: {
      totalContractSalary: result.totalContractSalary,
      totalActualSalary: result.totalActualSalary,
      totalIncome: result.totalIncome,
      insuranceBase: result.insuranceBase,
      bhxhEmployee: result.bhxhEmployee,
      bhytEmployee: result.bhytEmployee,
      bhtnEmployee: result.bhtnEmployee,
      totalEmployeeIns: result.totalEmployeeIns,
      personalDeduction: result.personalDeduction,
      dependentDeduction: result.dependentDeduction,
      taxableIncome: result.taxableIncome,
      pitAmount: result.pitAmount,
      netSalary: result.netSalary,
      bhxhEmployer: result.bhxhEmployer,
      bhytEmployer: result.bhytEmployer,
      bhtnEmployer: result.bhtnEmployer,
      bhtnldEmployer: result.bhtnldEmployer,
      totalEmployerIns: result.totalEmployerIns,
    },
  });

  return NextResponse.json({ data: updated });
}
