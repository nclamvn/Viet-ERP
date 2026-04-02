import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmployeeCreateSchema } from "@/lib/validations/employee";
import { convertToNoAccent } from "@/lib/utils/employee";
import { generateEmployeeCode } from "@/lib/utils/employee-server";
import { UserRole } from ".prisma/hrm-client";
import { notificationService } from "@/lib/services/notification.service";
import { createOnboardingChecklist } from "@/lib/services/onboarding.service";

const LIST_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "HR_MANAGER",
  "HR_STAFF",
  "DEPT_MANAGER",
];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = session.user.role;
  if (!LIST_ROLES.includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const department = searchParams.get("department") || "";
  const status = searchParams.get("status") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || "20", 10)),
  );
  const sort = searchParams.get("sort") || "";
  const order = searchParams.get("order") || "asc";

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { nameNoAccent: { contains: search, mode: "insensitive" } },
      { employeeCode: { contains: search, mode: "insensitive" } },
      { companyEmail: { contains: search, mode: "insensitive" } },
    ];
  }

  if (department) {
    where.departmentId = department;
  }

  if (status) {
    where.status = status;
  }

  // DEPT_MANAGER: only see employees in their managed departments
  if (role === "DEPT_MANAGER") {
    const managedDepts = await prisma.department.findMany({
      where: { managerId: session.user.id },
      select: { id: true },
    });

    // Also find employee record for the user to get employee ID
    const userEmployee = await prisma.employee.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (userEmployee) {
      const managedDeptsByEmp = await prisma.department.findMany({
        where: { managerId: userEmployee.id },
        select: { id: true },
      });
      const deptIds = [...managedDepts, ...managedDeptsByEmp].map((d) => d.id);
      where.departmentId = { in: Array.from(new Set(deptIds)) };
    }
  }

  // Build orderBy
  const SORT_WHITELIST = [
    "employeeCode",
    "fullName",
    "startDate",
    "status",
  ] as const;
  type SortField = (typeof SORT_WHITELIST)[number];
  const sortField = SORT_WHITELIST.includes(sort as SortField)
    ? sort
    : "employeeCode";
  const sortDir = order === "desc" ? "desc" : "asc";

  const [data, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      include: {
        department: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
        teamManager: { select: { id: true, fullName: true } },
      },
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.employee.count({ where }),
  ]);

  return NextResponse.json({
    data,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}

const CREATE_ROLES: UserRole[] = ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"];

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!CREATE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = EmployeeCreateSchema.safeParse(body);

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
    const employeeCode = await generateEmployeeCode();
    const nameNoAccent = convertToNoAccent(data.fullName);

    // Create employee
    const employee = await prisma.employee.create({
      data: {
        employeeCode,
        fullName: data.fullName,
        nameNoAccent,
        gender: data.gender,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        permanentAddress: data.permanentAddress || null,
        currentAddress: data.currentAddress || null,
        phone: data.phone || null,
        nationalId: data.nationalId || null,
        nationalIdDate: data.nationalIdDate
          ? new Date(data.nationalIdDate)
          : null,
        nationalIdPlace: data.nationalIdPlace || null,
        departmentId: data.departmentId || null,
        positionId: data.positionId || null,
        teamManagerId: data.teamManagerId || null,
        jobDescription: data.jobDescription || null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        status: data.status,
        bankAccount: data.bankAccount || null,
        bankBranch: data.bankBranch || null,
        taxCode: data.taxCode || null,
        taxCodeOld: data.taxCodeOld || null,
        insuranceCode: data.insuranceCode || null,
        companyEmail: data.companyEmail || null,
        personalEmail: data.personalEmail || null,
        vehiclePlate: data.vehiclePlate || null,
        school: data.school || null,
        major: data.major || null,
        hrDocsSubmitted: data.hrDocsSubmitted ?? {},
      },
      include: {
        department: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
      },
    });

    // Create User account if companyEmail provided
    if (data.companyEmail) {
      const existingUser = await prisma.user.findUnique({
        where: { email: data.companyEmail },
      });
      if (!existingUser) {
        const bcrypt = await import("bcryptjs");
        const crypto = await import("crypto");
        const tempPassword = crypto.randomBytes(12).toString("base64url");
        const hashedPassword = await bcrypt.hash(tempPassword, 12);
        // TODO: Send temp password via email to employee. Log it for now in dev.
        if (process.env.NODE_ENV === "development") {
          console.log(
            `[DEV] Auto-created user ${data.companyEmail} with temp password: ${tempPassword}`,
          );
        }
        const user = await prisma.user.create({
          data: {
            email: data.companyEmail,
            password: hashedPassword,
            name: data.fullName,
            role: "EMPLOYEE",
          },
        });
        await prisma.employee.update({
          where: { id: employee.id },
          data: { userId: user.id },
        });
      }
    }

    // Create AuditLog
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        employeeId: employee.id,
        action: "CREATE",
        entity: "Employee",
        entityId: employee.id,
        newData: JSON.parse(JSON.stringify(employee)),
      },
    });

    // Create EmployeeChangeHistory for all set fields
    const trackFields = [
      "fullName",
      "gender",
      "dateOfBirth",
      "permanentAddress",
      "currentAddress",
      "phone",
      "nationalId",
      "nationalIdDate",
      "nationalIdPlace",
      "departmentId",
      "positionId",
      "teamManagerId",
      "jobDescription",
      "startDate",
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
    ];

    const historyRecords = trackFields
      .filter((field) => {
        const val = employee[field as keyof typeof employee];
        return val !== null && val !== undefined;
      })
      .map((field) => ({
        employeeId: employee.id,
        changedBy: session.user.id,
        fieldName: field,
        oldValue: null,
        newValue: String(employee[field as keyof typeof employee]),
        reason: "Tạo mới nhân viên",
      }));

    if (historyRecords.length > 0) {
      await prisma.employeeChangeHistory.createMany({ data: historyRecords });
    }

    // Create onboarding checklist if startDate provided
    if (data.startDate) {
      try {
        await createOnboardingChecklist(employee.id, new Date(data.startDate));
      } catch (e) {
        console.error("Onboarding checklist error:", e);
      }
    }

    // Notify HR about new employee (non-blocking)
    try {
      await notificationService.notifyHR({
        type: "EMPLOYEE_CREATED",
        title: "Nhân viên mới được tạo",
        message: `${employee.fullName} (${employee.employeeCode}) đã được thêm vào hệ thống`,
        link: `/employees/${employee.id}`,
        metadata: {
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
        },
      });
    } catch (notifError) {
      console.error("Notification error (non-blocking):", notifError);
    }

    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message?.includes("Unique constraint")
    ) {
      const field = error.message.includes("national_id")
        ? "CCCD/CMND"
        : error.message.includes("company_email")
          ? "Email công ty"
          : error.message.includes("employee_code")
            ? "Mã nhân viên"
            : "Trường dữ liệu";
      return NextResponse.json(
        { error: `${field} đã tồn tại trong hệ thống` },
        { status: 409 },
      );
    }
    console.error("Create employee error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
