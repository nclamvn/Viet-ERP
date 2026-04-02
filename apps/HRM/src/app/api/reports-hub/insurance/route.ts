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
  const month = parseInt(
    searchParams.get("month") || String(new Date().getMonth() + 1),
    10,
  );
  const year = parseInt(
    searchParams.get("year") || String(new Date().getFullYear()),
    10,
  );

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  // New registrations: employees whose startDate is in this month
  const newRegistrations = await prisma.employee.findMany({
    where: {
      startDate: { gte: monthStart, lte: monthEnd },
    },
    select: {
      fullName: true,
      dateOfBirth: true,
      gender: true,
      nationalId: true,
      insuranceCode: true,
      startDate: true,
      contracts: {
        where: { status: { in: ["ACTIVE", "DRAFT"] } },
        select: { baseSalary: true },
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { fullName: "asc" },
  });

  // Terminations: employees who resigned this month
  const terminations = await prisma.employee.findMany({
    where: {
      resignDate: { gte: monthStart, lte: monthEnd },
      status: { in: ["RESIGNED", "TERMINATED"] },
    },
    select: {
      fullName: true,
      dateOfBirth: true,
      gender: true,
      nationalId: true,
      insuranceCode: true,
      resignDate: true,
      contracts: {
        where: { status: { in: ["ACTIVE", "DRAFT"] } },
        select: { baseSalary: true },
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { fullName: "asc" },
  });

  // Salary adjustments: HR events of type SALARY_ADJUSTMENT approved this month
  const salaryAdjustments = await prisma.hREvent.findMany({
    where: {
      type: "SALARY_ADJUSTMENT",
      status: "APPROVED",
      effectiveDate: { gte: monthStart, lte: monthEnd },
    },
    select: {
      payload: true,
      effectiveDate: true,
      employee: {
        select: {
          fullName: true,
          dateOfBirth: true,
          gender: true,
          nationalId: true,
          insuranceCode: true,
        },
      },
    },
    orderBy: { effectiveDate: "asc" },
  });

  const formatDate = (d: Date | null) => {
    if (!d) return "";
    return d.toLocaleDateString("vi-VN");
  };

  const d02 = {
    newRegistrations: newRegistrations.map((e, i) => ({
      stt: i + 1,
      fullName: e.fullName,
      dateOfBirth: formatDate(e.dateOfBirth),
      gender:
        e.gender === "MALE" ? "Nam" : e.gender === "FEMALE" ? "Nữ" : "Khác",
      nationalId: e.nationalId || "",
      insuranceCode: e.insuranceCode || "",
      salary: e.contracts[0]?.baseSalary
        ? Number(e.contracts[0].baseSalary)
        : 0,
      fromDate: formatDate(e.startDate),
      hospital: "",
    })),
    terminations: terminations.map((e, i) => ({
      stt: i + 1,
      fullName: e.fullName,
      dateOfBirth: formatDate(e.dateOfBirth),
      gender:
        e.gender === "MALE" ? "Nam" : e.gender === "FEMALE" ? "Nữ" : "Khác",
      nationalId: e.nationalId || "",
      insuranceCode: e.insuranceCode || "",
      salary: e.contracts[0]?.baseSalary
        ? Number(e.contracts[0].baseSalary)
        : 0,
      toDate: formatDate(e.resignDate),
    })),
    salaryAdjustments: salaryAdjustments.map((ev, i) => ({
      stt: i + 1,
      fullName: ev.employee.fullName,
      dateOfBirth: formatDate(ev.employee.dateOfBirth),
      gender:
        ev.employee.gender === "MALE"
          ? "Nam"
          : ev.employee.gender === "FEMALE"
            ? "Nữ"
            : "Khác",
      nationalId: ev.employee.nationalId || "",
      insuranceCode: ev.employee.insuranceCode || "",
      effectiveDate: formatDate(ev.effectiveDate),
      payload: ev.payload,
    })),
  };

  // Summary: all active employees and their insurance contributions
  // Get from payroll if available, otherwise count from employees
  const payrollPeriod = await prisma.payrollPeriod.findUnique({
    where: { month_year: { month, year } },
    select: {
      employeePayrolls: {
        select: {
          insuranceBase: true,
          bhxhEmployee: true,
          bhytEmployee: true,
          bhtnEmployee: true,
          totalEmployeeIns: true,
          bhxhEmployer: true,
          bhytEmployer: true,
          bhtnEmployer: true,
          bhtnldEmployer: true,
          totalEmployerIns: true,
        },
      },
    },
  });

  let summary;
  if (payrollPeriod && payrollPeriod.employeePayrolls.length > 0) {
    const eps = payrollPeriod.employeePayrolls;
    const totalSalaryFund = eps.reduce(
      (s, e) => s + Number(e.insuranceBase),
      0,
    );
    const employeeContrib = eps.reduce(
      (s, e) => s + Number(e.totalEmployeeIns),
      0,
    );
    const employerContrib = eps.reduce(
      (s, e) => s + Number(e.totalEmployerIns),
      0,
    );
    summary = {
      totalEmployees: eps.length,
      totalSalaryFund: Math.round(totalSalaryFund),
      employeeContrib: Math.round(employeeContrib),
      employerContrib: Math.round(employerContrib),
      totalContrib: Math.round(employeeContrib + employerContrib),
    };
  } else {
    // Fallback: count active employees
    const activeCount = await prisma.employee.count({
      where: { status: { in: ["ACTIVE", "PROBATION"] } },
    });
    summary = {
      totalEmployees: activeCount,
      totalSalaryFund: 0,
      employeeContrib: 0,
      employerContrib: 0,
      totalContrib: 0,
    };
  }

  return NextResponse.json({ d02, summary, month, year });
}
