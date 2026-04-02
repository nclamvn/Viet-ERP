import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { generateInsuranceExcel } from "@/lib/export/insurance-excel";
import { generateTaxExcel } from "@/lib/export/tax-excel";
import { generateHRReportExcel } from "@/lib/export/hr-report-excel";

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
  const type = searchParams.get("type");
  const month = parseInt(
    searchParams.get("month") || String(new Date().getMonth() + 1),
    10,
  );
  const year = parseInt(
    searchParams.get("year") || String(new Date().getFullYear()),
    10,
  );

  // Load system settings
  const settings = await prisma.systemSetting.findMany();
  const settingsMap = new Map(settings.map((s) => [s.key, s.value]));

  if (type === "insurance") {
    // Gather insurance data
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    const allActive = await prisma.employee.findMany({
      where: { status: { in: ["ACTIVE", "PROBATION"] } },
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

    const newRegs = await prisma.employee.findMany({
      where: { startDate: { gte: monthStart, lte: monthEnd } },
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

    const terms = await prisma.employee.findMany({
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
          select: { baseSalary: true },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { fullName: "asc" },
    });

    const buffer = generateInsuranceExcel({
      companyName: settingsMap.get("companyName") || "",
      companyInsuranceCode: settingsMap.get("companyInsuranceCode") || "",
      month,
      year,
      allEmployees: allActive,
      newRegistrations: newRegs,
      terminations: terms,
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="D02-TS_${String(month).padStart(2, "0")}_${year}.xlsx"`,
      },
    });
  }

  if (type === "tax") {
    // Gather tax data
    const periods = await prisma.payrollPeriod.findMany({
      where: { year, status: { in: ["APPROVED", "PAID"] } },
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
    });

    // Aggregate by employee
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

    const employees = Array.from(empMap.values()).sort((a, b) =>
      a.employeeCode.localeCompare(b.employeeCode),
    );

    const buffer = generateTaxExcel({
      companyName: settingsMap.get("companyName") || "",
      companyTaxCode: settingsMap.get("companyTaxCode") || "",
      taxAgency: settingsMap.get("companyTaxAgency") || "",
      year,
      employees,
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="05_QTT-TNCN_${year}.xlsx"`,
      },
    });
  }

  if (type === "hr") {
    const quarter = searchParams.get("quarter")
      ? parseInt(searchParams.get("quarter")!, 10)
      : null;

    let startMonth = 1;
    let endMonth = 12;
    if (quarter && quarter >= 1 && quarter <= 4) {
      startMonth = (quarter - 1) * 3 + 1;
      endMonth = quarter * 3;
    }

    // Headcount by month
    const headcountByMonth = [];
    for (let m = startMonth; m <= endMonth; m++) {
      const endOfMonth = new Date(year, m, 0, 23, 59, 59);
      const active = await prisma.employee.count({
        where: {
          status: "ACTIVE",
          startDate: { lte: endOfMonth },
          OR: [{ resignDate: null }, { resignDate: { gt: endOfMonth } }],
        },
      });
      const probation = await prisma.employee.count({
        where: {
          status: "PROBATION",
          startDate: { lte: endOfMonth },
          OR: [{ resignDate: null }, { resignDate: { gt: endOfMonth } }],
        },
      });
      headcountByMonth.push({
        month: m,
        active,
        probation,
        total: active + probation,
      });
    }

    // Movements
    const yearStart = new Date(year, startMonth - 1, 1);
    const yearEnd = new Date(year, endMonth, 0, 23, 59, 59);

    const newHiresList = await prisma.employee.findMany({
      where: { startDate: { gte: yearStart, lte: yearEnd } },
      select: {
        employeeCode: true,
        fullName: true,
        startDate: true,
        department: { select: { name: true } },
      },
      orderBy: { startDate: "desc" },
    });

    const resignationsList = await prisma.employee.findMany({
      where: {
        resignDate: { gte: yearStart, lte: yearEnd },
        status: { in: ["RESIGNED", "TERMINATED"] },
      },
      select: {
        employeeCode: true,
        fullName: true,
        resignDate: true,
        department: { select: { name: true } },
      },
      orderBy: { resignDate: "desc" },
    });

    const transfersList = await prisma.hREvent.findMany({
      where: {
        type: "DEPARTMENT_TRANSFER",
        status: "APPROVED",
        effectiveDate: { gte: yearStart, lte: yearEnd },
      },
      select: {
        effectiveDate: true,
        employee: { select: { employeeCode: true, fullName: true } },
      },
      orderBy: { effectiveDate: "desc" },
    });

    const promotionsList = await prisma.hREvent.findMany({
      where: {
        type: "PROMOTION",
        status: "APPROVED",
        effectiveDate: { gte: yearStart, lte: yearEnd },
      },
      select: {
        effectiveDate: true,
        employee: { select: { employeeCode: true, fullName: true } },
      },
      orderBy: { effectiveDate: "desc" },
    });

    const avgHeadcount =
      headcountByMonth.length > 0
        ? headcountByMonth.reduce((s, h) => s + h.total, 0) /
          headcountByMonth.length
        : 1;
    const turnoverRate =
      avgHeadcount > 0
        ? Math.round((resignationsList.length / avgHeadcount) * 100 * 10) / 10
        : 0;

    // Expiring contracts
    const now = new Date();
    const sixtyDaysLater = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const expiringContracts = await prisma.contract.findMany({
      where: {
        officialTo: { gte: now, lte: sixtyDaysLater },
        status: "ACTIVE",
        employee: { status: { in: ["ACTIVE", "PROBATION"] } },
      },
      select: {
        contractNo: true,
        officialTo: true,
        type: true,
        employee: { select: { employeeCode: true, fullName: true } },
      },
      orderBy: { officialTo: "asc" },
    });

    const CONTRACT_TYPE_LABELS: Record<string, string> = {
      PROBATION: "Thử việc",
      DEFINITE_TERM: "Có thời hạn",
      INDEFINITE_TERM: "Vô thời hạn",
      SEASONAL: "Thời vụ",
      PART_TIME: "Bán thời gian",
      INTERN: "Thực tập",
    };

    const expiringList = expiringContracts.map((c) => ({
      employee: `${c.employee.employeeCode} - ${c.employee.fullName}`,
      contractNo: c.contractNo
        ? `${c.contractNo} (${CONTRACT_TYPE_LABELS[c.type] || c.type})`
        : CONTRACT_TYPE_LABELS[c.type] || c.type,
      officialTo: c.officialTo?.toISOString() || null,
      daysLeft: c.officialTo
        ? Math.ceil(
            (c.officialTo.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
          )
        : 0,
    }));

    const buffer = generateHRReportExcel({
      year,
      quarter: quarter ? String(quarter) : null,
      headcountByMonth,
      movements: {
        newHires: { count: newHiresList.length, employees: newHiresList },
        resignations: {
          count: resignationsList.length,
          employees: resignationsList,
        },
        transfers: { count: transfersList.length, employees: transfersList },
        promotions: { count: promotionsList.length, employees: promotionsList },
      },
      turnoverRate,
      expiringContracts: expiringList,
    });

    const fileName = quarter
      ? `bao-cao-nhan-su-Q${quarter}-${year}.xlsx`
      : `bao-cao-nhan-su-${year}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  }

  return NextResponse.json({ error: "Invalid export type" }, { status: 400 });
}
