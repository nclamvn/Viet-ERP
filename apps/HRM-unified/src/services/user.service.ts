import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import type { UserRole } from ".prisma/hrm-unified-client";

interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  employeeId?: string;
}

interface UpdateUserInput {
  name?: string;
  role?: UserRole;
  isActive?: boolean;
  employeeId?: string;
}

export const userService = {
  async findAll(tenantId: string) {
    return db.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async findById(tenantId: string, id: string) {
    return db.user.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        employee: {
          select: {
            id: true,
            employeeCode: true,
            fullName: true,
          },
        },
      },
    });
  },

  async findByEmail(tenantId: string, email: string) {
    return db.user.findFirst({
      where: { tenantId, email },
    });
  },

  async create(tenantId: string, data: CreateUserInput) {
    // Check for duplicate email
    const existing = await db.user.findFirst({
      where: { tenantId, email: data.email },
    });

    if (existing) {
      throw new Error("Email đã tồn tại");
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    return db.user.create({
      data: {
        tenantId,
        email: data.email,
        passwordHash,
        name: data.name,
        role: data.role ?? "VIEWER",
        employeeId: data.employeeId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  },

  async update(tenantId: string, id: string, data: UpdateUserInput) {
    const current = await db.user.findFirst({
      where: { id, tenantId },
    });

    if (!current) {
      throw new Error("Người dùng không tồn tại");
    }

    return db.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.employeeId !== undefined && { employeeId: data.employeeId }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  },

  async updatePassword(tenantId: string, id: string, newPassword: string) {
    const current = await db.user.findFirst({
      where: { id, tenantId },
    });

    if (!current) {
      throw new Error("Người dùng không tồn tại");
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    return db.user.update({
      where: { id },
      data: { passwordHash },
    });
  },

  async delete(tenantId: string, id: string) {
    const user = await db.user.findFirst({
      where: { id, tenantId },
    });

    if (!user) {
      throw new Error("Người dùng không tồn tại");
    }

    // Soft delete by deactivating
    return db.user.update({
      where: { id },
      data: { isActive: false },
    });
  },
};
