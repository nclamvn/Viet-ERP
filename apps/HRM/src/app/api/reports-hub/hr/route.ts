import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const ALLOWED_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

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
  const quarter = searchParams.get("quarter")
    ? parseInt(searchParams.get("quarter")!, 10)
    : null;

  // Determine month range
  let startMonth = 1;
  let endMonth = 12;
  if (quarter && quarter >= 1 && quarter <= 4) {
    startMonth = (quarter - 1) * 3 + 1;
    endMonth = quarter * 3;
  }

  // ─── Headcount by month ───
  const headcountByMonth = [];
  for (let m = startMonth; m <= endMonth; m++) {
    const endOfMonth = new Date(year, m, 0, 23, 59, 59); // last day of month
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

  // ─── Movements ───
  const yearStart = new Date(year, startMonth - 1, 1);
  const yearEnd = new Date(year, endMonth, 0, 23, 59, 59);

  const newHiresList = await prisma.employee.findMany({
    where: {
      startDate: { gte: yearStart, lte: yearEnd },
    },
    select: {
      id: true,
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
      id: true,
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
      id: true,
      effectiveDate: true,
      payload: true,
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
      id: true,
      effectiveDate: true,
      payload: true,
      employee: { select: { employeeCode: true, fullName: true } },
    },
    orderBy: { effectiveDate: "desc" },
  });

  const movements = {
    newHires: { count: newHiresList.length, employees: newHiresList },
    resignations: {
      count: resignationsList.length,
      employees: resignationsList,
    },
    transfers: { count: transfersList.length, employees: transfersList },
    promotions: { count: promotionsList.length, employees: promotionsList },
  };

  // ─── Turnover rate ───
  const avgHeadcount =
    headcountByMonth.length > 0
      ? headcountByMonth.reduce((s, h) => s + h.total, 0) /
        headcountByMonth.length
      : 1;
  const turnoverRate =
    avgHeadcount > 0
      ? Math.round((resignationsList.length / avgHeadcount) * 100 * 10) / 10
      : 0;

  // ─── Distribution ───
  const byDepartmentRaw = await prisma.employee.groupBy({
    by: ["departmentId"],
    where: { status: { in: ["ACTIVE", "PROBATION"] } },
    _count: { id: true },
  });

  const departments = await prisma.department.findMany({
    select: { id: true, name: true },
  });
  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  const totalActive = byDepartmentRaw.reduce((s, d) => s + d._count.id, 0);

  const byDepartment = byDepartmentRaw
    .map((d) => ({
      department: deptMap.get(d.departmentId || "") || "Chưa phân bổ",
      count: d._count.id,
      percentage:
        totalActive > 0
          ? Math.round((d._count.id / totalActive) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const byContractTypeRaw = await prisma.contract.groupBy({
    by: ["type"],
    where: {
      status: { in: ["ACTIVE", "DRAFT"] },
      employee: { status: { in: ["ACTIVE", "PROBATION"] } },
    },
    _count: { id: true },
  });

  const CONTRACT_LABELS: Record<string, string> = {
    PROBATION: "Thử việc",
    DEFINITE_TERM: "Có thời hạn",
    INDEFINITE_TERM: "Vô thời hạn",
    SEASONAL: "Thời vụ",
    PART_TIME: "Bán thời gian",
    INTERN: "Thực tập",
  };
  const byContractType = byContractTypeRaw.map((c) => ({
    type: c.type,
    count: c._count.id,
    label: CONTRACT_LABELS[c.type] || c.type,
  }));

  const genderRaw = await prisma.employee.groupBy({
    by: ["gender"],
    where: { status: { in: ["ACTIVE", "PROBATION"] } },
    _count: { id: true },
  });
  const byGender = {
    male: genderRaw.find((g) => g.gender === "MALE")?._count.id || 0,
    female: genderRaw.find((g) => g.gender === "FEMALE")?._count.id || 0,
  };

  // ─── Expiring contracts (60 days) ───
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
      employee: { select: { employeeCode: true, fullName: true } },
    },
    orderBy: { officialTo: "asc" },
  });

  const expiringList = expiringContracts.map((c) => ({
    employee: `${c.employee.employeeCode} ${c.employee.fullName}`,
    contractNo: c.contractNo,
    officialTo: c.officialTo?.toISOString(),
    daysLeft: c.officialTo
      ? Math.ceil(
          (c.officialTo.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        )
      : 0,
  }));

  return NextResponse.json({
    headcountByMonth,
    movements,
    turnoverRate,
    byDepartment,
    byContractType,
    byGender,
    expiringContracts: expiringList,
  });
}
