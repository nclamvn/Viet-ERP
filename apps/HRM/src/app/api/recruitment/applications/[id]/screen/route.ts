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

  const app = await prisma.application.findUnique({ where: { id } });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (app.status !== "NEW")
    return NextResponse.json(
      { error: "Only NEW applications can be screened" },
      { status: 400 },
    );

  const updated = await prisma.application.update({
    where: { id },
    data: {
      status: "SCREENING",
      screeningNote: body.screeningNote || null,
      screenedBy: session.user.id,
      screenedAt: new Date(),
    },
  });

  return NextResponse.json(updated);
}
