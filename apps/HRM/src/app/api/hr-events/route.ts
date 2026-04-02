import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole, HREventType, Prisma } from ".prisma/hrm-client";

const ALLOWED_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId");
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (employeeId) where.employeeId = employeeId;
  if (type) where.type = type;
  if (status) where.status = status;

  const events = await prisma.hREvent.findMany({
    where,
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          departmentId: true,
          positionId: true,
        },
      },
      requester: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: events });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { employeeId, type, effectiveDate, payload, note } = body;

  if (!employeeId || !type || !effectiveDate) {
    return NextResponse.json(
      { error: "employeeId, type, effectiveDate required" },
      { status: 400 },
    );
  }

  if (!Object.values(HREventType).includes(type)) {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
  }

  // Fetch current employee data to populate payload.from* fields
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
      contracts: {
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, baseSalary: true },
      },
    },
  });

  if (!employee)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  // Build payload with from* auto-populated
  const enrichedPayload: Record<string, unknown> = { ...payload };

  if (type === "DEPARTMENT_TRANSFER") {
    enrichedPayload.fromDepartmentId = employee.departmentId;
    enrichedPayload.fromDepartmentName = employee.department?.name || null;
    enrichedPayload.fromPositionId = employee.positionId;
    enrichedPayload.fromPositionName = employee.position?.name || null;
  } else if (type === "PROMOTION") {
    enrichedPayload.fromPositionId = employee.positionId;
    enrichedPayload.fromPositionName = employee.position?.name || null;
  } else if (type === "SALARY_ADJUSTMENT") {
    enrichedPayload.fromSalary =
      employee.contracts[0]?.baseSalary?.toString() || null;
  }

  const event = await prisma.hREvent.create({
    data: {
      employeeId,
      type,
      requestedBy: session.user.id,
      effectiveDate: new Date(effectiveDate),
      payload: enrichedPayload as Prisma.InputJsonObject,
      note: note || null,
    },
    include: {
      employee: { select: { id: true, fullName: true, employeeCode: true } },
      requester: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(event, { status: 201 });
}
