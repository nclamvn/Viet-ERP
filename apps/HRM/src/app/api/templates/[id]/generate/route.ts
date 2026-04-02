import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UserRole } from ".prisma/hrm-client";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { STORAGE_BASE } from "@/lib/config/storage";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { AUTO_FILL_MAP, META_FILL_MAP } from "@/lib/config/template-autofill";
import { writeAudit } from "@/lib/services/audit.service";

const ALLOWED_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

interface TemplateField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  autoFill?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { employeeId, fieldValues = {} } = body as {
    employeeId?: string;
    fieldValues: Record<string, string>;
  };

  const template = await prisma.documentTemplate.findUnique({ where: { id } });
  if (!template || !template.isActive) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const fields = (template.fields as unknown as TemplateField[]) || [];

  // Validate required fields
  const missing = fields
    .filter((f) => f.required && !fieldValues[f.key] && !f.autoFill)
    .map((f) => f.label);

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Vui lòng điền: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  // Auto-fill from employee if provided
  let employee = null;
  if (employeeId) {
    employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        department: { select: { name: true } },
        position: { select: { name: true } },
        contracts: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { baseSalary: true },
        },
      },
    });
  }

  // Build final values: merge auto-fill + user input
  const mergedValues: Record<string, string> = {};
  for (const field of fields) {
    // Priority: user-provided > auto-fill
    if (fieldValues[field.key]) {
      mergedValues[field.key] = fieldValues[field.key];
    } else if (field.autoFill) {
      if (employee && AUTO_FILL_MAP[field.autoFill]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mergedValues[field.key] = AUTO_FILL_MAP[field.autoFill](
          employee as any,
        );
      } else if (META_FILL_MAP[field.autoFill]) {
        mergedValues[field.key] = META_FILL_MAP[field.autoFill]();
      }
    }
    // Ensure all keys have at least empty string
    if (!mergedValues[field.key]) mergedValues[field.key] = "";
  }

  // Generate document
  try {
    const filePath = join(STORAGE_BASE, template.filePath);
    const content = await readFile(filePath);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{", end: "}" },
      paragraphLoop: true,
      linebreaks: true,
    });

    doc.render(mergedValues);
    const buf = doc.getZip().generate({ type: "nodebuffer" });

    // Increment usage count
    await prisma.documentTemplate.update({
      where: { id },
      data: { usageCount: { increment: 1 } },
    });

    // Save generation record
    const today = new Date().toLocaleDateString("vi-VN").replace(/\//g, "-");
    const downloadName = `${template.name}-${today}.docx`;

    await prisma.documentGeneration.create({
      data: {
        templateId: id,
        employeeId: employeeId || null,
        generatedBy: session.user.id,
        fieldValues: fieldValues,
        fileName: downloadName,
      },
    });

    // Audit
    await writeAudit({
      action: "DOCUMENT_GENERATE",
      actorId: session.user.id,
      actorName: session.user.name || session.user.email || "",
      actorRole: session.user.role,
      targetType: "DocumentTemplate",
      targetId: id,
      targetName: template.name,
      metadata: { employeeId, fileName: downloadName },
    });

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(downloadName)}"`,
      },
    });
  } catch (err) {
    console.error("Generate error:", err);
    return NextResponse.json({ error: "Lỗi tạo file" }, { status: 500 });
  }
}
