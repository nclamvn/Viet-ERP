import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';

// Select object that explicitly EXCLUDES password
const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  avatar: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  companyId: true,
} satisfies Prisma.UserSelect;

// Extended select with company and counts
const userDetailSelect = {
  ...userSelect,
  company: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
  _count: {
    select: {
      promotions: true,
      claims: true,
    },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND ALL (PAGINATED)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: UserQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { search, sortBy, sortOrder, role, isActive, companyId } = query;

    // Build where clause
    const where: Prisma.UserWhereInput = {};

    if (role) {
      where.role = role;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (companyId) {
      where.companyId = companyId;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Dynamic orderBy
    const validFields = ['name', 'email', 'role', 'isActive', 'createdAt', 'updatedAt'];
    const orderBy =
      sortBy && validFields.includes(sortBy)
        ? { [sortBy]: sortOrder }
        : { createdAt: 'desc' as const };

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          ...userSelect,
          company: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          _count: {
            select: {
              promotions: true,
              claims: true,
            },
          },
        },
        skip,
        take,
        orderBy,
      }),
      this.prisma.user.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND ONE (DETAIL)
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userDetailSelect,
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND BY EMAIL (INTERNAL - includes password for auth)
  // ═══════════════════════════════════════════════════════════════════════════
  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        password: true,
        avatar: true,
        isActive: true,
        companyId: true,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE USER
  // ═══════════════════════════════════════════════════════════════════════════
  async create(createUserDto: CreateUserDto) {
    const { email, password, ...rest } = createUserDto;

    // Check for unique email
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(`User with email ${email} already exists`);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        ...rest,
        email,
        password: hashedPassword,
      },
      select: userDetailSelect,
    });

    return user;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE USER
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, updateUserDto: UpdateUserDto) {
    // Check user exists
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const { password, ...rest } = updateUserDto;

    const data: Prisma.UserUpdateInput = { ...rest };

    // If password provided, hash it
    if (password) {
      data.password = await bcrypt.hash(password, 10);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: userDetailSelect,
    });

    return user;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REMOVE (SOFT DELETE - set isActive=false)
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });

    if (!existing) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (!existing.isActive) {
      throw new BadRequestException(`User with ID ${id} is already deactivated`);
    }

    await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    return { message: `User ${id} has been deactivated` };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHANGE ROLE
  // ═══════════════════════════════════════════════════════════════════════════
  async changeRole(id: string, role: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const validRoles = ['ADMIN', 'MANAGER', 'KAM', 'FINANCE'];
    if (!validRoles.includes(role)) {
      throw new BadRequestException(
        `Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`,
      );
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { role: role as any },
      select: userDetailSelect,
    });

    return user;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET PROFILE (current user)
  // ═══════════════════════════════════════════════════════════════════════════
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userDetailSelect,
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    return user;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform user (strip password)
  // ═══════════════════════════════════════════════════════════════════════════
  transformUser(user: any) {
    if (!user) return null;
    const { password, ...safeUser } = user;
    return safeUser;
  }
}
