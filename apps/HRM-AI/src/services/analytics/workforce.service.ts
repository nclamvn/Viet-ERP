// src/services/analytics/workforce.service.ts
// Workforce Analytics Service

import { db } from "@/lib/db";
import type { SnapshotType } from ".prisma/hrm-ai-client";

export interface WorkforceMetrics {
  headcount: {
    total: number;
    active: number;
    probation: number;
    onLeave: number;
    byDepartment: Array<{ department: string; count: number }>;
    byGender: Array<{ gender: string; count: number }>;
    byAge: Array<{ range: string; count: number }>;
    byTenure: Array<{ range: string; count: number }>;
  };
  movement: {
    newHires: number;
    terminations: number;
    promotions: number;
    transfers: number;
    netChange: number;
  };
  turnover: {
    rate: number;
    voluntaryRate: number;
    involuntaryRate: number;
    byDepartment: Array<{ department: string; rate: number }>;
    byReason: Array<{ reason: string; count: number }>;
  };
  retention: {
    rate: number;
    avgTenure: number;
    newHireRetention90Days: number;
  };
}

export interface WorkforceComparisonResult {
  current: WorkforceMetrics;
  previous: WorkforceMetrics;
  changes: {
    headcountChange: number;
    headcountChangePercent: number;
    turnoverChange: number;
    retentionChange: number;
  };
}

