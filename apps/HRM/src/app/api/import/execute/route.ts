import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/services/audit.service";
import { executeEmployeeImport } from "@/lib/import/executors/employee-executor";
import { executePayrollImport } from "@/lib/import/executors/payroll-executor";
import { executeAttendanceImport } from "@/lib/import/executors/attendance-executor";
import { executeContractImport } from "@/lib/import/executors/contract-executor";
import type { ColumnMapping } from "@/lib/ai/import-mapper";
import { Prisma } from ".prisma/hrm-client";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId là bắt buộc" },
        { status: 400 },
      );
    }

    const importSession = await prisma.importSession.findUnique({
      where: { id: sessionId },
    });

    if (!importSession) {
      return NextResponse.json(
        { error: "Phiên import không tồn tại" },
        { status: 404 },
      );
    }

    if (importSession.status !== "DRY_RUN") {
      return NextResponse.json(
        { error: "Phiên import đã được thực hiện" },
        { status: 400 },
      );
    }

    const rawData = importSession.rawData as Record<string, unknown>[];
    const mapping = importSession.mapping as unknown as ColumnMapping;

    let result;
    switch (importSession.type) {
      case "EMPLOYEES":
        result = await executeEmployeeImport(rawData, mapping);
        break;
      case "PAYROLL":
        result = await executePayrollImport(rawData, mapping, session.user.id);
        break;
      case "ATTENDANCE":
        result = await executeAttendanceImport(rawData, mapping);
        break;
      case "CONTRACTS":
        result = await executeContractImport(rawData, mapping);
        break;
    }

    // Build metadata for rollback info
    const metadata: Record<string, unknown> = {};
    if ("createdDepartmentIds" in result) {
      metadata.createdDepartmentIds = result.createdDepartmentIds;
    }
    if ("createdPositionIds" in result) {
      metadata.createdPositionIds = result.createdPositionIds;
    }
    if ("createdPeriodIds" in result) {
      metadata.createdPeriodIds = result.createdPeriodIds;
    }

    // Update session
    await prisma.importSession.update({
      where: { id: sessionId },
      data: {
        status:
          result.errors.length > 0 && result.successCount === 0
            ? "FAILED"
            : "COMPLETED",
        importedIds: result.importedIds as unknown as Prisma.InputJsonValue,
        successRows: result.successCount,
        errorRows: result.errors.length,
        errors: result.errors as unknown as Prisma.InputJsonValue,
        metadata: metadata as Prisma.InputJsonObject,
        completedAt: new Date(),
      },
    });

    // Audit log
    try {
      await writeAudit({
        action: "DATA_IMPORT",
        actorId: session.user.id,
        actorName: session.user.name || session.user.email || "",
        actorRole: session.user.role,
        targetType: "ImportSession",
        targetId: sessionId,
        targetName: `${importSession.type} - ${importSession.fileName}`,
        metadata: {
          type: importSession.type,
          fileName: importSession.fileName,
          totalRows: importSession.totalRows,
          successRows: result.successCount,
          errorRows: result.errors.length,
        },
      });
    } catch {
      // Audit failure should not block import
    }

    return NextResponse.json({
      imported: result.successCount,
      errors: result.errors,
      status:
        result.errors.length > 0 && result.successCount === 0
          ? "FAILED"
          : "COMPLETED",
    });
  } catch (error) {
    console.error("Import execute error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Lỗi thực hiện import",
      },
      { status: 500 },
    );
  }
}
