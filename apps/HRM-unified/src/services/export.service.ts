import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-unified-client";
import { createExcelBuffer } from "@/lib/export/excel";
import { audit } from "@/lib/audit/logger";
import type { AuditContext } from "@/types/audit";

export const exportService = {
  async exportEmployees(
    tenantId: string,
    ctx: AuditContext,
    filters?: { departmentId?: string; status?: string },
  ) {
    const where: Prisma.EmployeeWhereInput = { tenantId };
    if (filters?.departmentId) where.departmentId = filters.departmentId;
    if (filters?.status)
      where.status = filters.status as Prisma.EnumEmployeeStatusFilter;

    const employees = await db.employee.findMany({
      where,
      include: { department: true, position: true },
      orderBy: { employeeCode: "asc" },
    });

    const data = employees.map((e) => ({
      "Mã NV": e.employeeCode,
      "Họ và tên": e.fullName,
      Email: e.workEmail || e.personalEmail || "",
      "Số điện thoại": e.phone || "",
      "Ngày sinh": e.dateOfBirth
        ? e.dateOfBirth.toISOString().split("T")[0]
        : "",
      "Giới tính":
        e.gender === "MALE"
          ? "Nam"
          : e.gender === "FEMALE"
            ? "Nữ"
            : e.gender || "",
      "Phòng ban": e.department?.name || "",
      "Chức vụ": e.position?.name || "",
      "Ngày vào làm": e.hireDate.toISOString().split("T")[0],
      "Trạng thái": e.status === "ACTIVE" ? "Đang làm việc" : "Nghỉ việc",
    }));

    await audit.export(ctx, "employees", { count: employees.length });
    return createExcelBuffer(data, "Nhân viên");
  },

  async exportAttendance(
    tenantId: string,
    ctx: AuditContext,
    year: number,
    month: number,
  ) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const records = await db.attendance.findMany({
      where: {
        employee: { tenantId },
        date: { gte: startDate, lte: endDate },
      },
      include: { employee: { include: { department: true } } },
      orderBy: [{ employee: { employeeCode: "asc" } }, { date: "asc" }],
    });

    const data = records.map((r) => ({
      "Mã NV": r.employee.employeeCode,
      "Họ và tên": r.employee.fullName,
      "Phòng ban": r.employee.department?.name || "",
      Ngày: r.date.toISOString().split("T")[0],
      "Giờ vào": r.checkIn ? r.checkIn.toTimeString().slice(0, 5) : "",
      "Giờ ra": r.checkOut ? r.checkOut.toTimeString().slice(0, 5) : "",
      "Trạng thái": r.status,
    }));

    await audit.export(ctx, "attendance", {
      year,
      month,
      count: records.length,
    });
    return createExcelBuffer(data, `Chấm công ${month}-${year}`);
  },

  async exportAuditLogs(
    tenantId: string,
    ctx: AuditContext,
    startDate: Date,
    endDate: Date,
  ) {
    const logs = await db.auditLog.findMany({
      where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      orderBy: { createdAt: "desc" },
    });

    const data = logs.map((l) => ({
      "Thời gian": l.createdAt.toISOString(),
      "Người dùng": l.userEmail || l.userId || "System",
      "Hành động": l.action,
      "Đối tượng": l.entityType,
      ID: l.entityId || "",
      Tên: l.entityName || "",
      IP: l.ipAddress || "",
    }));

    await audit.export(ctx, "audit_logs", {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      count: logs.length,
    });
    return createExcelBuffer(data, "Audit Logs");
  },
};
