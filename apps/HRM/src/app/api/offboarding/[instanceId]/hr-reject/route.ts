import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { notificationService } from "@/lib/services/notification.service";

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
  const { reason } = body;

  if (!reason) {
    return NextResponse.json(
      { error: "Lý do từ chối là bắt buộc" },
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
      { error: `Không thể từ chối — trạng thái hiện tại: ${instance.status}` },
      { status: 400 },
    );
  }

  const updated = await prisma.offboardingInstance.update({
    where: { id: instanceId },
    data: {
      status: "CANCELLED",
      notes: `HR từ chối: ${reason}`,
    },
  });

  // Notify EMPLOYEE + HR_STAFF
  try {
    const notifyUserIds: string[] = [];
    if (instance.employee.userId) notifyUserIds.push(instance.employee.userId);
    const hrStaff = await prisma.user.findMany({
      where: { role: "HR_STAFF", isActive: true },
      select: { id: true },
    });
    notifyUserIds.push(...hrStaff.map((u) => u.id));

    await notificationService.createForMany({
      userIds: notifyUserIds,
      type: "OFFBOARDING",
      title: "Đơn nghỉ việc bị HR từ chối",
      message: `Đơn nghỉ của ${instance.employee.fullName} bị HR từ chối: ${reason}`,
      link: `/offboarding`,
    });
  } catch {
    // Non-blocking
  }

  return NextResponse.json({ data: updated });
}
