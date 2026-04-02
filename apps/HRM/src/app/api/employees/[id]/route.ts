import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmployeeUpdateSchema } from "@/lib/validations/employee";
import { convertToNoAccent } from "@/lib/utils/employee";
import { UserRole } from ".prisma/hrm-client";
import { format } from "date-fns";

const HR_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];
const MANAGER_ONLY_FIELDS = [
  "status",
  "resignDate",
  "resignDecisionNo",
  "departmentId",
  "positionId",
];
const MANAGER_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      department: { select: { id: true, name: true, code: true } },
      position: { select: { id: true, name: true, code: true } },
      teamManager: { select: { id: true, fullName: true, employeeCode: true } },
      contracts: { orderBy: { createdAt: "desc" }, take: 5 },
      dependents: true,
      changeHistory: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!employee) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // RBAC: EMPLOYEE can only view themselves
  const role = session.user.role;
  if (role === "EMPLOYEE") {
    const userEmployee = await prisma.employee.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!userEmployee || userEmployee.id !== employee.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // DEPT_MANAGER: can view employees in their managed departments
  if (role === "DEPT_MANAGER") {
    const userEmployee = await prisma.employee.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (userEmployee) {
      if (userEmployee.id === employee.id) {
        // Can view themselves
      } else {
        const managedDepts = await prisma.department.findMany({
          where: { managerId: userEmployee.id },
          select: { id: true },
        });
        const deptIds = managedDepts.map((d) => d.id);
        if (
          !employee.departmentId ||
          !deptIds.includes(employee.departmentId)
        ) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      }
    }
  }

  // Resolve UUIDs in change history for FK fields (departmentId, positionId, teamManagerId)
  const resolvedHistory = await resolveChangeHistoryValues(
    employee.changeHistory,
  );
  const responseData = { ...employee, changeHistory: resolvedHistory };

  return NextResponse.json(responseData);
}

