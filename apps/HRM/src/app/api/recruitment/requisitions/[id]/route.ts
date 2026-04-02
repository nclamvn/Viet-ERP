import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const VIEW_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "HR_MANAGER",
  "HR_STAFF",
  "DEPT_MANAGER",
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!VIEW_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const jr = await prisma.jobRequisition.findUnique({
    where: { id },
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
      requester: { select: { id: true, name: true } },
      applications: {
        include: {
          candidate: true,
          interviews: { orderBy: { round: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!jr) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(jr);
}
