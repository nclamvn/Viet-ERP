import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const ALLOWED_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const events = await prisma.hREvent.findMany({
    where: { employeeId: id },
    include: {
      requester: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const disciplinaryRecords = await prisma.disciplinaryRecord.findMany({
    where: { employeeId: id },
    orderBy: { issuedAt: "desc" },
  });

  return NextResponse.json({ events, disciplinaryRecords });
}
