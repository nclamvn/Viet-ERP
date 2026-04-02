import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';
import { FileQueryDto } from './dto/file-query.dto';
import { CreateFileDto } from './dto/create-file.dto';
import { CreatePoaDto } from './dto/create-poa.dto';
import { CreatePopDto } from './dto/create-pop.dto';
import { RejectReasonDto } from './dto/reject-reason.dto';
import { PoaQueryDto } from './dto/poa-query.dto';
import { PopQueryDto } from './dto/pop-query.dto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST FILES (with pagination, filtering)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: FileQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      category,
      uploadedById,
      dateFrom,
      dateTo,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.FileWhereInput = {};

    if (category) {
      where.category = category;
    }

    if (uploadedById) {
      where.uploadedById = uploadedById;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo);
      }
    }

    if (search) {
      where.OR = [
        { filename: { contains: search, mode: 'insensitive' } },
        { originalName: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = ['createdAt', 'filename', 'originalName', 'size', 'category'];
    const orderBy: Prisma.FileOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.file.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          uploadedBy: {
            select: { id: true, name: true, email: true },
          },
          poa: {
            select: { id: true, status: true, promotionId: true },
          },
          pop: {
            select: { id: true, status: true, claimId: true },
          },
        },
      }),
      this.prisma.file.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE SUMMARY (stats by category)
  // ═══════════════════════════════════════════════════════════════════════════
  async getSummary() {
    const files = await this.prisma.file.findMany({
      select: {
        category: true,
        size: true,
      },
    });

    const totalFiles = files.length;
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    // Count and sum by category
    const byCategory: Record<string, { count: number; totalSize: number }> = {};
    files.forEach((f) => {
      if (!byCategory[f.category]) {
        byCategory[f.category] = { count: 0, totalSize: 0 };
      }
      byCategory[f.category].count += 1;
      byCategory[f.category].totalSize += f.size;
    });

    return {
      totalFiles,
      totalSize,
      byCategory,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE FILE (with poa/pop includes)
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const file = await this.prisma.file.findUnique({
      where: { id },
      include: {
        uploadedBy: {
          select: { id: true, name: true, email: true },
        },
        poa: {
          include: {
            promotion: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        pop: {
          include: {
            claim: {
              select: { id: true, code: true, status: true },
            },
          },
        },
      },
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }

    return file;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REGISTER FILE METADATA (simulated upload)
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateFileDto, userId: string) {
    const file = await this.prisma.file.create({
      data: {
        filename: dto.filename,
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        size: dto.size,
        s3Key: dto.s3Key,
        s3Bucket: dto.s3Bucket,
        category: dto.category || 'OTHER',
        uploadedById: userId,
      },
      include: {
        uploadedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`File registered: ${file.originalName} by user ${userId}`);

    return file;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE FILE METADATA
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const file = await this.prisma.file.findUnique({
      where: { id },
      include: {
        poa: { select: { id: true } },
        pop: { select: { id: true } },
      },
    });

    if (!file) {
      throw new NotFoundException(`File with ID ${id} not found`);
    }

    // Check if file is linked to POA or POP
    if (file.poa) {
      throw new BadRequestException(
        'Cannot delete file that is linked to a POA. Remove the POA first.',
      );
    }
    if (file.pop) {
      throw new BadRequestException(
        'Cannot delete file that is linked to a POP. Remove the POP first.',
      );
    }

    await this.prisma.file.delete({ where: { id } });

    this.logger.log(`File deleted: ${file.originalName}`);

    return { success: true, message: 'File deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST POAs (with filters)
  // ═══════════════════════════════════════════════════════════════════════════
  async listPoas(query: PoaQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { status, promotionId } = query;

    const where: Prisma.POAWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (promotionId) {
      where.promotionId = promotionId;
    }

    const [data, total] = await Promise.all([
      this.prisma.pOA.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          file: {
            select: {
              id: true,
              filename: true,
              originalName: true,
              mimeType: true,
              size: true,
            },
          },
          promotion: {
            select: { id: true, name: true, code: true },
          },
        },
      }),
      this.prisma.pOA.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE POA (link file to promotion)
  // ═══════════════════════════════════════════════════════════════════════════
  async createPoa(dto: CreatePoaDto) {
    // Validate file exists
    const file = await this.prisma.file.findUnique({
      where: { id: dto.fileId },
    });
    if (!file) {
      throw new BadRequestException(`File with ID ${dto.fileId} not found`);
    }

    // Check if file already has a POA
    const existingPoa = await this.prisma.pOA.findUnique({
      where: { fileId: dto.fileId },
    });
    if (existingPoa) {
      throw new BadRequestException('This file is already linked to a POA');
    }

    // Validate promotion exists
    const promotion = await this.prisma.promotion.findUnique({
      where: { id: dto.promotionId },
    });
    if (!promotion) {
      throw new BadRequestException(`Promotion with ID ${dto.promotionId} not found`);
    }

    const poa = await this.prisma.pOA.create({
      data: {
        fileId: dto.fileId,
        promotionId: dto.promotionId,
        status: 'PENDING',
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            originalName: true,
            mimeType: true,
            size: true,
          },
        },
        promotion: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`POA created for promotion ${promotion.code}, file ${file.originalName}`);

    return poa;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APPROVE POA
  // ═══════════════════════════════════════════════════════════════════════════
  async approvePoa(id: string, userId: string) {
    const poa = await this.prisma.pOA.findUnique({ where: { id } });

    if (!poa) {
      throw new NotFoundException(`POA with ID ${id} not found`);
    }

    if (poa.status !== 'PENDING') {
      throw new BadRequestException(`Cannot approve POA in ${poa.status} status. Must be PENDING.`);
    }

    const updated = await this.prisma.pOA.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: userId,
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            originalName: true,
            mimeType: true,
            size: true,
          },
        },
        promotion: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`POA approved: ${id} by user ${userId}`);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REJECT POA
  // ═══════════════════════════════════════════════════════════════════════════
  async rejectPoa(id: string, dto: RejectReasonDto, userId: string) {
    const poa = await this.prisma.pOA.findUnique({ where: { id } });

    if (!poa) {
      throw new NotFoundException(`POA with ID ${id} not found`);
    }

    if (poa.status !== 'PENDING') {
      throw new BadRequestException(`Cannot reject POA in ${poa.status} status. Must be PENDING.`);
    }

    const updated = await this.prisma.pOA.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectedBy: userId,
        rejectReason: dto.rejectReason,
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            originalName: true,
            mimeType: true,
            size: true,
          },
        },
        promotion: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    this.logger.log(`POA rejected: ${id} by user ${userId}`);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST POPs (with filters)
  // ═══════════════════════════════════════════════════════════════════════════
  async listPops(query: PopQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { status, claimId } = query;

    const where: Prisma.POPWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (claimId) {
      where.claimId = claimId;
    }

    const [data, total] = await Promise.all([
      this.prisma.pOP.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          file: {
            select: {
              id: true,
              filename: true,
              originalName: true,
              mimeType: true,
              size: true,
            },
          },
          claim: {
            select: { id: true, code: true, status: true },
          },
        },
      }),
      this.prisma.pOP.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE POP (link file to claim)
  // ═══════════════════════════════════════════════════════════════════════════
  async createPop(dto: CreatePopDto) {
    // Validate file exists
    const file = await this.prisma.file.findUnique({
      where: { id: dto.fileId },
    });
    if (!file) {
      throw new BadRequestException(`File with ID ${dto.fileId} not found`);
    }

    // Check if file already has a POP
    const existingPop = await this.prisma.pOP.findUnique({
      where: { fileId: dto.fileId },
    });
    if (existingPop) {
      throw new BadRequestException('This file is already linked to a POP');
    }

    // Validate claim exists
    const claim = await this.prisma.claim.findUnique({
      where: { id: dto.claimId },
    });
    if (!claim) {
      throw new BadRequestException(`Claim with ID ${dto.claimId} not found`);
    }

    const pop = await this.prisma.pOP.create({
      data: {
        fileId: dto.fileId,
        claimId: dto.claimId,
        status: 'PENDING',
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            originalName: true,
            mimeType: true,
            size: true,
          },
        },
        claim: {
          select: { id: true, code: true, status: true },
        },
      },
    });

    this.logger.log(`POP created for claim ${claim.code}, file ${file.originalName}`);

    return pop;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFY POP
  // ═══════════════════════════════════════════════════════════════════════════
  async verifyPop(id: string, userId: string) {
    const pop = await this.prisma.pOP.findUnique({ where: { id } });

    if (!pop) {
      throw new NotFoundException(`POP with ID ${id} not found`);
    }

    if (pop.status !== 'PENDING') {
      throw new BadRequestException(`Cannot verify POP in ${pop.status} status. Must be PENDING.`);
    }

    const updated = await this.prisma.pOP.update({
      where: { id },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy: userId,
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            originalName: true,
            mimeType: true,
            size: true,
          },
        },
        claim: {
          select: { id: true, code: true, status: true },
        },
      },
    });

    this.logger.log(`POP verified: ${id} by user ${userId}`);

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REJECT POP
  // ═══════════════════════════════════════════════════════════════════════════
  async rejectPop(id: string, dto: RejectReasonDto, userId: string) {
    const pop = await this.prisma.pOP.findUnique({ where: { id } });

    if (!pop) {
      throw new NotFoundException(`POP with ID ${id} not found`);
    }

    if (pop.status !== 'PENDING') {
      throw new BadRequestException(`Cannot reject POP in ${pop.status} status. Must be PENDING.`);
    }

    const updated = await this.prisma.pOP.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectedBy: userId,
        rejectReason: dto.rejectReason,
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            originalName: true,
            mimeType: true,
            size: true,
          },
        },
        claim: {
          select: { id: true, code: true, status: true },
        },
      },
    });

    this.logger.log(`POP rejected: ${id} by user ${userId}`);

    return updated;
  }
}
