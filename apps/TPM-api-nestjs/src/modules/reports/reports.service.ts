import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateReportDto, ReportFormatEnum } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { ExecuteReportDto } from './dto/execute-report.dto';
import {
  PaginationDto,
  createPaginatedResponse,
  getPaginationParams,
} from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST REPORT DEFINITIONS (with pagination, filtering, sorting)
  // ═══════════════════════════════════════════════════════════════════════════
  async findAll(query: ReportQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      category,
      isTemplate,
      companyId,
      format,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const where: Prisma.ReportDefinitionWhereInput = {};

    if (category) {
      where.category = category;
    }

    if (isTemplate !== undefined) {
      where.isTemplate = isTemplate;
    }

    if (companyId) {
      where.companyId = companyId;
    }

    if (format) {
      where.defaultFormat = format;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { dataSource: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    const validSortFields = ['createdAt', 'name', 'category', 'dataSource', 'updatedAt'];
    const orderBy: Prisma.ReportDefinitionOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    // Execute query
    const [data, total] = await Promise.all([
      this.prisma.reportDefinition.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          company: {
            select: { id: true, name: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { schedules: true, executions: true },
          },
        },
      }),
      this.prisma.reportDefinition.count({ where }),
    ]);

    const transformedData = data.map((report) => this.transformReport(report));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SINGLE REPORT DEFINITION
  // ═══════════════════════════════════════════════════════════════════════════
  async findOne(id: string) {
    const report = await this.prisma.reportDefinition.findUnique({
      where: { id },
      include: {
        company: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        schedules: {
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: { schedules: true, executions: true },
        },
      },
    });

    if (!report) {
      throw new NotFoundException(`Report definition with ID ${id} not found`);
    }

    return this.transformReportDetail(report);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE REPORT DEFINITION
  // ═══════════════════════════════════════════════════════════════════════════
  async create(dto: CreateReportDto, userId: string) {
    // Validate company exists
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });
    if (!company) {
      throw new BadRequestException(`Company with ID ${dto.companyId} not found`);
    }

    const report = await this.prisma.reportDefinition.create({
      data: {
        name: dto.name,
        description: dto.description,
        category: dto.category,
        dataSource: dto.dataSource,
        columns: dto.columns as Prisma.InputJsonValue,
        filters: dto.filters as Prisma.InputJsonValue,
        groupBy: dto.groupBy || [],
        sortBy: dto.sortBy as Prisma.InputJsonValue,
        calculations: dto.calculations as Prisma.InputJsonValue,
        defaultFormat: dto.defaultFormat || 'EXCEL',
        isTemplate: dto.isTemplate || false,
        companyId: dto.companyId,
        createdById: userId,
      },
      include: {
        company: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    this.logger.log(`Report definition created: ${report.name} (${report.id}) by user ${userId}`);

    return this.transformReport(report);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE REPORT DEFINITION
  // ═══════════════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateReportDto) {
    const existing = await this.prisma.reportDefinition.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Report definition with ID ${id} not found`);
    }

    const updateData: Prisma.ReportDefinitionUpdateInput = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.category !== undefined) updateData.category = dto.category;
    if (dto.dataSource !== undefined) updateData.dataSource = dto.dataSource;
    if (dto.columns !== undefined) updateData.columns = dto.columns as Prisma.InputJsonValue;
    if (dto.filters !== undefined) updateData.filters = dto.filters as Prisma.InputJsonValue;
    if (dto.groupBy !== undefined) updateData.groupBy = dto.groupBy;
    if (dto.sortBy !== undefined) updateData.sortBy = dto.sortBy as Prisma.InputJsonValue;
    if (dto.calculations !== undefined)
      updateData.calculations = dto.calculations as Prisma.InputJsonValue;
    if (dto.defaultFormat !== undefined) updateData.defaultFormat = dto.defaultFormat;
    if (dto.isTemplate !== undefined) updateData.isTemplate = dto.isTemplate;

    const report = await this.prisma.reportDefinition.update({
      where: { id },
      data: updateData,
      include: {
        company: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { schedules: true, executions: true },
        },
      },
    });

    this.logger.log(`Report definition updated: ${report.name} (${report.id})`);

    return this.transformReport(report);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE REPORT DEFINITION (cascades to schedules and executions)
  // ═══════════════════════════════════════════════════════════════════════════
  async remove(id: string) {
    const report = await this.prisma.reportDefinition.findUnique({
      where: { id },
    });

    if (!report) {
      throw new NotFoundException(`Report definition with ID ${id} not found`);
    }

    await this.prisma.reportDefinition.delete({
      where: { id },
    });

    this.logger.log(`Report definition deleted: ${report.name} (${report.id})`);

    return { success: true, message: 'Report definition deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTE REPORT (trigger report generation)
  // ═══════════════════════════════════════════════════════════════════════════
  async executeReport(id: string, dto: ExecuteReportDto, userId: string) {
    const report = await this.prisma.reportDefinition.findUnique({
      where: { id },
    });

    if (!report) {
      throw new NotFoundException(`Report definition with ID ${id} not found`);
    }

    const format = dto.format || report.defaultFormat;
    const startedAt = new Date();

    // Create execution record with PENDING status
    const execution = await this.prisma.reportExecution.create({
      data: {
        reportId: id,
        format,
        filters: dto.filters as Prisma.InputJsonValue,
        parameters: dto.parameters as Prisma.InputJsonValue,
        status: 'PENDING',
        startedAt,
      },
    });

    // Simulate report generation (in production this would be async/queued)
    const completedAt = new Date();
    const mockRowCount = Math.floor(Math.random() * 5000) + 100;
    const mockFileSize = mockRowCount * 256; // ~256 bytes per row estimate
    const formatExtension = format === 'EXCEL' ? 'xlsx' : format.toLowerCase();
    const mockFileUrl = `/reports/generated/${execution.id}.${formatExtension}`;

    const completedExecution = await this.prisma.reportExecution.update({
      where: { id: execution.id },
      data: {
        status: 'COMPLETED',
        completedAt,
        fileUrl: mockFileUrl,
        fileSize: mockFileSize,
        rowCount: mockRowCount,
      },
    });

    this.logger.log(
      `Report executed: ${report.name} (${report.id}) → execution ${completedExecution.id} by user ${userId}`,
    );

    return {
      id: completedExecution.id,
      reportId: completedExecution.reportId,
      format: completedExecution.format,
      status: completedExecution.status,
      startedAt: completedExecution.startedAt,
      completedAt: completedExecution.completedAt,
      fileUrl: completedExecution.fileUrl,
      fileSize: completedExecution.fileSize,
      rowCount: completedExecution.rowCount,
      filters: completedExecution.filters,
      parameters: completedExecution.parameters,
      createdAt: completedExecution.createdAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE REPORT SCHEDULE
  // ═══════════════════════════════════════════════════════════════════════════
  async createSchedule(id: string, dto: CreateScheduleDto, userId: string) {
    const report = await this.prisma.reportDefinition.findUnique({
      where: { id },
    });

    if (!report) {
      throw new NotFoundException(`Report definition with ID ${id} not found`);
    }

    // Calculate nextRunAt based on frequency
    const nextRunAt = this.calculateNextRunAt(dto.frequency);

    const schedule = await this.prisma.reportSchedule.create({
      data: {
        reportId: id,
        frequency: dto.frequency,
        cronExpression: dto.cronExpression,
        format: dto.format || report.defaultFormat,
        recipients: dto.recipients || [],
        filters: dto.filters as Prisma.InputJsonValue,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
        nextRunAt,
        userId,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        report: {
          select: { id: true, name: true },
        },
      },
    });

    this.logger.log(
      `Report schedule created: ${schedule.id} for report ${report.name} (${report.id}) by user ${userId}`,
    );

    return schedule;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE REPORT SCHEDULE
  // ═══════════════════════════════════════════════════════════════════════════
  async deleteSchedule(reportId: string, scheduleId: string) {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: {
        id: scheduleId,
        reportId,
      },
    });

    if (!schedule) {
      throw new NotFoundException(
        `Report schedule with ID ${scheduleId} not found for report ${reportId}`,
      );
    }

    await this.prisma.reportSchedule.delete({
      where: { id: scheduleId },
    });

    this.logger.log(`Report schedule deleted: ${scheduleId} from report ${reportId}`);

    return { success: true, message: 'Report schedule deleted successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET EXECUTION HISTORY
  // ═══════════════════════════════════════════════════════════════════════════
  async getExecutions(reportId: string, query: PaginationDto) {
    // Validate report exists
    const report = await this.prisma.reportDefinition.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException(`Report definition with ID ${reportId} not found`);
    }

    const { skip, take, page, pageSize } = getPaginationParams(query);

    const where: Prisma.ReportExecutionWhereInput = {
      reportId,
    };

    const [data, total] = await Promise.all([
      this.prisma.reportExecution.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.reportExecution.count({ where }),
    ]);

    return createPaginatedResponse(data, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET DISTINCT CATEGORIES
  // ═══════════════════════════════════════════════════════════════════════════
  async getCategories() {
    const results = await this.prisma.reportDefinition.findMany({
      where: {
        category: { not: null },
      },
      select: {
        category: true,
      },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });

    const categories = results.map((r) => r.category).filter((c): c is string => c !== null);

    return { categories };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET AVAILABLE FORMATS
  // ═══════════════════════════════════════════════════════════════════════════
  getFormats() {
    return {
      formats: Object.values(ReportFormatEnum).map((value) => ({
        value,
        label: value === 'PDF' ? 'PDF' : value.charAt(0) + value.slice(1).toLowerCase(),
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Calculate next run date based on frequency
  // ═══════════════════════════════════════════════════════════════════════════
  private calculateNextRunAt(frequency: string): Date {
    const now = new Date();
    const next = new Date(now);

    switch (frequency) {
      case 'DAILY':
        next.setDate(next.getDate() + 1);
        next.setHours(8, 0, 0, 0); // 8:00 AM next day
        break;
      case 'WEEKLY':
        next.setDate(next.getDate() + (7 - next.getDay() + 1)); // Next Monday
        next.setHours(8, 0, 0, 0);
        break;
      case 'MONTHLY':
        next.setMonth(next.getMonth() + 1);
        next.setDate(1); // 1st of next month
        next.setHours(8, 0, 0, 0);
        break;
      case 'QUARTERLY':
        const currentQuarter = Math.floor(next.getMonth() / 3);
        next.setMonth((currentQuarter + 1) * 3); // First month of next quarter
        next.setDate(1);
        next.setHours(8, 0, 0, 0);
        break;
      case 'ON_DEMAND':
      default:
        // No automatic next run for on-demand
        break;
    }

    return next;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Report Definition for List Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformReport(report: any) {
    return {
      id: report.id,
      name: report.name,
      description: report.description,
      category: report.category,
      dataSource: report.dataSource,
      columns: report.columns,
      filters: report.filters,
      groupBy: report.groupBy,
      sortBy: report.sortBy,
      calculations: report.calculations,
      defaultFormat: report.defaultFormat,
      isTemplate: report.isTemplate,
      companyId: report.companyId,
      company: report.company || null,
      createdById: report.createdById,
      createdBy: report.createdBy || null,
      scheduleCount: report._count?.schedules || 0,
      executionCount: report._count?.executions || 0,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER: Transform Report Definition for Detail Response
  // ═══════════════════════════════════════════════════════════════════════════
  private transformReportDetail(report: any) {
    const base = this.transformReport(report);

    return {
      ...base,
      schedules: report.schedules || [],
      recentExecutions: report.executions || [],
    };
  }
}
