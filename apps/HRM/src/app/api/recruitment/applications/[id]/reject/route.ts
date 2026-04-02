import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const ALLOWED: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();

  if (!body.rejectionReason) {
    return NextResponse.json(
      { error: "rejectionReason is required" },
      { status: 400 },
    );
  }

  const app = await prisma.application.findUnique({ where: { id } });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (app.status === "ACCEPTED" || app.status === "REJECTED") {
    return NextResponse.json(
      { error: "Cannot reject application in current status" },
      { status: 400 },
    );
  }

  const updated = await prisma.application.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectionReason: body.rejectionReason,
    },
  });

  return NextResponse.json(updated);
}