export async function getWorkforceMetrics(
  tenantId: string,
  startDate: Date,
  endDate: Date,
): Promise<WorkforceMetrics> {
  const [employees, departments, newHires, terminations] = await Promise.all([
    // Get all employees
    db.employee.findMany({
      where: { tenantId, deletedAt: null },
      include: { department: true },
    }),
    // Get departments
    db.department.findMany({
      where: { tenantId, isActive: true },
    }),
    // New hires in period
    db.employee.count({
      where: {
        tenantId,
        deletedAt: null,
        hireDate: { gte: startDate, lte: endDate },
      },
    }),
    // Terminations in period
    db.employee.count({
      where: {
        tenantId,
        status: { in: ["RESIGNED", "TERMINATED"] },
        updatedAt: { gte: startDate, lte: endDate },
      },
    }),
  ]);

  // Calculate headcount breakdown
  const activeEmployees = employees.filter((e) => e.status === "ACTIVE");
  const probationEmployees = employees.filter((e) => e.status === "PROBATION");
  const onLeaveEmployees = employees.filter((e) => e.status === "ON_LEAVE");

  // By department
  const byDepartment = departments
    .map((dept) => ({
      department: dept.name,
      count: employees.filter((e) => e.departmentId === dept.id).length,
    }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);

  // By gender
  const byGender = [
    {
      gender: "Nam",
      count: employees.filter((e) => e.gender === "MALE").length,
    },
    {
      gender: "Nữ",
      count: employees.filter((e) => e.gender === "FEMALE").length,
    },
    {
      gender: "Khác",
      count: employees.filter(
        (e) => e.gender !== "MALE" && e.gender !== "FEMALE",
      ).length,
    },
  ].filter((g) => g.count > 0);

  // By age
  const now = new Date();
  const getAge = (dob: Date | null) =>
    dob
      ? Math.floor(
          (now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
        )
      : 0;
  const byAge = [
    {
      range: "Dưới 25",
      count: employees.filter((e) => getAge(e.dateOfBirth) < 25).length,
    },
    {
      range: "25-34",
      count: employees.filter(
        (e) => getAge(e.dateOfBirth) >= 25 && getAge(e.dateOfBirth) < 35,
      ).length,
    },
    {
      range: "35-44",
      count: employees.filter(
        (e) => getAge(e.dateOfBirth) >= 35 && getAge(e.dateOfBirth) < 45,
      ).length,
    },
    {
      range: "45-54",
      count: employees.filter(
        (e) => getAge(e.dateOfBirth) >= 45 && getAge(e.dateOfBirth) < 55,
      ).length,
    },
    {
      range: "55+",
      count: employees.filter((e) => getAge(e.dateOfBirth) >= 55).length,
    },
  ].filter((a) => a.count > 0);

  // By tenure
  const getTenureYears = (hireDate: Date) =>
    Math.floor(
      (now.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
    );
  const byTenure = [
    {
      range: "< 1 năm",
      count: employees.filter((e) => getTenureYears(e.hireDate) < 1).length,
    },
    {
      range: "1-2 năm",
      count: employees.filter(
        (e) =>
          getTenureYears(e.hireDate) >= 1 && getTenureYears(e.hireDate) < 3,
      ).length,
    },
    {
      range: "3-5 năm",
      count: employees.filter(
        (e) =>
          getTenureYears(e.hireDate) >= 3 && getTenureYears(e.hireDate) < 6,
      ).length,
    },
    {
      range: "5-10 năm",
      count: employees.filter(
        (e) =>
          getTenureYears(e.hireDate) >= 5 && getTenureYears(e.hireDate) < 10,
      ).length,
    },
    {
      range: "10+ năm",
      count: employees.filter((e) => getTenureYears(e.hireDate) >= 10).length,
    },
  ].filter((t) => t.count > 0);

  // Calculate turnover
  const avgHeadcount = employees.length > 0 ? employees.length : 1;
  const turnoverRate = (terminations / avgHeadcount) * 100;

  // Calculate turnover by department
  const turnoverByDepartment = await Promise.all(
    departments.map(async (dept) => {
      const deptTerminations = await db.employee.count({
        where: {
          tenantId,
          departmentId: dept.id,
          status: { in: ["RESIGNED", "TERMINATED"] },
          updatedAt: { gte: startDate, lte: endDate },
        },
      });
      const deptTotal = employees.filter(
        (e) => e.departmentId === dept.id,
      ).length;
      return {
        department: dept.name,
        rate: deptTotal > 0 ? (deptTerminations / deptTotal) * 100 : 0,
      };
    }),
  );

  // Calculate retention
  const avgTenure =
    employees.length > 0
      ? employees.reduce((sum, e) => sum + getTenureYears(e.hireDate), 0) /
        employees.length
      : 0;

  return {
    headcount: {
      total: employees.length,
      active: activeEmployees.length,
      probation: probationEmployees.length,
      onLeave: onLeaveEmployees.length,
      byDepartment,
      byGender,
      byAge,
      byTenure,
    },
    movement: {
      newHires,
      terminations,
      promotions: 0, // Would need job history tracking
      transfers: 0, // Would need transfer tracking
      netChange: newHires - terminations,
    },
    turnover: {
      rate: Math.round(turnoverRate * 10) / 10,
      voluntaryRate: Math.round(turnoverRate * 0.7 * 10) / 10, // Estimate
      involuntaryRate: Math.round(turnoverRate * 0.3 * 10) / 10, // Estimate
      byDepartment: turnoverByDepartment
        .filter((d) => d.rate > 0)
        .sort((a, b) => b.rate - a.rate),
      byReason: [], // Would need separation tracking
    },
    retention: {
      rate: 100 - turnoverRate,
      avgTenure: Math.round(avgTenure * 10) / 10,
      newHireRetention90Days: 95, // Placeholder
    },
  };
}

export async function compareWorkforceMetrics(
  tenantId: string,
  currentStartDate: Date,
  currentEndDate: Date,
  previousStartDate: Date,
  previousEndDate: Date,
): Promise<WorkforceComparisonResult> {
  const [current, previous] = await Promise.all([
    getWorkforceMetrics(tenantId, currentStartDate, currentEndDate),
    getWorkforceMetrics(tenantId, previousStartDate, previousEndDate),
  ]);

  return {
    current,
    previous,
    changes: {
      headcountChange: current.headcount.total - previous.headcount.total,
      headcountChangePercent:
        previous.headcount.total > 0
          ? ((current.headcount.total - previous.headcount.total) /
              previous.headcount.total) *
            100
          : 0,
      turnoverChange: current.turnover.rate - previous.turnover.rate,
      retentionChange: current.retention.rate - previous.retention.rate,
    },
  };
}

export async function getDepartmentAnalytics(
  tenantId: string,
  departmentId: string,
  startDate: Date,
  endDate: Date,
) {
  const [department, employees, attendance] = await Promise.all([
    db.department.findUnique({
      where: { id: departmentId },
      include: { manager: true },
    }),
    db.employee.findMany({
      where: { tenantId, departmentId, deletedAt: null },
      include: { position: true },
    }),
    db.attendance.findMany({
      where: {
        employee: { tenantId, departmentId, deletedAt: null },
        date: { gte: startDate, lte: endDate },
      },
    }),
  ]);

  if (!department) {
    throw new Error("Department not found");
  }

  const totalDays = attendance.length;
  const presentDays = attendance.filter(
    (a) => a.status === "PRESENT" || a.status === "LATE",
  ).length;
  const attendanceRate = totalDays > 0 ? (presentDays / totalDays) * 100 : 0;

  return {
    department: {
      id: department.id,
      name: department.name,
      manager: department.manager?.fullName,
    },
    headcount: employees.length,
    avgAttendanceRate: Math.round(attendanceRate * 10) / 10,
    employeesByPosition: Object.entries(
      employees.reduce(
        (acc, emp) => {
          const pos = emp.position?.name || "Chưa xác định";
          acc[pos] = (acc[pos] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    ).map(([position, count]) => ({ position, count })),
  };
}

export async function createSnapshot(
  tenantId: string,
  snapshotType: SnapshotType,
  snapshotDate: Date,
) {
  const endDate = new Date(snapshotDate);
  let startDate: Date;

  switch (snapshotType) {
    case "DAILY":
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 1);
      break;
    case "WEEKLY":
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 7);
      break;
    case "MONTHLY":
      startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case "QUARTERLY":
      startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case "YEARLY":
      startDate = new Date(endDate);
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    default:
      startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - 1);
  }

  const metrics = await getWorkforceMetrics(tenantId, startDate, endDate);

  // Get additional metrics
  const [payrolls, enrollments] = await Promise.all([
    db.payroll.aggregate({
      where: {
        employee: { tenantId, deletedAt: null },
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { netSalary: true },
      _avg: { netSalary: true },
    }),
    db.enrollment.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
      },
    }),
  ]);

  const snapshot = await db.analyticsSnapshot.upsert({
    where: {
      tenantId_snapshotType_snapshotDate: {
        tenantId,
        snapshotType,
        snapshotDate,
      },
    },
    update: {
      totalHeadcount: metrics.headcount.total,
      activeEmployees: metrics.headcount.active,
      probationEmployees: metrics.headcount.probation,
      newHires: metrics.movement.newHires,
      terminations: metrics.movement.terminations,
      voluntaryTerminations: Math.round(metrics.movement.terminations * 0.7),
      turnoverRate: metrics.turnover.rate,
      voluntaryTurnoverRate: metrics.turnover.voluntaryRate,
      retentionRate: metrics.retention.rate,
      totalPayrollCost: payrolls._sum.netSalary || 0,
      avgSalary: payrolls._avg.netSalary || 0,
      departmentBreakdown: metrics.headcount.byDepartment as unknown as object,
      rawData: { metrics } as unknown as object,
    },
    create: {
      tenantId,
      snapshotType,
      snapshotDate,
      totalHeadcount: metrics.headcount.total,
      activeEmployees: metrics.headcount.active,
      probationEmployees: metrics.headcount.probation,
      newHires: metrics.movement.newHires,
      terminations: metrics.movement.terminations,
      voluntaryTerminations: Math.round(metrics.movement.terminations * 0.7),
      turnoverRate: metrics.turnover.rate,
      voluntaryTurnoverRate: metrics.turnover.voluntaryRate,
      retentionRate: metrics.retention.rate,
      totalPayrollCost: payrolls._sum.netSalary || 0,
      avgSalary: payrolls._avg.netSalary || 0,
      departmentBreakdown: metrics.headcount.byDepartment as unknown as object,
      rawData: { metrics } as unknown as object,
    },
  });

  return snapshot;
}

export async function getSnapshots(
  tenantId: string,
  snapshotType: SnapshotType,
  startDate: Date,
  endDate: Date,
) {
  return db.analyticsSnapshot.findMany({
    where: {
      tenantId,
      snapshotType,
      snapshotDate: { gte: startDate, lte: endDate },
    },
    orderBy: { snapshotDate: "asc" },
  });
}

export const workforceAnalyticsService = {
  getWorkforceMetrics,
  compareWorkforceMetrics,
  getDepartmentAnalytics,
  createSnapshot,
  getSnapshots,
};
