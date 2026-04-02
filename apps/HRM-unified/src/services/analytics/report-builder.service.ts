// src/services/analytics/report-builder.service.ts
// Custom Report Builder Service

import { db } from "@/lib/db";
import type {
  ReportExportFormat,
  ReportExportStatus,
} from ".prisma/hrm-unified-client";

export interface ReportColumn {
  field: string;
  label: string;
  type: "string" | "number" | "date" | "boolean" | "currency";
  format?: string;
  width?: number;
  sortable?: boolean;
  filterable?: boolean;
  aggregation?: "sum" | "avg" | "count" | "min" | "max";
  formula?: string;
}

export interface ReportFilter {
  field: string;
  operator:
    | "eq"
    | "neq"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "in"
    | "between";
  value: unknown;
  isParameter?: boolean;
  parameterLabel?: string;
}

export interface ReportGrouping {
  field: string;
  label: string;
  showSubtotals?: boolean;
}

export interface CreateReportInput {
  name: string;
  description?: string;
  category?: string;
  primarySource: string;
  joinedSources?: Array<{
    source: string;
    joinType: "inner" | "left" | "right";
    joinOn: { left: string; right: string };
  }>;
  columns: ReportColumn[];
  filters?: ReportFilter[];
  parameters?: Array<{
    name: string;
    label: string;
    type: "string" | "number" | "date" | "select";
    options?: Array<{ label: string; value: string }>;
    defaultValue?: unknown;
    required?: boolean;
  }>;
  sorting?: Array<{ field: string; direction: "asc" | "desc" }>;
  grouping?: ReportGrouping[];
  aggregations?: Array<{
    field: string;
    function: "sum" | "avg" | "count" | "min" | "max";
  }>;
  chartType?: string;
  chartConfig?: Record<string, unknown>;
  isPublic?: boolean;
  sharedWith?: string[];
  isScheduled?: boolean;
  schedule?: {
    frequency: "daily" | "weekly" | "monthly";
    time: string;
    dayOfWeek?: number;
    dayOfMonth?: number;
    timezone: string;
  };
  recipients?: string[];
}

export interface ReportRunOptions {
  parameters?: Record<string, unknown>;
  pagination?: { page: number; pageSize: number };
  exportFormat?: ReportExportFormat;
}

export interface ReportRunResult {
  reportId: string;
  reportName: string;
  columns: ReportColumn[];
  data: Record<string, unknown>[];
  totalRows: number;
  groupedData?: Record<string, unknown>[];
  aggregations?: Record<string, number>;
  executedAt: Date;
  executionTimeMs: number;
  parameters?: Record<string, unknown>;
}

const DATA_SOURCES: Record<
  string,
  {
    model: string;
    defaultIncludes: Record<string, unknown>;
    availableFields: string[];
  }
> = {
  employees: {
    model: "employee",
    defaultIncludes: { department: true, position: true, branch: true },
    availableFields: [
      "id",
      "employeeCode",
      "fullName",
      "workEmail",
      "phone",
      "gender",
      "dateOfBirth",
      "hireDate",
      "status",
      "department",
      "position",
      "branch",
    ],
  },
  attendance: {
    model: "attendance",
    defaultIncludes: { employee: { include: { department: true } } },
    availableFields: [
      "id",
      "date",
      "checkIn",
      "checkOut",
      "status",
      "workingHours",
      "employee",
      "department",
    ],
  },
  payroll: {
    model: "payroll",
    defaultIncludes: {
      employee: { include: { department: true } },
      period: true,
    },
    availableFields: [
      "id",
      "baseSalary",
      "grossSalary",
      "netSalary",
      "totalDeductions",
      "employee",
      "department",
      "period",
    ],
  },
  contracts: {
    model: "contract",
    defaultIncludes: { employee: { include: { department: true } } },
    availableFields: [
      "id",
      "contractNumber",
      "contractType",
      "startDate",
      "endDate",
      "baseSalary",
      "status",
      "employee",
      "department",
    ],
  },
  leave_requests: {
    model: "leaveRequest",
    defaultIncludes: {
      employee: { include: { department: true } },
      leavePolicy: true,
    },
    availableFields: [
      "id",
      "startDate",
      "endDate",
      "totalDays",
      "status",
      "reason",
      "employee",
      "department",
      "leaveType",
    ],
  },
  performance_reviews: {
    model: "performanceReview",
    defaultIncludes: {
      reviewee: { include: { department: true } },
      reviewer: true,
      cycle: true,
    },
    availableFields: [
      "id",
      "overallRating",
      "status",
      "reviewee",
      "reviewer",
      "department",
      "cycle",
    ],
  },
  goals: {
    model: "goal",
    defaultIncludes: { owner: { include: { department: true } } },
    availableFields: [
      "id",
      "title",
      "status",
      "progress",
      "dueDate",
      "owner",
      "department",
    ],
  },
  training: {
    model: "enrollment",
    defaultIncludes: {
      employee: { include: { department: true } },
      course: true,
    },
    availableFields: [
      "id",
      "status",
      "progress",
      "completedAt",
      "employee",
      "department",
      "course",
    ],
  },
  applications: {
    model: "application",
    defaultIncludes: {
      candidate: true,
      requisition: { include: { department: true } },
    },
    availableFields: [
      "id",
      "applicationCode",
      "status",
      "source",
      "candidate",
      "requisition",
      "department",
    ],
  },
};

