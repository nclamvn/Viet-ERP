import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { ContractUpdateSchema } from "@/lib/validations/contract";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; contractId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!HR_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, contractId } = await params;

  const contract = await prisma.contract.findFirst({
    where: { id: contractId, employeeId: id },
    include: {
      generatedDocuments: {
        select: { id: true, type: true, fileName: true, generatedAt: true },
        orderBy: { generatedAt: "desc" },
      },
    },
  });

  if (!contract)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(contract);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; contractId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!HR_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, contractId } = await params;

  const existing = await prisma.contract.findFirst({
    where: { id: contractId, employeeId: id },
  });
  if (!existing)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const parsed = ContractUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {};
  const directFields = [
    "contractNo",
    "probationNo",
    "notes",
    "annexNo1",
    "annexNo2",
    "annexNo3",
  ];
  const decimalFields = [
    "baseSalary",
    "mealAllowance",
    "phoneAllowance",
    "fuelAllowance",
    "perfAllowance",
    "kpiAmount",
  ];
  const dateFields = ["annexDate1", "annexDate2", "annexDate3"];

  for (const field of directFields) {
    if (field in data)
      updateData[field] = data[field as keyof typeof data] || null;
  }
  for (const field of decimalFields) {
    if (field in data)
      updateData[field] = data[field as keyof typeof data] || null;
  }
  for (const field of dateFields) {
    if (field in data) {
      const val = data[field as keyof typeof data] as string | undefined;
      updateData[field] = val ? new Date(val) : null;
    }
  }

  const contract = await prisma.contract.update({
    where: { id: contractId },
    data: updateData,
  });

  return NextResponse.json(contract);
}
