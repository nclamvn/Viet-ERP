import { db } from "@/lib/db";
import type {
  EmployeeFilters,
  PaginatedResponse,
  EmployeeWithRelations,
} from "@/types";
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
} from "@/lib/validations/employee";
import type { Prisma } from ".prisma/hrm-unified-client";

export const employeeService = {
  async findAll(
    tenantId: string,
    filters: EmployeeFilters = {},
  ): Promise<PaginatedResponse<EmployeeWithRelations>> {
    const {
      search,
      departmentId,
      positionId,
      branchId,
      status,
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.EmployeeWhereInput = {
      tenantId,
      deletedAt: null,
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { employeeCode: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
          { workEmail: { contains: search, mode: "insensitive" } },
        ],
      }),
      ...(departmentId && { departmentId }),
      ...(positionId && { positionId }),
      ...(branchId && { branchId }),
      ...(status && { status }),
    };

    const [data, total] = await Promise.all([
      db.employee.findMany({
        where,
        include: {
          department: true,
          position: true,
          branch: true,
          directManager: {
            select: {
              id: true,
              fullName: true,
              employeeCode: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.employee.count({ where }),
    ]);

    return {
      data: data as EmployeeWithRelations[],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  async findById(
    tenantId: string,
    id: string,
  ): Promise<EmployeeWithRelations | null> {
    return db.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        department: true,
        position: true,
        branch: true,
        directManager: true,
        contracts: {
          orderBy: { startDate: "desc" },
        },
        dependents: {
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
        },
      },
    }) as Promise<EmployeeWithRelations | null>;
  },

  async create(tenantId: string, data: CreateEmployeeInput) {
    return db.employee.create({
      data: {
        ...data,
        tenantId,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        idIssueDate: data.idIssueDate ? new Date(data.idIssueDate) : null,
        socialInsuranceDate: data.socialInsuranceDate
          ? new Date(data.socialInsuranceDate)
          : null,
        hireDate: new Date(data.hireDate),
        probationEndDate: data.probationEndDate
          ? new Date(data.probationEndDate)
          : null,
        resignationDate: data.resignationDate
          ? new Date(data.resignationDate)
          : null,
      },
      include: {
        department: true,
        position: true,
        branch: true,
      },
    });
  },

  async update(
    tenantId: string,
    id: string,
    data: Partial<UpdateEmployeeInput> & { _expectedUpdatedAt?: string },
    changedBy: string,
  ) {
    const current = await db.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!current) {
      throw new Error("Nhân viên không tồn tại");
    }

    // Optimistic locking: check if record was modified since client last fetched it
    if (data._expectedUpdatedAt) {
      const expectedTime = new Date(data._expectedUpdatedAt).getTime();
      const actualTime = current.updatedAt.getTime();
      if (actualTime > expectedTime) {
        throw new Error(
          "Dữ liệu đã được chỉnh sửa bởi người khác. Vui lòng tải lại trang và thử lại.",
        );
      }
    }

    // Track changes for history
    const changes: {
      fieldName: string;
      oldValue: string | null;
      newValue: string | null;
    }[] = [];
    const updateData = { ...data } as Record<string, unknown>;
    delete updateData._expectedUpdatedAt;

    // Process dates
    if (data.dateOfBirth !== undefined) {
      updateData.dateOfBirth = data.dateOfBirth
        ? new Date(data.dateOfBirth)
        : null;
    }
    if (data.idIssueDate !== undefined) {
      updateData.idIssueDate = data.idIssueDate
        ? new Date(data.idIssueDate)
        : null;
    }
    if (data.socialInsuranceDate !== undefined) {
      updateData.socialInsuranceDate = data.socialInsuranceDate
        ? new Date(data.socialInsuranceDate)
        : null;
    }
    if (data.hireDate !== undefined) {
      updateData.hireDate = new Date(data.hireDate);
    }
    if (data.probationEndDate !== undefined) {
      updateData.probationEndDate = data.probationEndDate
        ? new Date(data.probationEndDate)
        : null;
    }
    if (data.resignationDate !== undefined) {
      updateData.resignationDate = data.resignationDate
        ? new Date(data.resignationDate)
        : null;
    }

    // Compare and track changes for important fields
    const trackFields = [
      "departmentId",
      "positionId",
      "branchId",
      "status",
      "directManagerId",
      "fullName",
      "phone",
      "workEmail",
    ];

    for (const field of trackFields) {
      if (field in data) {
        const oldValue = current[field as keyof typeof current];
        const newValue = data[field as keyof typeof data];
        if (String(oldValue) !== String(newValue)) {
          changes.push({
            fieldName: field,
            oldValue: oldValue ? String(oldValue) : null,
            newValue: newValue ? String(newValue) : null,
          });
        }
      }
    }

    // Remove id from update data
    delete updateData.id;

    const updated = await db.employee.update({
      where: { id },
      data: updateData as Prisma.EmployeeUpdateInput,
      include: {
        department: true,
        position: true,
        branch: true,
      },
    });

    // Create change history records
    if (changes.length > 0) {
      await db.employeeChangeHistory.createMany({
        data: changes.map((change) => ({
          employeeId: id,
          fieldName: change.fieldName,
          oldValue: change.oldValue,
          newValue: change.newValue,
          changedBy,
          changedAt: new Date(),
        })),
      });
    }

    return updated;
  },

  async softDelete(tenantId: string, id: string) {
    const employee = await db.employee.findFirst({
      where: { id, tenantId, deletedAt: null },
    });

    if (!employee) {
      throw new Error("Nhân viên không tồn tại");
    }

    return db.employee.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  },

  async restore(tenantId: string, id: string) {
    const employee = await db.employee.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
    });

    if (!employee) {
      throw new Error("Nhân viên không tồn tại hoặc chưa bị xóa");
    }

    return db.employee.update({
      where: { id },
      data: { deletedAt: null },
    });
  },

  async getNextEmployeeCode(tenantId: string): Promise<string> {
    const lastEmployee = await db.employee.findFirst({
      where: { tenantId },
      orderBy: { employeeCode: "desc" },
      select: { employeeCode: true },
    });

    if (!lastEmployee) {
      return "NV00001";
    }

    const match = lastEmployee.employeeCode.match(/\d+$/);
    const num = match ? parseInt(match[0], 10) + 1 : 1;
    return `NV${String(num).padStart(5, "0")}`;
  },

  async getChangeHistory(employeeId: string) {
    return db.employeeChangeHistory.findMany({
      where: { employeeId },
      orderBy: { changedAt: "desc" },
      take: 50,
    });
  },

  async getStats(tenantId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalEmployees,
      activeEmployees,
      probationEmployees,
      newHiresThisMonth,
      resignedThisMonth,
    ] = await Promise.all([
      db.employee.count({ where: { tenantId, deletedAt: null } }),
      db.employee.count({
        where: { tenantId, deletedAt: null, status: "ACTIVE" },
      }),
      db.employee.count({
        where: { tenantId, deletedAt: null, status: "PROBATION" },
      }),
      db.employee.count({
        where: {
          tenantId,
          deletedAt: null,
          hireDate: { gte: startOfMonth },
        },
      }),
      db.employee.count({
        where: {
          tenantId,
          deletedAt: null,
          status: "RESIGNED",
          resignationDate: { gte: startOfMonth },
        },
      }),
    ]);

    const expiringContracts = await db.contract.count({
      where: {
        tenantId,
        status: "ACTIVE",
        endDate: {
          gte: now,
          lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      },
    });

    return {
      totalEmployees,
      activeEmployees,
      probationEmployees,
      newHiresThisMonth,
      resignedThisMonth,
      expiringContracts,
    };
  },
};
