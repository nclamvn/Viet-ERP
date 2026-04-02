import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { notificationService } from "@/lib/services/notification.service";

const ALLOWED_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, taskId } = await params;

  const body = await request.json();
  if (!body.note) {
    return NextResponse.json(
      { error: "Note is required when skipping" },
      { status: 400 },
    );
  }

  // Verify task belongs to this employee's checklist
  const task = await prisma.onboardingTask.findUnique({
    where: { id: taskId },
    include: { checklist: { select: { id: true, employeeId: true } } },
  });

  if (!task || task.checklist.employeeId !== id) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.status !== "PENDING") {
    return NextResponse.json(
      { error: "Task already processed" },
      { status: 400 },
    );
  }

  // Mark task SKIPPED
  const updated = await prisma.onboardingTask.update({
    where: { id: taskId },
    data: {
      status: "SKIPPED",
      note: body.note,
      doneAt: new Date(),
      doneBy: session.user.id,
    },
  });

  // Check if all tasks are DONE or SKIPPED
  const allTasks = await prisma.onboardingTask.findMany({
    where: { checklistId: task.checklist.id },
  });

  const allCompleted = allTasks.every((t) =>
    t.id === taskId ? true : t.status === "DONE" || t.status === "SKIPPED",
  );

  if (allCompleted) {
    await prisma.onboardingChecklist.update({
      where: { id: task.checklist.id },
      data: { completedAt: new Date() },
    });

    const employee = await prisma.employee.update({
      where: { id },
      data: { status: "ACTIVE" },
      select: { fullName: true, employeeCode: true },
    });

    try {
      await notificationService.notifyHR({
        type: "ONBOARDING_COMPLETE",
        title: "Onboarding hoàn tất",
        message: `${employee.fullName} (${employee.employeeCode}) đã hoàn tất onboarding`,
        link: `/employees/${id}`,
      });
    } catch (e) {
      console.error("Notification error:", e);
    }
  }

  return NextResponse.json(updated);
}
