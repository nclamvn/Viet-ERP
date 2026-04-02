import { prisma } from "@/lib/prisma";
import { addDays, differenceInDays, format } from "date-fns";
import { getDashboardMetrics } from "@/lib/analytics/dashboard";
import type { ReportStatus } from ".prisma/hrm-client";
import {
  detectAnomalies,
  getSmartSyncSuggestions,
  forecastAttendance,
} from "@/lib/ai/attendance-ai";

export async function executeHRTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  userRole: string,
): Promise<string> {
  try {
    switch (toolName) {
      case "search_employees": {
        const query = (toolInput.query as string) || "";
        const statusFilter = toolInput.status as string;
        const limit = (toolInput.limit as number) || 5;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: Record<string, any> = {
          OR: [
            { fullName: { contains: query, mode: "insensitive" } },
            { employeeCode: { contains: query, mode: "insensitive" } },
          ],
        };
        if (statusFilter && statusFilter !== "ALL") {
          where.status = statusFilter;
        }

        const employees = await prisma.employee.findMany({
          where,
          include: {
            department: { select: { name: true } },
            position: { select: { name: true } },
          },
          take: limit,
        });

        return JSON.stringify(
          employees.map((e) => ({
            code: e.employeeCode,
            name: e.fullName,
            department: e.department?.name,
            position: e.position?.name,
            status: e.status,
            startDate: e.startDate ? format(e.startDate, "dd/MM/yyyy") : null,
          })),
        );
      }

      case "get_dashboard_stats": {
        const stats = await getDashboardMetrics();
        return JSON.stringify({
          totalActive: stats.totalActive,
          totalProbation: stats.totalProbation,
          newThisMonth: stats.newThisMonth,
          expiring30: stats.expiring30,
          expiring7: stats.expiring7,
          pendingL1: stats.pendingL1,
          pendingL2: stats.pendingL2,
          activeOnboarding: stats.activeOnboarding,
          byDepartment: stats.byDepartment,
        });
      }

      case "get_expiring_contracts": {
        const days = (toolInput.days as number) || 30;
        const now = new Date();
        const contracts = await prisma.contract.findMany({
          where: {
            status: "ACTIVE",
            officialTo: { gte: now, lte: addDays(now, days) },
          },
          include: {
            employee: { select: { fullName: true, employeeCode: true } },
          },
          orderBy: { officialTo: "asc" },
        });

        return JSON.stringify(
          contracts.map((c) => ({
            employee: c.employee.fullName,
            code: c.employee.employeeCode,
            expiryDate: c.officialTo
              ? format(c.officialTo, "dd/MM/yyyy")
              : null,
            daysLeft: c.officialTo ? differenceInDays(c.officialTo, now) : null,
          })),
        );
      }

      case "get_pending_reports": {
        const levelMap: Record<string, string[]> = {
          L1: ["SUBMITTED"],
          L2: ["APPROVED_L1"],
          ALL: ["SUBMITTED", "APPROVED_L1"],
        };
        const level = (toolInput.level as string) || "ALL";
        const statuses = levelMap[level] || levelMap.ALL;

        const reports = await prisma.report.findMany({
          where: { status: { in: statuses as ReportStatus[] } },
          include: {
            employee: { select: { fullName: true, employeeCode: true } },
          },
          orderBy: { submittedAt: "asc" },
          take: 10,
        });

        return JSON.stringify(
          reports.map(
            (r: {
              employee: { fullName: string; employeeCode: string };
              type: string;
              status: string;
              startDate: Date | null;
            }) => ({
              employee: r.employee.fullName,
              code: r.employee.employeeCode,
              type: r.type,
              status: r.status,
              date: r.startDate ? format(r.startDate, "dd/MM/yyyy") : null,
            }),
          ),
        );
      }

      case "get_payroll_summary": {
        if (!["HR_MANAGER", "SUPER_ADMIN", "ACCOUNTANT"].includes(userRole)) {
          return JSON.stringify({
            error: "Không có quyền xem thông tin lương",
          });
        }

        const now = new Date();
        const month = (toolInput.month as number) || now.getMonth() + 1;
        const year = (toolInput.year as number) || now.getFullYear();

        const period = await prisma.payrollPeriod.findUnique({
          where: { month_year: { month, year } },
        });
        if (!period) {
          return JSON.stringify({ message: "Chưa có bảng lương kỳ này" });
        }

        const agg = await prisma.employeePayroll.aggregate({
          where: { periodId: period.id },
          _sum: { netSalary: true, totalEmployerIns: true },
          _count: { id: true },
        });

        return JSON.stringify({
          period: `${month}/${year}`,
          status: period.status,
          employeeCount: agg._count.id,
          totalNetSalary: Number(agg._sum.netSalary ?? 0),
          totalEmployerIns: Number(agg._sum.totalEmployerIns ?? 0),
        });
      }

      case "get_leave_balance": {
        const year = new Date().getFullYear();
        let employee;

        if (toolInput.employeeId) {
          employee = await prisma.employee.findUnique({
            where: { id: toolInput.employeeId as string },
            include: { leaveBalances: { where: { year } } },
          });
        } else if (toolInput.employeeName) {
          employee = await prisma.employee.findFirst({
            where: {
              fullName: {
                contains: toolInput.employeeName as string,
                mode: "insensitive",
              },
            },
            include: { leaveBalances: { where: { year } } },
          });
        } else {
          return JSON.stringify({
            error: "Cần cung cấp employeeId hoặc employeeName",
          });
        }

        if (!employee) {
          return JSON.stringify({ message: "Không tìm thấy nhân viên" });
        }

        const balance = employee.leaveBalances[0];
        return JSON.stringify({
          employee: employee.fullName,
          code: employee.employeeCode,
          year,
          totalDays: balance ? Number(balance.totalDays) : 12,
          usedDays: balance ? Number(balance.usedDays) : 0,
          remainingDays: balance ? Number(balance.remainingDays) : 12,
        });
      }

      case "get_department_breakdown": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const deptWhere: Record<string, any> = {};
        if (toolInput.departmentId)
          deptWhere.id = toolInput.departmentId as string;

        const departments = await prisma.department.findMany({
          where: deptWhere,
          include: {
            manager: { select: { fullName: true, employeeCode: true } },
            positions: { select: { name: true, code: true } },
            employees: {
              select: { status: true },
            },
          },
          orderBy: { name: "asc" },
        });

        return JSON.stringify(
          departments.map((d) => {
            const statusCount: Record<string, number> = {};
            d.employees.forEach((e) => {
              statusCount[e.status] = (statusCount[e.status] || 0) + 1;
            });
            return {
              name: d.name,
              code: d.code,
              manager: d.manager
                ? `${d.manager.fullName} (${d.manager.employeeCode})`
                : null,
              totalEmployees: d.employees.length,
              byStatus: statusCount,
              positions: d.positions.map((p) => p.name),
            };
          }),
        );
      }

      case "get_attendance_anomalies": {
        const now = new Date();
        const month = (toolInput.month as number) || now.getMonth() + 1;
        const year = (toolInput.year as number) || now.getFullYear();
        const anomalies = await detectAnomalies(month, year);
        return JSON.stringify({
          month,
          year,
          totalAnomalies: anomalies.length,
          high: anomalies.filter((a) => a.severity === "high").length,
          medium: anomalies.filter((a) => a.severity === "medium").length,
          low: anomalies.filter((a) => a.severity === "low").length,
          details: anomalies.slice(0, 10).map((a) => ({
            employee: `${a.employeeName} (${a.employeeCode})`,
            department: a.department,
            type: a.type,
            severity: a.severity,
            description: a.description,
            suggestion: a.suggestion,
          })),
        });
      }

      case "get_attendance_suggestions": {
        const now = new Date();
        const month = (toolInput.month as number) || now.getMonth() + 1;
        const year = (toolInput.year as number) || now.getFullYear();
        const suggestions = await getSmartSyncSuggestions(month, year);
        return JSON.stringify({
          month,
          year,
          total: suggestions.length,
          byType: {
            autoOT: suggestions.filter((s) => s.type === "auto_ot").length,
            autoLeave: suggestions.filter((s) => s.type === "auto_leave")
              .length,
            lowAttendance: suggestions.filter(
              (s) => s.type === "low_attendance",
            ).length,
            missingRecords: suggestions.filter(
              (s) => s.type === "missing_records",
            ).length,
          },
          details: suggestions.slice(0, 15).map((s) => ({
            employee: `${s.employeeName} (${s.employeeCode})`,
            type: s.type,
            description: s.description,
            action: s.actionLabel,
          })),
        });
      }

      case "get_attendance_forecast": {
        const today = new Date();
        const nextMonday = new Date(today);
        nextMonday.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7));
        nextMonday.setUTCHours(0, 0, 0, 0);

        const forecast = await forecastAttendance(nextMonday);
        return JSON.stringify({
          weekStart: nextMonday.toISOString().split("T")[0],
          forecast: forecast.map((f) => ({
            department: f.department,
            date: f.date,
            day: f.dayOfWeek,
            present: `${f.predictedPresent}/${f.totalEmployees}`,
            risk: f.riskLevel,
            factors: f.riskFactors,
          })),
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (error) {
    console.error(`[Copilot] Tool error (${toolName}):`, error);
    return JSON.stringify({ error: "Lỗi khi xử lý yêu cầu" });
  }
}
