import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    !HR_ROLES.includes(session.user.role) &&
    session.user.role !== "DEPT_MANAGER"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  if (status) {
    where.status = status;
  }

  // DEPT_MANAGER: only see their department employees
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
      where.employee = { departmentId: { in: managedDepts.map((d) => d.id) } };
    }
  }

  const instances = await prisma.offboardingInstance.findMany({
    where,
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeCode: true,
          department: { select: { name: true } },
          position: { select: { name: true } },
        },
      },
      tasks: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: instances });
}
