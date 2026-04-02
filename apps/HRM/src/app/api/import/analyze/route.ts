import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import * as XLSX from "xlsx";
import { generateColumnMapping } from "@/lib/ai/import-mapper";
import {
  dryRunEmployees,
  dryRunPayroll,
  dryRunAttendance,
  dryRunContracts,
} from "@/lib/import/validators";
import { prisma } from "@/lib/prisma";
import type { ImportType } from ".prisma/hrm-client";
import { Prisma } from ".prisma/hrm-client";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROWS = 5000;
const VALID_TYPES = [
  "EMPLOYEES",
  "PAYROLL",
  "ATTENDANCE",
  "CONTRACTS",
] as const;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const type = formData.get("type") as string;

    if (!file) {
      return NextResponse.json({ error: "File là bắt buộc" }, { status: 400 });
    }

    if (!type || !VALID_TYPES.includes(type as ImportType)) {
      return NextResponse.json(
        { error: "Loại import không hợp lệ" },
        { status: 400 },
      );
    }

    // Validate file extension
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["xlsx", "xls", "csv"].includes(ext)) {
      return NextResponse.json(
        { error: "Chỉ hỗ trợ file .xlsx, .xls, .csv" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File quá lớn (tối đa 10MB)" },
        { status: 400 },
      );
    }

    // Parse Excel
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet) as Record<
      string,
      unknown
    >[];

    if (rawRows.length === 0) {
      return NextResponse.json(
        { error: "File không có dữ liệu" },
        { status: 400 },
      );
    }

    if (rawRows.length > MAX_ROWS) {
      return NextResponse.json(
        {
          error: `File có ${rawRows.length.toLocaleString()} hàng, vượt quá giới hạn ${MAX_ROWS.toLocaleString()} hàng.`,
          hint: "Hãy chia nhỏ file thành nhiều lần import.",
        },
        { status: 400 },
      );
    }

    const headers = Object.keys(rawRows[0]);
    const sampleRows = rawRows.slice(0, 5);

    // AI column mapping
    const mapping = await generateColumnMapping(
      type as ImportType,
      headers,
      sampleRows,
    );

    // Dry run validation
    const importType = type as ImportType;
    let dryRunResult;
    switch (importType) {
      case "EMPLOYEES":
        dryRunResult = await dryRunEmployees(rawRows, mapping);
        break;
      case "PAYROLL":
        dryRunResult = await dryRunPayroll(rawRows, mapping);
        break;
      case "ATTENDANCE":
        dryRunResult = await dryRunAttendance(rawRows, mapping);
        break;
      case "CONTRACTS":
        dryRunResult = await dryRunContracts(rawRows, mapping);
        break;
    }

    // Create import session
    const importSession = await prisma.importSession.create({
      data: {
        type: importType,
        status: "DRY_RUN",
        fileName: file.name,
        fileSize: file.size,
        totalRows: rawRows.length,
        mapping: mapping as unknown as Prisma.InputJsonValue,
        errors: dryRunResult.errors as unknown as Prisma.InputJsonValue,
        rawData: rawRows as unknown as Prisma.InputJsonValue,
        importedBy: session.user.id,
      },
    });

    return NextResponse.json({
      sessionId: importSession.id,
      mapping,
      dryRunResult,
    });
  } catch (error) {
    console.error("Import analyze error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lỗi phân tích file" },
      { status: 500 },
    );
  }
}
