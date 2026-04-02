import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { addDays, startOfDay } from "date-fns";
import { notificationService } from "@/lib/services/notification.service";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];
const ACTIVE_STATUSES = [
  "INITIATED",
  "MANAGER_APPROVED",
  "HR_APPROVED",
  "IN_PROGRESS",
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const instance = await prisma.offboardingInstance.findUnique({
    where: { employeeId: id },
    include: {
      tasks: { orderBy: { createdAt: "asc" } },
      employee: {
        select: { fullName: true, employeeCode: true, departmentId: true },
      },
    },
  });

  if (!instance) {
    return NextResponse.json({ data: null });
  }

  // RBAC: EMPLOYEE can only view their own
  if (session.user.role === "EMPLOYEE") {
    const ownEmployee = await prisma.employee.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!ownEmployee || ownEmployee.id !== id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json({ data: instance });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // RBAC: EMPLOYEE (own only) or HR_STAFF+
  const isHR = HR_ROLES.includes(session.user.role);
  if (!isHR) {
    if (session.user.role === "EMPLOYEE") {
      const ownEmployee = await prisma.employee.findFirst({
        where: { userId: session.user.id },
        select: { id: true },
      });
      if (!ownEmployee || ownEmployee.id !== id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = await request.json();
  const { resignationDate, resignReason, isHROverride } = body;

  if (!resignationDate) {
    return NextResponse.json(
      { error: "resignationDate là bắt buộc" },
      { status: 400 },
    );
  }

  // Check employee status
  const employee = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, status: true, fullName: true, departmentId: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }
  if (!["ACTIVE", "PROBATION"].includes(employee.status)) {
    return NextResponse.json(
      { error: "Chỉ nhân viên ACTIVE hoặc PROBATION mới có thể nộp đơn nghỉ" },
      { status: 400 },
    );
  }

  // Check no existing active offboarding
  const existing = await prisma.offboardingInstance.findFirst({
    where: {
      employeeId: id,
      status: { in: [...ACTIVE_STATUSES] },
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Nhân viên đã có đơn nghỉ việc đang xử lý" },
      { status: 400 },
    );
  }

  // Notice period: 30 days minimum
  const resignDate = startOfDay(new Date(resignationDate));
  const minDate = startOfDay(addDays(new Date(), 30));
  if (!isHROverride && resignDate < minDate) {
    return NextResponse.json(
      { error: "Cần báo trước tối thiểu 30 ngày theo quy định" },
      { status: 400 },
    );
  }

  const instance = await prisma.offboardingInstance.create({
    data: {
      employeeId: id,
      resignationDate: resignDate,
      resignReason: resignReason || null,
      initiatedBy: session.user.id,
      status: "INITIATED",
    },
    include: {
      tasks: true,
      employee: {
        select: { fullName: true, employeeCode: true },
      },
    },
  });

  // Notify DEPT_MANAGER + HR_STAFF
  try {
    if (employee.departmentId) {
      await notificationService.notifyDeptManagers(employee.departmentId, {
        type: "OFFBOARDING",
        title: "Đơn xin nghỉ việc mới",
        message: `${employee.fullName} xin nghỉ việc từ ngày ${resignationDate}`,
        link: `/offboarding`,
      });
    }
    await notificationService.notifyHR({
      type: "OFFBOARDING",
      title: "Đơn xin nghỉ việc mới",
      message: `${employee.fullName} xin nghỉ việc từ ngày ${resignationDate}`,
      link: `/offboarding`,
    });
  } catch {
    // Non-blocking
  }

  return NextResponse.json({ data: instance }, { status: 201 });
}
