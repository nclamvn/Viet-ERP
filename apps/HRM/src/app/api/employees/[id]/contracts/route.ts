import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { ContractCreateSchema } from "@/lib/validations/contract";
import { format } from "date-fns";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // EMPLOYEE can view own contracts (without baseSalary)
  const isHR = HR_ROLES.includes(session.user.role);
  if (!isHR) {
    const ownEmployee = await prisma.employee.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!ownEmployee || ownEmployee.id !== id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const contracts = await prisma.contract.findMany({
    where: { employeeId: id },
    include: {
      generatedDocuments: {
        select: { id: true, type: true, fileName: true, generatedAt: true },
        orderBy: { generatedAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Hide salary for EMPLOYEE role
  if (!isHR) {
    return NextResponse.json({
      data: contracts.map((c) => ({
        ...c,
        baseSalary: undefined,
        mealAllowance: undefined,
        phoneAllowance: undefined,
        fuelAllowance: undefined,
        perfAllowance: undefined,
        kpiAmount: undefined,
      })),
    });
  }

  return NextResponse.json({ data: contracts });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!HR_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const employee = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, employeeCode: true },
  });
  if (!employee)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const body = await request.json();
  const parsed = ContractCreateSchema.safeParse(body);

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
  const year = format(new Date(), "yyyy");

  // Count existing contracts for numbering
  const contractCount = await prisma.contract.count({
    where: { employeeId: id },
  });
  const seq = String(contractCount + 1).padStart(2, "0");

  // Auto-generate contract number based on type
  let contractNo = data.contractNo;
  let probationNo = data.probationNo;
  if (!contractNo && !probationNo) {
    switch (data.type) {
      case "PROBATION":
        probationNo = `${seq}/${year}-HĐTV-RTR`;
        break;
      case "INTERN":
        contractNo = `${seq}/${year}-TTTT-RTR`;
        break;
      default:
        contractNo = `${seq}/${year}-HĐLĐ-RTR`;
        break;
    }
  }

  const contract = await prisma.contract.create({
    data: {
      employeeId: id,
      type: data.type,
      status: "DRAFT",
      contractNo: contractNo || null,
      probationNo: probationNo || null,
      probationFrom: data.probationFrom ? new Date(data.probationFrom) : null,
      probationTo: data.probationTo ? new Date(data.probationTo) : null,
      officialFrom: data.officialFrom ? new Date(data.officialFrom) : null,
      officialTo: data.officialTo ? new Date(data.officialTo) : null,
      baseSalary: data.baseSalary || null,
      mealAllowance: data.mealAllowance || null,
      phoneAllowance: data.phoneAllowance || null,
      fuelAllowance: data.fuelAllowance || null,
      perfAllowance: data.perfAllowance || null,
      kpiAmount: data.kpiAmount || null,
      notes: data.notes || null,
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      employeeId: id,
      action: "CREATE",
      entity: "Contract",
      entityId: contract.id,
      newData: JSON.parse(JSON.stringify(contract)),
    },
  });

  return NextResponse.json(contract, { status: 201 });
}