export async function createReport(
  tenantId: string,
  userId: string,
  input: CreateReportInput,
) {
  const report = await db.customReport.create({
    data: {
      tenantId,
      userId,
      name: input.name,
      description: input.description,
      category: input.category,
      primarySource: input.primarySource,
      joinedSources: input.joinedSources as unknown as object | undefined,
      columns: input.columns as unknown as object,
      filters: input.filters as unknown as object | undefined,
      parameters: input.parameters as unknown as object | undefined,
      sorting: input.sorting as unknown as object | undefined,
      grouping: input.grouping as unknown as object | undefined,
      aggregations: input.aggregations as unknown as object | undefined,
      chartType: input.chartType,
      chartConfig: input.chartConfig as unknown as object | undefined,
      isPublic: input.isPublic ?? false,
      sharedWith: input.sharedWith as unknown as object | undefined,
      isScheduled: input.isScheduled ?? false,
      schedule: input.schedule as unknown as object | undefined,
      recipients: input.recipients as unknown as object | undefined,
    },
  });

  return report;
}

export async function updateReport(
  tenantId: string,
  reportId: string,
  userId: string,
  input: Partial<CreateReportInput>,
) {
  const existing = await db.customReport.findFirst({
    where: { id: reportId, tenantId },
  });

  if (!existing) {
    throw new Error("Report not found");
  }

  // Check if user owns the report or it's public
  if (existing.userId !== userId && !existing.isPublic) {
    throw new Error("Not authorized to update this report");
  }

  return db.customReport.update({
    where: { id: reportId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.primarySource !== undefined && {
        primarySource: input.primarySource,
      }),
      ...(input.joinedSources !== undefined && {
        joinedSources: input.joinedSources as unknown as object,
      }),
      ...(input.columns !== undefined && {
        columns: input.columns as unknown as object,
      }),
      ...(input.filters !== undefined && {
        filters: input.filters as unknown as object,
      }),
      ...(input.parameters !== undefined && {
        parameters: input.parameters as unknown as object,
      }),
      ...(input.sorting !== undefined && {
        sorting: input.sorting as unknown as object,
      }),
      ...(input.grouping !== undefined && {
        grouping: input.grouping as unknown as object,
      }),
      ...(input.aggregations !== undefined && {
        aggregations: input.aggregations as unknown as object,
      }),
      ...(input.chartType !== undefined && { chartType: input.chartType }),
      ...(input.chartConfig !== undefined && {
        chartConfig: input.chartConfig as unknown as object,
      }),
      ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
      ...(input.sharedWith !== undefined && {
        sharedWith: input.sharedWith as unknown as object,
      }),
      ...(input.isScheduled !== undefined && {
        isScheduled: input.isScheduled,
      }),
      ...(input.schedule !== undefined && {
        schedule: input.schedule as unknown as object,
      }),
      ...(input.recipients !== undefined && {
        recipients: input.recipients as unknown as object,
      }),
    },
  });
}

export async function deleteReport(
  tenantId: string,
  reportId: string,
  userId: string,
) {
  const existing = await db.customReport.findFirst({
    where: { id: reportId, tenantId },
  });

  if (!existing) {
    throw new Error("Report not found");
  }

  if (existing.userId !== userId) {
    throw new Error("Not authorized to delete this report");
  }

  await db.customReport.delete({ where: { id: reportId } });
}

