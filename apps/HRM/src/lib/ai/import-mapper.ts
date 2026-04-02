import Anthropic from "@anthropic-ai/sdk";
import type { ImportType } from ".prisma/hrm-client";

export interface ColumnMapping {
  mappings: Array<{
    source: string;
    target: string;
    confidence: number;
  }>;
  unmapped: string[];
  warnings: string[];
}

const SYSTEM_PROMPTS: Record<ImportType, string> = {
  EMPLOYEES: `Bạn là AI chuyên mapping cột Excel cho hệ thống HRM.
Cho danh sách header cột từ file Excel, hãy map sang các field sau của bảng Employee:

REQUIRED: fullName (Họ tên), gender (Giới tính: Nam/Nữ)
OPTIONAL: dateOfBirth (Ngày sinh), phone (SĐT), nationalId (CCCD/CMND), nationalIdDate (Ngày cấp), nationalIdPlace (Nơi cấp), permanentAddress (Địa chỉ thường trú), currentAddress (Địa chỉ hiện tại), departmentName (Phòng ban - tên), positionName (Chức vụ - tên), startDate (Ngày vào làm), bankAccount (Số TK ngân hàng), bankBranch (Chi nhánh NH), taxCode (Mã số thuế), insuranceCode (Mã BHXH), companyEmail (Email công ty), personalEmail (Email cá nhân), vehiclePlate (Biển số xe), school (Trường), major (Chuyên ngành), status (Trạng thái)

Lưu ý: Header có thể là tiếng Việt có/không dấu, tiếng Anh, hoặc viết tắt.`,

  PAYROLL: `Bạn là AI chuyên mapping cột Excel cho hệ thống HRM.
Cho danh sách header cột từ file Excel, hãy map sang các field sau của bảng Payroll:

REQUIRED: employeeCode (Mã NV) HOẶC employeeName (Tên NV), month (Tháng), year (Năm)
OPTIONAL: baseSalary (Lương cơ bản), mealAllowance (Phụ cấp cơm), phoneAllowance (Phụ cấp ĐT), fuelAllowance (Phụ cấp xăng), perfAllowance (Phụ cấp hiệu suất), actualDays (Số ngày công thực tế), standardDays (Ngày công chuẩn), notes (Ghi chú)

Lưu ý: Header có thể là tiếng Việt có/không dấu, tiếng Anh, hoặc viết tắt.`,

  ATTENDANCE: `Bạn là AI chuyên mapping cột Excel cho hệ thống HRM.
Cho danh sách header cột từ file Excel, hãy map sang các field sau của bảng Attendance:

REQUIRED: employeeCode (Mã NV) HOẶC employeeName (Tên NV), date (Ngày)
OPTIONAL: checkIn (Giờ vào), checkOut (Giờ ra), status (Trạng thái: Có mặt/Đi muộn/Vắng/Nghỉ phép)

Lưu ý: Header có thể là tiếng Việt có/không dấu, tiếng Anh, hoặc viết tắt.`,

  CONTRACTS: `Bạn là AI chuyên mapping cột Excel cho hệ thống HRM.
Cho danh sách header cột từ file Excel, hãy map sang các field sau của bảng Contract:

REQUIRED: employeeCode (Mã NV) HOẶC employeeName (Tên NV), contractType (Loại HĐ)
OPTIONAL: contractNo (Số HĐ), probationNo (Số HĐ thử việc), probationFrom (Từ ngày TV), probationTo (Đến ngày TV), officialFrom (Từ ngày chính thức), officialTo (Đến ngày chính thức), baseSalary (Lương cơ bản), mealAllowance (Phụ cấp cơm), phoneAllowance (Phụ cấp ĐT), fuelAllowance (Phụ cấp xăng), perfAllowance (Phụ cấp hiệu suất), kpiAmount (KPI), notes (Ghi chú)

Lưu ý: Header có thể là tiếng Việt có/không dấu, tiếng Anh, hoặc viết tắt.`,
};

export async function generateColumnMapping(
  importType: ImportType,
  headers: string[],
  sampleRows: Record<string, unknown>[],
): Promise<ColumnMapping> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      mappings: [],
      unmapped: headers,
      warnings: ["ANTHROPIC_API_KEY chưa được cấu hình"],
    };
  }

  const anthropic = new Anthropic({ apiKey });

  const userPrompt = `Headers: ${JSON.stringify(headers)}

Dữ liệu mẫu (${sampleRows.length} dòng đầu):
${JSON.stringify(sampleRows.slice(0, 5), null, 2)}

Trả về JSON theo format CHÍNH XÁC sau (không thêm markdown code fences):
{
  "mappings": [
    { "source": "Tên cột gốc", "target": "tên field hệ thống", "confidence": 0.95 }
  ],
  "unmapped": ["cột không map được"],
  "warnings": ["cảnh báo nếu có"]
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: SYSTEM_PROMPTS[importType],
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Strip markdown code fences if present
    const jsonStr = text
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const parsed = JSON.parse(jsonStr);
    return {
      mappings: Array.isArray(parsed.mappings) ? parsed.mappings : [],
      unmapped: Array.isArray(parsed.unmapped) ? parsed.unmapped : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch (error) {
    console.error("AI mapping error:", error);
    return {
      mappings: [],
      unmapped: headers,
      warnings: [
        `AI mapping thất bại: ${error instanceof Error ? error.message : "Unknown error"}`,
      ],
    };
  }
}
