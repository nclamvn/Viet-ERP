import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole, DocumentType } from ".prisma/hrm-client";
import { generateDocument } from "@/lib/services/document.service";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

const DOC_TYPE_LABELS: Record<string, string> = {
  CONTRACT_PROBATION: "HĐ-Thu-Viec",
  CONTRACT_OFFICIAL: "HĐ-Chinh-Thuc",
  CONTRACT_INTERN: "TT-Thuc-Tap",
  NDA: "NDA",
  RESIGNATION_LETTER: "Don-Xin-Nghi",
  HANDOVER_MINUTES: "Bien-Ban-Ban-Giao",
};

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
  const body = await request.json();
  const { documentType, contractId } = body;

  if (!documentType || !Object.values(DocumentType).includes(documentType)) {
    return NextResponse.json(
      { error: "Invalid documentType" },
      { status: 400 },
    );
  }

  // Fetch employee with relations
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      department: { select: { id: true, name: true } },
      position: { select: { id: true, name: true } },
    },
  });
  if (!employee)
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  // Fetch contract if needed
  let contract = null;
  if (contractId) {
    contract = await prisma.contract.findFirst({
      where: { id: contractId, employeeId: id },
    });
    if (!contract)
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 },
      );
  }

  try {
    const buffer = await generateDocument({
      documentType,
      employee,
      contract,
    });

    const label = DOC_TYPE_LABELS[documentType] || documentType;
    const fileName = `${label}-RTR-${employee.employeeCode}.docx`;

    // Save GeneratedDocument record
    await prisma.generatedDocument.create({
      data: {
        employeeId: id,
        contractId: contractId || null,
        type: documentType,
        fileName,
        generatedBy: session.user.id,
      },
    });

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error("Document generation error:", error);
    return NextResponse.json(
      { error: `Document generation failed: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
