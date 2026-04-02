import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";

const LIST_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!LIST_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const template = await prisma.documentTemplate.findUnique({
    where: { id },
    include: {
      uploader: { select: { name: true, email: true } },
      _count: { select: { generations: true } },
    },
  });

  if (!template)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: template });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const template = await prisma.documentTemplate.findUnique({ where: { id } });
  if (!template)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.documentTemplate.update({
    where: { id },
    data: {
      name: body.name ?? template.name,
      description:
        body.description !== undefined
          ? body.description
          : template.description,
      category: body.category ?? template.category,
      fields: body.fields ?? template.fields,
      isActive: body.isActive !== undefined ? body.isActive : template.isActive,
    },
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await prisma.documentTemplate.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
