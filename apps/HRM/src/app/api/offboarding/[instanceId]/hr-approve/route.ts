import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { createOffboardingTasks } from "@/lib/services/offboarding.service";
import { notificationService } from "@/lib/services/notification.service";
import { format } from "date-fns";

const ALLOWED_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { instanceId } = await params;
  const body = await request.json();
  const { lastWorkingDate, resignDecisionNo, notes } = body;

  if (!lastWorkingDate) {
    return NextResponse.json(
      { error: "lastWorkingDate là bắt buộc" },
      { status: 400 },
    );
  }

  const instance = await prisma.offboardingInstance.findUnique({
    where: { id: instanceId },
    include: {
      employee: { select: { fullName: true, userId: true } },
    },
  });

  if (!instance) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (instance.status !== "MANAGER_APPROVED") {
    return NextResponse.json(
      { error: `Không thể duyệt HR — trạng thái hiện tại: ${instance.status}` },
      { status: 400 },
    );
  }

  const now = new Date();
  const lwDate = new Date(lastWorkingDate);

  // Update instance to IN_PROGRESS
  const updated = await prisma.offboardingInstance.update({
    where: { id: instanceId },
    data: {
      status: "IN_PROGRESS",
      hrApprovedBy: session.user.id,
      hrApprovedAt: now,
      lastWorkingDate: lwDate,
      resignDecisionNo: resignDecisionNo || null,
      notes: notes || null,
    },
    include: {
      tasks: { orderBy: { createdAt: "asc" } },
      employee: { select: { fullName: true, employeeCode: true } },
    },
  });

  // Create 9 offboarding tasks
  await createOffboardingTasks(instanceId, now, lwDate);

  // Fetch with tasks
  const final = await prisma.offboardingInstance.findUnique({
    where: { id: instanceId },
    include: {
      tasks: { orderBy: { createdAt: "asc" } },
      employee: { select: { fullName: true, employeeCode: true } },
    },
  });

  // Notify employee
  try {
    if (instance.employee.userId) {
      const dateStr = format(lwDate, "dd/MM/yyyy");
      await notificationService.create({
        userId: instance.employee.userId,
        type: "OFFBOARDING",
        title: "Đơn nghỉ việc được chấp thuận",
        message: `Đơn nghỉ của bạn được chấp thuận. Ngày làm việc cuối: ${dateStr}`,
        link: `/employees/${updated.employeeId}/offboarding`,
      });
    }
  } catch {
    // Non-blocking
  }

  return NextResponse.json({ data: final });
}
