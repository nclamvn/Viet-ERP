import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole, ApplicationStatus } from ".prisma/hrm-client";
import { validateStatusTransition } from "@/lib/config/recruitment";
import { convertToNoAccent } from "@/lib/utils/employee";
import { generateEmployeeCode } from "@/lib/utils/employee-server";
import { notificationService } from "@/lib/services/notification.service";
import { createOnboardingChecklist } from "@/lib/services/onboarding.service";

const ALLOWED_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];
const VALID_STATUSES: ApplicationStatus[] = [
  "NEW",
  "SCREENING",
  "INTERVIEW",
  "OFFERED",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const newStatus = body.status as ApplicationStatus;

  if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const app = await prisma.application.findUnique({
    where: { id },
    include: {
      candidate: true,
      requisition: {
        select: { departmentId: true, positionId: true, title: true },
      },
    },
  });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Server-side transition validation
  const error = validateStatusTransition(app.status, newStatus);
  if (error) return NextResponse.json({ error }, { status: 400 });

  // Build update data with timestamps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = { status: newStatus };
  const now = new Date();

  if (newStatus === "SCREENING") updateData.screenedAt = now;
  if (newStatus === "INTERVIEW") updateData.interviewScheduledAt = now;
  if (newStatus === "OFFERED") updateData.offeredAt = now;

  // ACCEPTED → auto-create Employee (reuse TIP-004 logic)
  if (newStatus === "ACCEPTED") {
    // Only HR_MANAGER+ can accept
    if (
      session.user.role !== "HR_MANAGER" &&
      session.user.role !== "SUPER_ADMIN"
    ) {
      return NextResponse.json(
        { error: "Chỉ HR Manager mới có thể chấp nhận ứng viên" },
        { status: 403 },
      );
    }

    const candidate = app.candidate;
    const employeeCode = await generateEmployeeCode();

    const employee = await prisma.employee.create({
      data: {
        employeeCode,
        fullName: candidate.fullName,
        nameNoAccent: convertToNoAccent(candidate.fullName),
        gender: "OTHER",
        dateOfBirth: candidate.dateOfBirth,
        phone: candidate.phone,
        personalEmail: candidate.email,
        nationalId: candidate.nationalId,
        currentAddress: candidate.currentAddress,
        school: candidate.school,
        major: candidate.major,
        departmentId: app.requisition.departmentId,
        positionId: app.requisition.positionId,
        status: "PROBATION",
      },
    });

    await prisma.contract.create({
      data: {
        employeeId: employee.id,
        type: "PROBATION",
        status: "DRAFT",
        probationFrom: now,
        baseSalary: app.offeredSalary,
      },
    });

    updateData.employeeId = employee.id;

    try {
      await createOnboardingChecklist(employee.id, now);
    } catch (e) {
      console.error("Onboarding checklist error:", e);
    }

    try {
      await notificationService.notifyHR({
        type: "EMPLOYEE_CREATED",
        title: "Nhân viên mới từ tuyển dụng",
        message: `${employee.fullName} (${employeeCode}) đã được tạo từ pipeline tuyển dụng`,
        link: `/employees/${employee.id}`,
      });
    } catch (e) {
      console.error("Notification error:", e);
    }
  }

  const updated = await prisma.application.update({
    where: { id },
    data: updateData,
    include: {
      candidate: true,
      requisition: {
        select: {
          id: true,
          title: true,
          department: { select: { name: true } },
        },
      },
      interviews: { orderBy: { round: "asc" } },
    },
  });

  return NextResponse.json({ data: updated });
}
