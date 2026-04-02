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

  const periods = await prisma.payrollPeriod.findMany({
    where: { year, status: { not: "CANCELLED" } },
    select: {
      month: true,
      status: true,
      employeePayrolls: {
        select: {
          totalIncome: true,
          netSalary: true,
          totalEmployerIns: true,
          employee: {
            select: {
              departmentId: true,
              department: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { month: "asc" },
  });

  const byMonth = periods.map((p) => {
    const totalGross = p.employeePayrolls.reduce(
      (s, e) => s + Number(e.totalIncome),
      0,
    );
    const totalNet = p.employeePayrolls.reduce(
      (s, e) => s + Number(e.netSalary),
      0,
    );
    const totalEmployerIns = p.employeePayrolls.reduce(
      (s, e) => s + Number(e.totalEmployerIns),
      0,
    );
    return {
      month: p.month,
      status: p.status,
      employeeCount: p.employeePayrolls.length,
      totalGross: Math.round(totalGross),
      totalNet: Math.round(totalNet),
      totalEmployerIns: Math.round(totalEmployerIns),
      totalCost: Math.round(totalNet + totalEmployerIns),
    };
  });

  // By department: aggregate from latest APPROVED/PAID period
  const latestPeriod = periods
    .filter((p) => p.status === "PAID" || p.status === "APPROVED")
    .pop();
  const deptMap = new Map<
    string,
    {
      department: string;
      totalSalary: number;
      totalCost: number;
      headcount: number;
    }
  >();

  if (latestPeriod) {
    for (const ep of latestPeriod.employeePayrolls) {
      const deptName = ep.employee.department?.name || "Chưa phân bổ";
      const existing = deptMap.get(deptName);
      const net = Number(ep.netSalary);
      const ins = Number(ep.totalEmployerIns);
      if (existing) {
        existing.totalSalary += net;
        existing.totalCost += net + ins;
        existing.headcount += 1;
      } else {
        deptMap.set(deptName, {
          department: deptName,
          totalSalary: net,
          totalCost: net + ins,
          headcount: 1,
        });
      }
    }
  }

  const byDepartment = Array.from(deptMap.values())
    .map((d) => ({
      ...d,
      avgSalary: d.headcount > 0 ? Math.round(d.totalSalary / d.headcount) : 0,
      totalCost: Math.round(d.totalCost),
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  // Year summary
  const totalLaborCost = byMonth.reduce((s, m) => s + m.totalCost, 0);
  const monthsWithData = byMonth.filter((m) => m.totalCost > 0);
  const yearSummary = {
    totalLaborCost,
    avgMonthlyCost:
      monthsWithData.length > 0
        ? Math.round(totalLaborCost / monthsWithData.length)
        : 0,
    highestMonth:
      monthsWithData.length > 0
        ? monthsWithData.reduce((max, m) =>
            m.totalCost > max.totalCost ? m : max,
          ).month
        : 0,
    lowestMonth:
      monthsWithData.length > 0
        ? monthsWithData.reduce((min, m) =>
            m.totalCost < min.totalCost ? m : min,
          ).month
        : 0,
  };

  return NextResponse.json({ byMonth, byDepartment, yearSummary });
}
