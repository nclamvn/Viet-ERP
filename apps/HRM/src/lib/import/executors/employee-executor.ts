import { prisma } from "@/lib/prisma";
import { generateEmployeeCode } from "@/lib/utils/employee-server";
import { convertToNoAccent } from "@/lib/utils/employee";
import {
  parseDate,
  parseGender,
  generateDeptCode,
  generatePosCode,
} from "../parsers";
import type { ColumnMapping } from "@/lib/ai/import-mapper";
import { applyMapping, type ImportError } from "../validators";
import type { Prisma } from ".prisma/hrm-client";

interface ExecutorResult {
  importedIds: string[];
  createdDepartmentIds: string[];
  createdPositionIds: string[];
  errors: ImportError[];
  successCount: number;
}

export async function executeEmployeeImport(
  rawRows: Record<string, unknown>[],
  mapping: ColumnMapping,
): Promise<ExecutorResult> {
  const mappedRows = applyMapping(rawRows, mapping);
  const errors: ImportError[] = [];
  const importedIds: string[] = [];
  const createdDepartmentIds: string[] = [];
  const createdPositionIds: string[] = [];

  await prisma.$transaction(
    async (tx) => {
      // Cache departments and positions
      const deptCache = new Map<string, string>();
      const posCache = new Map<string, string>();

      const existingDepts = await tx.department.findMany({
        select: { id: true, name: true },
      });
      for (const d of existingDepts) deptCache.set(d.name.toLowerCase(), d.id);

      const existingPositions = await tx.position.findMany({
        select: { id: true, name: true },
      });
      for (const p of existingPositions)
        posCache.set(p.name.toLowerCase(), p.id);

      for (let i = 0; i < mappedRows.length; i++) {
        const row = mappedRows[i];
        const rowNum = i + 2;

        try {
          // Validate required fields
          const fullName = row.fullName ? String(row.fullName).trim() : "";
          if (!fullName) {
            errors.push({
              row: rowNum,
              field: "fullName",
              message: "Họ tên là bắt buộc",
              severity: "error",
            });
            continue;
          }

          const gender = parseGender(row.gender) || "OTHER";
          const nameNoAccent = convertToNoAccent(fullName);

          // Handle department
          let departmentId: string | undefined;
          if (row.departmentName) {
            const deptName = String(row.departmentName).trim();
            const deptKey = deptName.toLowerCase();
            if (deptCache.has(deptKey)) {
              departmentId = deptCache.get(deptKey);
            } else {
              // Auto-create department
              let code = generateDeptCode(deptName);
              // Ensure unique code
              const existing = await tx.department.findUnique({
                where: { code },
              });
              if (existing) code = `${code}-${Date.now().toString(36)}`;

              const dept = await tx.department.create({
                data: { name: deptName, code },
              });
              deptCache.set(deptKey, dept.id);
              createdDepartmentIds.push(dept.id);
              departmentId = dept.id;
            }
          }

          // Handle position
          let positionId: string | undefined;
          if (row.positionName) {
            const posName = String(row.positionName).trim();
            const posKey = posName.toLowerCase();
            if (posCache.has(posKey)) {
              positionId = posCache.get(posKey);
            } else {
              let code = generatePosCode(posName);
              const existing = await tx.position.findUnique({
                where: { code },
              });
              if (existing) code = `${code}-${Date.now().toString(36)}`;

              const pos = await tx.position.create({
                data: { name: posName, code, departmentId },
              });
              posCache.set(posKey, pos.id);
              createdPositionIds.push(pos.id);
              positionId = pos.id;
            }
          }

          const employeeCode = await generateEmployeeCode();

          const data: Prisma.EmployeeCreateInput = {
            employeeCode,
            fullName,
            nameNoAccent,
            gender,
            dateOfBirth: row.dateOfBirth
              ? parseDate(row.dateOfBirth)
              : undefined,
            phone: row.phone ? String(row.phone).trim() : undefined,
            nationalId: row.nationalId
              ? String(row.nationalId).trim()
              : undefined,
            nationalIdDate: row.nationalIdDate
              ? parseDate(row.nationalIdDate)
              : undefined,
            nationalIdPlace: row.nationalIdPlace
              ? String(row.nationalIdPlace).trim()
              : undefined,
            permanentAddress: row.permanentAddress
              ? String(row.permanentAddress).trim()
              : undefined,
            currentAddress: row.currentAddress
              ? String(row.currentAddress).trim()
              : undefined,
            startDate: row.startDate ? parseDate(row.startDate) : undefined,
            bankAccount: row.bankAccount
              ? String(row.bankAccount).trim()
              : undefined,
            bankBranch: row.bankBranch
              ? String(row.bankBranch).trim()
              : undefined,
            taxCode: row.taxCode ? String(row.taxCode).trim() : undefined,
            insuranceCode: row.insuranceCode
              ? String(row.insuranceCode).trim()
              : undefined,
            companyEmail: row.companyEmail
              ? String(row.companyEmail).trim()
              : undefined,
            personalEmail: row.personalEmail
              ? String(row.personalEmail).trim()
              : undefined,
            vehiclePlate: row.vehiclePlate
              ? String(row.vehiclePlate).trim()
              : undefined,
            school: row.school ? String(row.school).trim() : undefined,
            major: row.major ? String(row.major).trim() : undefined,
            department: departmentId
              ? { connect: { id: departmentId } }
              : undefined,
            position: positionId ? { connect: { id: positionId } } : undefined,
          };

          const employee = await tx.employee.create({ data });
          importedIds.push(employee.id);
        } catch (error) {
          errors.push({
            row: rowNum,
            field: "general",
            message:
              error instanceof Error ? error.message : "Lỗi không xác định",
            severity: "error",
          });
        }
      }
    },
    { timeout: 120000 },
  );

  return {
    importedIds,
    createdDepartmentIds,
    createdPositionIds,
    errors,
    successCount: importedIds.length,
  };
}