// Resolve FK UUIDs to human-readable names in change history
async function resolveChangeHistoryValues(
  history: {
    id: string;
    fieldName: string;
    oldValue: string | null;
    newValue: string | null;
    changedBy: string;
    reason: string | null;
    createdAt: Date;
  }[],
) {
  if (history.length === 0) return history;

  // Collect all unique UUIDs that need resolving
  const FK_FIELDS = ["departmentId", "positionId", "teamManagerId"];
  const deptIds = new Set<string>();
  const posIds = new Set<string>();
  const empIds = new Set<string>();

  for (const ch of history) {
    if (!FK_FIELDS.includes(ch.fieldName)) continue;
    for (const val of [ch.oldValue, ch.newValue]) {
      if (!val) continue;
      if (ch.fieldName === "departmentId") deptIds.add(val);
      else if (ch.fieldName === "positionId") posIds.add(val);
      else if (ch.fieldName === "teamManagerId") empIds.add(val);
    }
  }

  // Batch fetch names
  const [depts, positions, managers] = await Promise.all([
    deptIds.size > 0
      ? prisma.department.findMany({
          where: { id: { in: Array.from(deptIds) } },
          select: { id: true, name: true },
        })
      : [],
    posIds.size > 0
      ? prisma.position.findMany({
          where: { id: { in: Array.from(posIds) } },
          select: { id: true, name: true },
        })
      : [],
    empIds.size > 0
      ? prisma.employee.findMany({
          where: { id: { in: Array.from(empIds) } },
          select: { id: true, fullName: true, employeeCode: true },
        })
      : [],
  ]);

  const deptMap = new Map(depts.map((d) => [d.id, d.name]));
  const posMap = new Map(positions.map((p) => [p.id, p.name]));
  const mgrMap = new Map(
    managers.map((m) => [m.id, `${m.fullName} (${m.employeeCode})`]),
  );

  function resolveValue(fieldName: string, val: string | null): string | null {
    if (!val) return val;
    if (fieldName === "departmentId") return deptMap.get(val) || val;
    if (fieldName === "positionId") return posMap.get(val) || val;
    if (fieldName === "teamManagerId") return mgrMap.get(val) || val;
    return val;
  }

  return history.map((ch) => {
    if (!FK_FIELDS.includes(ch.fieldName)) return ch;
    return {
      ...ch,
      oldValue: resolveValue(ch.fieldName, ch.oldValue),
      newValue: resolveValue(ch.fieldName, ch.newValue),
    };
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!HR_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = EmployeeUpdateSchema.safeParse(body);

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

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Check manager-only fields — only block if value actually changed
    if (!MANAGER_ROLES.includes(session.user.role)) {
      for (const field of MANAGER_ONLY_FIELDS) {
        if (field in data) {
          const newVal = data[field as keyof typeof data];
          const oldVal = existing[field as keyof typeof existing];
          const newStr = newVal != null ? String(newVal) : null;
          const oldStr = oldVal != null ? String(oldVal) : null;
          if (newStr !== oldStr) {
            return NextResponse.json(
              { error: `Chỉ HR_MANAGER+ mới được sửa field: ${field}` },
              { status: 403 },
            );
          }
        }
      }
    }

    // Build update data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    // Map string dates to Date objects
    const dateFields = [
      "dateOfBirth",
      "nationalIdDate",
      "startDate",
      "resignDate",
    ];
    const directFields = [
      "fullName",
      "gender",
      "permanentAddress",
      "currentAddress",
      "phone",
      "nationalId",
      "nationalIdPlace",
      "departmentId",
      "positionId",
      "teamManagerId",
      "jobDescription",
      "status",
      "bankAccount",
      "bankBranch",
      "taxCode",
      "taxCodeOld",
      "insuranceCode",
      "companyEmail",
      "personalEmail",
      "vehiclePlate",
      "school",
      "major",
      "resignDecisionNo",
    ];

    for (const field of directFields) {
      if (field in data) {
        updateData[field] = data[field as keyof typeof data] || null;
      }
    }

    for (const field of dateFields) {
      if (field in data) {
        const val = data[field as keyof typeof data] as string | undefined;
        updateData[field] = val ? new Date(val) : null;
      }
    }

    if ("hrDocsSubmitted" in data) {
      updateData.hrDocsSubmitted = data.hrDocsSubmitted ?? {};
    }

    // Auto-recalculate nameNoAccent if fullName changed
    if (data.fullName) {
      updateData.nameNoAccent = convertToNoAccent(data.fullName);
    }

    // Track changes
    const trackFields = [...directFields, ...dateFields, "hrDocsSubmitted"];
    const historyRecords: Array<{
      employeeId: string;
      changedBy: string;
      fieldName: string;
      oldValue: string | null;
      newValue: string | null;
      reason: string | null;
    }> = [];

    const formatFieldValue = (val: unknown): string | null => {
      if (val == null) return null;
      if (val instanceof Date) return format(val, "dd/MM/yyyy");
      return String(val);
    };

    for (const field of trackFields) {
      if (!(field in data)) continue;
      const oldVal = existing[field as keyof typeof existing];
      const newVal = updateData[field];
      const oldStr = formatFieldValue(oldVal);
      const newStr = formatFieldValue(newVal);
      if (oldStr !== newStr) {
        historyRecords.push({
          employeeId: id,
          changedBy: session.user.id,
          fieldName: field,
          oldValue: oldStr,
          newValue: newStr,
          reason: null,
        });
      }
    }

    const employee = await prisma.employee.update({
      where: { id },
      data: updateData,
      include: {
        department: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
      },
    });

    // Save change history
    if (historyRecords.length > 0) {
      await prisma.employeeChangeHistory.createMany({ data: historyRecords });
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        employeeId: id,
        action: "UPDATE",
        entity: "Employee",
        entityId: id,
        oldData: JSON.parse(JSON.stringify(existing)),
        newData: JSON.parse(JSON.stringify(employee)),
      },
    });

    return NextResponse.json(employee);
  } catch (error) {
    // Handle unique constraint violations (e.g., nationalId, companyEmail)
    if (
      error instanceof Error &&
      error.message?.includes("Unique constraint")
    ) {
      const field = error.message.includes("national_id")
        ? "CCCD/CMND"
        : error.message.includes("company_email")
          ? "Email công ty"
          : "Trường dữ liệu";
      return NextResponse.json(
        { error: `${field} đã tồn tại trong hệ thống` },
        { status: 409 },
      );
    }
    console.error("Update employee error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
