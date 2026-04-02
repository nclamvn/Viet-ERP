import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { notificationService } from "@/lib/services/notification.service";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ instanceId: string; taskId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!HR_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { instanceId, taskId } = await params;
  const body = await request.json();
  const { note } = body;

  if (!note) {
    return NextResponse.json(
      { error: "Ghi chú bắt buộc khi bỏ qua task" },
      { status: 400 },
    );
  }

  const task = await prisma.offboardingTask.findFirst({
    where: { id: taskId, instanceId },
    include: {
      instance: {
        include: {
          employee: { select: { id: true, fullName: true, userId: true } },
        },
      },
    },
  });

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.instance.status !== "IN_PROGRESS") {
    return NextResponse.json(
      { error: "Offboarding chưa ở trạng thái IN_PROGRESS" },
      { status: 400 },
    );
  }

  if (task.status !== "PENDING") {
    return NextResponse.json({ error: "Task đã được xử lý" }, { status: 400 });
  }

  await prisma.offboardingTask.update({
    where: { id: taskId },
    data: {
      status: "SKIPPED",
      doneAt: new Date(),
      doneBy: session.user.id,
      note,
    },
  });

  // Check if all tasks DONE or SKIPPED → complete offboarding
  const allTasks = await prisma.offboardingTask.findMany({
    where: { instanceId },
  });
  const allCompleted = allTasks.every(
    (t) => t.id === taskId || t.status === "DONE" || t.status === "SKIPPED",
  );

  if (allCompleted) {
    const instance = task.instance;

    await prisma.offboardingInstance.update({
      where: { id: instanceId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    await prisma.employee.update({
      where: { id: instance.employeeId },
      data: {
        status: "RESIGNED",
        resignDate: instance.lastWorkingDate,
        resignDecisionNo: instance.resignDecisionNo,
      },
    });

    await prisma.contract.updateMany({
      where: { employeeId: instance.employeeId, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });

    try {
      const hrManagers = await prisma.user.findMany({
        where: { role: "HR_MANAGER", isActive: true },
        select: { id: true },
      });
      await notificationService.createForMany({
        userIds: hrManagers.map((u) => u.id),
        type: "OFFBOARDING",
        title: "Offboarding hoàn tất",
        message: `Offboarding hoàn tất — ${instance.employee.fullName} đã chính thức nghỉ việc`,
        link: `/offboarding/${instanceId}`,
      });
    } catch {
      // Non-blocking
    }
  }

  const result = await prisma.offboardingInstance.findUnique({
    where: { id: instanceId },
    include: {
      tasks: { orderBy: { createdAt: "asc" } },
      employee: {
        select: { fullName: true, employeeCode: true, status: true },
      },
    },
  });

  return NextResponse.json({ data: result });
}
