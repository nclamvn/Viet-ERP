import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const ALLOWED_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER"];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(
    searchParams.get("year") || String(new Date().getFullYear()),
    10,
  );

  // Get all payroll periods for the year that are APPROVED or PAID
  const periods = await prisma.payrollPeriod.findMany({
    where: {
      year,
      status: { in: ["APPROVED", "PAID"] },
    },
    select: {
      month: true,
      employeePayrolls: {
        select: {
          employeeId: true,
          totalIncome: true,
          personalDeduction: true,
          dependentCount: true,
          dependentDeduction: true,
          taxableIncome: true,
          pitAmount: true,
          employee: {
            select: {
              employeeCode: true,
              fullName: true,
              nationalId: true,
              taxCode: true,
            },
          },
        },
      },
    },
    orderBy: { month: "asc" },
  });

  // Aggregate by month
  const byMonth = periods.map((p) => ({
    month: p.month,
    totalIncome: Math.round(
      p.employeePayrolls.reduce((s, e) => s + Number(e.totalIncome), 0),
    ),
    totalPIT: Math.round(
      p.employeePayrolls.reduce((s, e) => s + Number(e.pitAmount), 0),
    ),
    employeeCount: p.employeePayrolls.length,
  }));

  // Aggregate by employee across all months
  const empMap = new Map<
    string,
    {
      employeeCode: string;
      fullName: string;
      nationalId: string;
      taxCode: string;
      totalIncome: number;
      totalDeductions: number;
      taxableIncome: number;
      pitPaid: number;
      dependentCount: number;
    }
  >();

  for (const period of periods) {
    for (const ep of period.employeePayrolls) {
      const existing = empMap.get(ep.employeeId);
      if (existing) {
        existing.totalIncome += Number(ep.totalIncome);
        existing.totalDeductions +=
          Number(ep.personalDeduction) + Number(ep.dependentDeduction);
        existing.taxableIncome += Number(ep.taxableIncome);
        existing.pitPaid += Number(ep.pitAmount);
        existing.dependentCount = Math.max(
          existing.dependentCount,
          ep.dependentCount,
        );
      } else {
        empMap.set(ep.employeeId, {
          employeeCode: ep.employee.employeeCode,
          fullName: ep.employee.fullName,
          nationalId: ep.employee.nationalId || "",
          taxCode: ep.employee.taxCode || "",
          totalIncome: Number(ep.totalIncome),
          totalDeductions:
            Number(ep.personalDeduction) + Number(ep.dependentDeduction),
          taxableIncome: Number(ep.taxableIncome),
          pitPaid: Number(ep.pitAmount),
          dependentCount: ep.dependentCount,
        });
      }
    }
  }

  const employees = Array.from(empMap.values())
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
    .map((emp, i) => ({
      stt: i + 1,
      ...emp,
      totalIncome: Math.round(emp.totalIncome),
      totalDeductions: Math.round(emp.totalDeductions),
      taxableIncome: Math.round(emp.taxableIncome),
      pitPaid: Math.round(emp.pitPaid),
    }));

  const summary = {
    totalEmployees: employees.length,
    totalIncomePaid: employees.reduce((s, e) => s + e.totalIncome, 0),
    totalPITPaid: employees.reduce((s, e) => s + e.pitPaid, 0),
    year,
  };

  return NextResponse.json({ employees, summary, byMonth });
}
