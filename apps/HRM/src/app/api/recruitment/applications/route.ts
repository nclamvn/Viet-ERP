import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

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
  const requisitionId = searchParams.get("requisitionId") || "";
  const status = searchParams.get("status") || "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (requisitionId) where.requisitionId = requisitionId;
  if (status) where.status = status;

  const data = await prisma.application.findMany({
    where,
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
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data });
}