export async function listReports(
  tenantId: string,
  userId: string,
  options: {
    category?: string;
    onlyMine?: boolean;
    includeShared?: boolean;
  } = {},
) {
  const where: Record<string, unknown> = { tenantId };

  if (options.onlyMine) {
    where.userId = userId;
  } else if (options.includeShared) {
    where.OR = [
      { userId },
      { isPublic: true },
      { sharedWith: { array_contains: [userId] } },
    ];
  }

  if (options.category) {
    where.category = options.category;
  }

  return db.customReport.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true } },
      _count: { select: { exports: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getReportById(
  tenantId: string,
  reportId: string,
  userId: string,
) {
  const report = await db.customReport.findFirst({
    where: { id: reportId, tenantId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!report) return null;

  // Check access
  if (report.userId !== userId && !report.isPublic) {
    const sharedWith = report.sharedWith as string[] | null;
    if (!sharedWith?.includes(userId)) {
      throw new Error("Not authorized to view this report");
    }
  }

  return report;
}

export async function runReport(
  tenantId: string,
  reportId: string,
  options: ReportRunOptions = {},
): Promise<ReportRunResult> {
  const startTime = Date.now();

  const report = await db.customReport.findFirst({
    where: { id: reportId, tenantId },
  });

  if (!report) {
    throw new Error("Report not found");
  }

  const sourceConfig = DATA_SOURCES[report.primarySource];
  if (!sourceConfig) {
    throw new Error(`Unknown data source: ${report.primarySource}`);
  }

  const columns = report.columns as unknown as ReportColumn[];
  const filters = report.filters as unknown as ReportFilter[] | null;
  const sorting = report.sorting as unknown as Array<{
    field: string;
    direction: "asc" | "desc";
  }> | null;
  const grouping = report.grouping as unknown as ReportGrouping[] | null;
  const aggregations = report.aggregations as unknown as Array<{
    field: string;
    function: string;
  }> | null;

  // Build where clause
  const where: Record<string, unknown> = {};

  // Apply tenant filter based on data source
  switch (report.primarySource) {
    case "employees":
    case "contracts":
    case "leave_requests":
    case "goals":
    case "applications":
      where.tenantId = tenantId;
      break;
    case "attendance":
    case "payroll":
    case "performance_reviews":
    case "training":
      where.employee = { tenantId, deletedAt: null };
      break;
  }

  // Apply filters
  if (filters) {
    for (const filter of filters) {
      const value = filter.isParameter
        ? (options.parameters?.[filter.field] ?? filter.value)
        : filter.value;

      if (value !== undefined && value !== null) {
        switch (filter.operator) {
          case "eq":
            where[filter.field] = value;
            break;
          case "neq":
            where[filter.field] = { not: value };
            break;
          case "gt":
            where[filter.field] = { gt: value };
            break;
          case "gte":
            where[filter.field] = { gte: value };
            break;
          case "lt":
            where[filter.field] = { lt: value };
            break;
          case "lte":
            where[filter.field] = { lte: value };
            break;
          case "contains":
            where[filter.field] = { contains: value, mode: "insensitive" };
            break;
          case "in":
            where[filter.field] = { in: value };
            break;
          case "between":
            if (Array.isArray(value) && value.length === 2) {
              where[filter.field] = { gte: value[0], lte: value[1] };
            }
            break;
        }
      }
    }
  }

  // Build orderBy
  const orderBy: Record<string, string> = {};
  if (sorting && sorting.length > 0) {
    orderBy[sorting[0].field] = sorting[0].direction;
  }

  // Execute query
  const modelName = sourceConfig.model as
    | "employee"
    | "attendance"
    | "payroll"
    | "contract"
    | "leaveRequest"
    | "performanceReview"
    | "goal"
    | "enrollment"
    | "application";

  // @ts-expect-error Dynamic model access
  const rawData = await db[modelName].findMany({
    where,
    include: sourceConfig.defaultIncludes,
    orderBy: Object.keys(orderBy).length > 0 ? orderBy : undefined,
    ...(options.pagination && {
      skip: (options.pagination.page - 1) * options.pagination.pageSize,
      take: options.pagination.pageSize,
    }),
    ...(!options.pagination && { take: 10000 }),
  });

  // Transform data to match columns
  const data = rawData.map((row: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const col of columns) {
      const value = getNestedValue(row, col.field);
      result[col.field] = formatValue(value, col.type, col.format);
    }
    return result;
  });

  // Calculate aggregations
  let calculatedAggregations: Record<string, number> | undefined;
  if (aggregations && aggregations.length > 0) {
    calculatedAggregations = {};
    for (const agg of aggregations) {
      const values = data.map(
        (row: Record<string, unknown>) => Number(row[agg.field]) || 0,
      );
      switch (agg.function) {
        case "sum":
          calculatedAggregations[`${agg.field}_sum`] = values.reduce(
            (a: number, b: number) => a + b,
            0,
          );
          break;
        case "avg":
          calculatedAggregations[`${agg.field}_avg`] =
            values.length > 0
              ? values.reduce((a: number, b: number) => a + b, 0) /
                values.length
              : 0;
          break;
        case "count":
          calculatedAggregations[`${agg.field}_count`] = values.length;
          break;
        case "min":
          calculatedAggregations[`${agg.field}_min`] = Math.min(...values);
          break;
        case "max":
          calculatedAggregations[`${agg.field}_max`] = Math.max(...values);
          break;
      }
    }
  }

  // Group data if grouping is specified
  let groupedData: Record<string, unknown>[] | undefined;
  if (grouping && grouping.length > 0) {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of data) {
      const groupKey = grouping
        .map((g) => String(row[g.field] || ""))
        .join("|");
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(row);
    }

    groupedData = Array.from(groups.entries()).map(([key, rows]) => {
      const groupValues = key.split("|");
      const groupRow: Record<string, unknown> = {};
      grouping.forEach((g, i) => {
        groupRow[g.field] = groupValues[i];
      });
      groupRow._rows = rows;
      groupRow._count = rows.length;
      return groupRow;
    });
  }

  // Update last run time
  await db.customReport.update({
    where: { id: reportId },
    data: { lastRunAt: new Date() },
  });

  return {
    reportId: report.id,
    reportName: report.name,
    columns,
    data,
    totalRows: data.length,
    groupedData,
    aggregations: calculatedAggregations,
    executedAt: new Date(),
    executionTimeMs: Date.now() - startTime,
    parameters: options.parameters,
  };
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let value: unknown = obj;
  for (const part of parts) {
    if (value === null || value === undefined) return null;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function formatValue(value: unknown, type: string, format?: string): unknown {
  if (value === null || value === undefined) return null;

  switch (type) {
    case "date":
      if (value instanceof Date) {
        return format
          ? formatDate(value, format)
          : value.toISOString().split("T")[0];
      }
      return value;
    case "currency":
      if (typeof value === "number") {
        return new Intl.NumberFormat("vi-VN", {
          style: "currency",
          currency: "VND",
        }).format(value);
      }
      return value;
    case "number":
      if (typeof value === "number") {
        return format ? value.toFixed(parseInt(format) || 0) : value;
      }
      return value;
    default:
      return value;
  }
}

function formatDate(date: Date, format: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return format
    .replace("YYYY", String(year))
    .replace("MM", month)
    .replace("DD", day);
}

export async function exportReport(
  tenantId: string,
  reportId: string,
  userId: string,
  format: ReportExportFormat,
  parameters?: Record<string, unknown>,
) {
  const report = await db.customReport.findFirst({
    where: { id: reportId, tenantId },
  });

  if (!report) {
    throw new Error("Report not found");
  }

  // Create export record
  const exportRecord = await db.reportExport.create({
    data: {
      tenantId,
      reportId,
      userId,
      format,
      fileName: `${report.name}_${new Date().toISOString().split("T")[0]}.${format.toLowerCase()}`,
      status: "PENDING",
      parameters: parameters as unknown as object | undefined,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  // In a real implementation, this would queue a background job
  // For now, we'll mark it as processing
  await db.reportExport.update({
    where: { id: exportRecord.id },
    data: { status: "PROCESSING" },
  });

  // Simulate export completion
  setTimeout(async () => {
    try {
      await db.reportExport.update({
        where: { id: exportRecord.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          fileUrl: `/exports/${exportRecord.id}.${format.toLowerCase()}`,
          fileSize: Math.floor(Math.random() * 1000000) + 10000,
        },
      });
    } catch {
      // Export failed
    }
  }, 2000);

  return exportRecord;
}

export async function getExports(
  tenantId: string,
  userId: string,
  reportId?: string,
) {
  return db.reportExport.findMany({
    where: {
      tenantId,
      userId,
      ...(reportId && { reportId }),
    },
    include: {
      report: { select: { id: true, name: true } },
    },
    orderBy: { requestedAt: "desc" },
    take: 50,
  });
}

export async function getAvailableDataSources() {
  return Object.entries(DATA_SOURCES).map(([key, config]) => ({
    id: key,
    name: getDataSourceDisplayName(key),
    availableFields: config.availableFields,
  }));
}

function getDataSourceDisplayName(source: string): string {
  const names: Record<string, string> = {
    employees: "Nhân viên",
    attendance: "Chấm công",
    payroll: "Bảng lương",
    contracts: "Hợp đồng",
    leave_requests: "Nghỉ phép",
    performance_reviews: "Đánh giá hiệu suất",
    goals: "Mục tiêu",
    training: "Đào tạo",
    applications: "Ứng viên",
  };
  return names[source] || source;
}

export const reportBuilderService = {
  createReport,
  updateReport,
  deleteReport,
  listReports,
  getReportById,
  runReport,
  exportReport,
  getExports,
  getAvailableDataSources,
};
