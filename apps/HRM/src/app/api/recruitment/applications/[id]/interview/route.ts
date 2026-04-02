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

  const app = await prisma.application.findUnique({
    where: { id },
    include: { interviews: { orderBy: { round: "desc" }, take: 1 } },
  });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (app.status !== "SCREENING" && app.status !== "INTERVIEW") {
    return NextResponse.json(
      { error: "Application must be in SCREENING or INTERVIEW status" },
      { status: 400 },
    );
  }

  if (!body.scheduledAt) {
    return NextResponse.json(
      { error: "scheduledAt is required" },
      { status: 400 },
    );
  }

  const nextRound = app.interviews.length > 0 ? app.interviews[0].round + 1 : 1;

  const interview = await prisma.interview.create({
    data: {
      applicationId: id,
      round: nextRound,
      scheduledAt: new Date(body.scheduledAt),
      location: body.location || null,
      interviewerIds: body.interviewerIds || [],
    },
  });

  // Update application status to INTERVIEW
  if (app.status === "SCREENING") {
    await prisma.application.update({
      where: { id },
      data: { status: "INTERVIEW" },
    });
  }

  return NextResponse.json(interview, { status: 201 });
}
