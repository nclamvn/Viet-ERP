import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { createOnboardingChecklist } from "@/lib/services/onboarding.service";

const ALLOWED_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // EMPLOYEE can view their own onboarding (read-only)
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    const ownEmployee = await prisma.employee.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!ownEmployee || ownEmployee.id !== id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const employee = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, startDate: true },
  });
  if (!employee)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  // Auto-create checklist if not exists
  let checklist = await prisma.onboardingChecklist.findUnique({
    where: { employeeId: id },
    include: { tasks: { orderBy: { createdAt: "asc" } } },
  });

  if (!checklist && employee.startDate) {
    checklist = await createOnboardingChecklist(id, employee.startDate);
  }

  if (!checklist) {
    return NextResponse.json({ checklist: null, message: "No start date set" });
  }

  const totalTasks = checklist.tasks.length;
  const doneTasks = checklist.tasks.filter(
    (t) => t.status === "DONE" || t.status === "SKIPPED",
  ).length;

  return NextResponse.json({
    checklist,
    progress: {
      total: totalTasks,
      done: doneTasks,
      percent: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
    },
  });
}
