import { db } from "@/lib/db";
import type {
  ContractFilters,
  PaginatedResponse,
  ContractWithRelations,
} from "@/types";
import type {
  CreateContractInput,
  UpdateContractInput,
} from "@/lib/validations/contract";
import type { Prisma } from ".prisma/hrm-unified-client";

export const contractService = {
  async findAll(
    tenantId: string,
    filters: ContractFilters = {},
  ): Promise<PaginatedResponse<ContractWithRelations>> {
    const {
      search,
      employeeId,
      status,
      contractType,
      page = 1,
      pageSize = 20,
    } = filters;

    const where: Prisma.ContractWhereInput = {
      tenantId,
      ...(search && {
        OR: [
          { contractNumber: { contains: search, mode: "insensitive" } },
          { employee: { fullName: { contains: search, mode: "insensitive" } } },
          {
            employee: {
              employeeCode: { contains: search, mode: "insensitive" },
            },
          },
        ],
      }),
      ...(employeeId && { employeeId }),
      ...(status && { status }),
      ...(contractType && { contractType }),
    };

    const [data, total] = await Promise.all([
      db.contract.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              fullName: true,
              department: true,
              position: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.contract.count({ where }),
    ]);

    return {
      data: data as unknown as ContractWithRelations[],
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
  ): Promise<ContractWithRelations | null> {
    return db.contract.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          include: {
            department: true,
            position: true,
          },
        },
      },
    }) as unknown as Promise<ContractWithRelations | null>;
  },

  async findByEmployeeId(tenantId: string, employeeId: string) {
    return db.contract.findMany({
      where: { tenantId, employeeId },
      orderBy: { startDate: "desc" },
    });
  },

  async create(tenantId: string, data: CreateContractInput) {
    return db.contract.create({
      data: {
        tenantId,
        employeeId: data.employeeId,
        contractNumber: data.contractNumber,
        contractType: data.contractType,
        signedDate: data.signedDate ? new Date(data.signedDate) : null,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        baseSalary: data.baseSalary,
        salaryType: data.salaryType,
        insuranceSalary: data.insuranceSalary,
        allowances: data.allowances || [],
        workSchedule: data.workSchedule,
        status: data.status,
        terminationDate: data.terminationDate
          ? new Date(data.terminationDate)
          : null,
        terminationReason: data.terminationReason,
        attachmentUrl: data.attachmentUrl,
        notes: data.notes,
      },
      include: {
        employee: true,
      },
    });
  },

  async update(
    tenantId: string,
    id: string,
    data: Partial<UpdateContractInput>,
  ) {
    const current = await db.contract.findFirst({
      where: { id, tenantId },
    });

    if (!current) {
      throw new Error("Hợp đồng không tồn tại");
    }

    const updateData: Prisma.ContractUpdateInput = {};

    if (data.contractNumber !== undefined)
      updateData.contractNumber = data.contractNumber;
    if (data.contractType !== undefined)
      updateData.contractType = data.contractType;
    if (data.signedDate !== undefined)
      updateData.signedDate = data.signedDate
        ? new Date(data.signedDate)
        : null;
    if (data.startDate !== undefined)
      updateData.startDate = new Date(data.startDate);
    if (data.endDate !== undefined)
      updateData.endDate = data.endDate ? new Date(data.endDate) : null;
    if (data.baseSalary !== undefined) updateData.baseSalary = data.baseSalary;
    if (data.salaryType !== undefined) updateData.salaryType = data.salaryType;
    if (data.insuranceSalary !== undefined)
      updateData.insuranceSalary = data.insuranceSalary;
    if (data.allowances !== undefined) updateData.allowances = data.allowances;
    if (data.workSchedule !== undefined)
      updateData.workSchedule = data.workSchedule;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.terminationDate !== undefined)
      updateData.terminationDate = data.terminationDate
        ? new Date(data.terminationDate)
        : null;
    if (data.terminationReason !== undefined)
      updateData.terminationReason = data.terminationReason;
    if (data.attachmentUrl !== undefined)
      updateData.attachmentUrl = data.attachmentUrl;
    if (data.notes !== undefined) updateData.notes = data.notes;

    return db.contract.update({
      where: { id },
      data: updateData,
      include: {
        employee: true,
      },
    });
  },

  async delete(tenantId: string, id: string) {
    const contract = await db.contract.findFirst({
      where: { id, tenantId },
    });

    if (!contract) {
      throw new Error("Hợp đồng không tồn tại");
    }

    return db.contract.delete({
      where: { id },
    });
  },

  async getNextContractNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const lastContract = await db.contract.findFirst({
      where: {
        tenantId,
        contractNumber: { startsWith: `HD${year}/` },
      },
      orderBy: { contractNumber: "desc" },
      select: { contractNumber: true },
    });

    if (!lastContract) {
      return `HD${year}/0001`;
    }

    const match = lastContract.contractNumber.match(/\/(\d+)$/);
    const num = match ? parseInt(match[1], 10) + 1 : 1;
    return `HD${year}/${String(num).padStart(4, "0")}`;
  },

  async getExpiringContracts(tenantId: string, days = 30) {
    const now = new Date();
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    return db.contract.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        endDate: {
          gte: now,
          lte: futureDate,
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
            department: true,
          },
        },
      },
      orderBy: { endDate: "asc" },
    });
  },
};
