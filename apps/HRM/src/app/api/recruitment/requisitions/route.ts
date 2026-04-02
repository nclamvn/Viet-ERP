import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const CREATE_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "HR_MANAGER",
  "HR_STAFF",
  "DEPT_MANAGER",
];
const LIST_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "HR_MANAGER",
  "HR_STAFF",
  "DEPT_MANAGER",
];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!LIST_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";
  const departmentId = searchParams.get("departmentId") || "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (status) where.status = status;
  if (departmentId) where.departmentId = departmentId;

  // DEPT_MANAGER: only see own department's JRs
  if (session.user.role === "DEPT_MANAGER") {
    const userEmployee = await prisma.employee.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (userEmployee) {
      const managedDepts = await prisma.department.findMany({
        where: { managerId: userEmployee.id },
        select: { id: true },
      });
      where.departmentId = { in: managedDepts.map((d) => d.id) };
    }
  }

  const data = await prisma.jobRequisition.findMany({
    where,
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
      requester: { select: { id: true, name: true } },
      _count: { select: { applications: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!CREATE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      title,
      departmentId,
      positionId,
      headcount,
      contractType,
      salaryFrom,
      salaryTo,
      description,
      requirements,
    } = body;

    if (!title || !departmentId || !positionId || !contractType) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const jr = await prisma.jobRequisition.create({
      data: {
        title,
        departmentId,
        positionId,
        requestedBy: session.user.id,
        headcount: headcount || 1,
        contractType,
        salaryFrom: salaryFrom || null,
        salaryTo: salaryTo || null,
        description: description || null,
        requirements: requirements || null,
      },
      include: {
        department: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(jr, { status: 201 });
  } catch (error) {
    console.error("Create requisition error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
