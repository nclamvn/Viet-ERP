import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET() {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!HR_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const periods = await prisma.reviewPeriod.findMany({
    include: {
      _count: { select: { reviews: true } },
      reviews: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const data = periods.map((p) => ({
    id: p.id,
    name: p.name,
    cycle: p.cycle,
    startDate: p.startDate,
    endDate: p.endDate,
    year: p.year,
    totalReviews: p._count.reviews,
    completedReviews: p.reviews.filter((r) => r.status === "COMPLETED").length,
  }));

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["SUPER_ADMIN", "HR_MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name, cycle, startDate, endDate, year } = body;

  if (!name || !cycle || !startDate || !endDate || !year) {
    return NextResponse.json(
      { error: "name, cycle, startDate, endDate, year required" },
      { status: 400 },
    );
  }

  const period = await prisma.reviewPeriod.create({
    data: {
      name,
      cycle,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      year: Number(year),
      createdBy: session.user.id,
    },
  });

  return NextResponse.json({ data: period }, { status: 201 });
}
