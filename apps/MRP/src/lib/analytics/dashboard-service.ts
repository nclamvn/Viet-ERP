// =============================================================================
// VietERP MRP - DASHBOARD SERVICE
// Service for dashboard CRUD operations and management
// =============================================================================

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { Prisma } from ".prisma/mrp-client";
import type {
  Dashboard,
  DashboardWidget,
  DashboardLayout,
  DashboardCreateInput,
  DashboardUpdateInput,
  DashboardTemplate,
  WidgetQueryConfig,
  WidgetDisplayConfig,
  DrillDownConfig,
  WidgetType,
  DataSource,
} from "./types";
import type { UserRole } from "@/lib/roles";
import {
  getRoleDashboardConfig,
  canAccessTemplate,
  hasPermission,
  getDefaultTemplateForRole,
  getAllowedTemplatesForRole,
  canCreateMoreDashboards,
  type RoleDashboardConfig,
} from "./role-dashboard-mapping";

// =============================================================================
// DEFAULT CONFIGURATIONS
// =============================================================================

export const DEFAULT_LAYOUT: DashboardLayout = {
  columns: 12,
  rowHeight: 100,
  margin: [16, 16],
  containerPadding: [16, 16],
  compactType: "vertical",
};

export const DEFAULT_WIDGET_DISPLAY: WidgetDisplayConfig = {
  showLegend: true,
  legendPosition: "bottom",
  showGrid: true,
  showLabels: true,
  showValues: true,
  showTrend: true,
  formatter: "number",
  locale: "vi-VN",
  animation: true,
};

// =============================================================================
// DASHBOARD TEMPLATES
// =============================================================================

export const DASHBOARD_TEMPLATES: Omit<
  DashboardTemplate,
  "id" | "usageCount"
>[] = [
  {
    name: "Executive Overview",
    nameVi: "Tổng quan điều hành",
    description: "High-level KPIs and trends for executive leadership",
    category: "executive",
    layout: DEFAULT_LAYOUT,
    widgets: [
      {
        widgetType: "kpi",
        title: "Revenue MTD",
        titleVi: "Doanh thu tháng",
        dataSource: "sales",
        metric: "REVENUE_MTD",
        queryConfig: {},
        displayConfig: { formatter: "currency", showTrend: true },
        gridX: 0,
        gridY: 0,
        gridW: 3,
        gridH: 2,
      },
      {
        widgetType: "kpi",
        title: "On-Time Delivery",
        titleVi: "Giao đúng hạn",
        dataSource: "production",
        metric: "ON_TIME_DELIVERY",
        queryConfig: {},
        displayConfig: { formatter: "percent", showTrend: true },
        gridX: 3,
        gridY: 0,
        gridW: 3,
        gridH: 2,
      },
      {
        widgetType: "kpi",
        title: "First Pass Yield",
        titleVi: "Tỷ lệ đạt lần đầu",
        dataSource: "quality",
        metric: "FIRST_PASS_YIELD",
        queryConfig: {},
        displayConfig: { formatter: "percent", showTrend: true },
        gridX: 6,
        gridY: 0,
        gridW: 3,
        gridH: 2,
      },
      {
        widgetType: "kpi",
        title: "Inventory Value",
        titleVi: "Giá trị tồn kho",
        dataSource: "inventory",
        metric: "INV_VALUE",
        queryConfig: {},
        displayConfig: { formatter: "currency", showTrend: true },
        gridX: 9,
        gridY: 0,
        gridW: 3,
        gridH: 2,
      },
      {
        widgetType: "chart-line",
        title: "Revenue Trend",
        titleVi: "Xu hướng doanh thu",
        dataSource: "sales",
        queryConfig: { groupBy: ["month"], metrics: ["revenue"] },
        displayConfig: { colors: ["#4F46E5"], curved: true },
        gridX: 0,
        gridY: 2,
        gridW: 6,
        gridH: 4,
      },
      {
        widgetType: "chart-pie",
        title: "Sales by Category",
        titleVi: "Doanh thu theo danh mục",
        dataSource: "sales",
        queryConfig: { groupBy: ["category"], metrics: ["revenue"] },
        displayConfig: { showLegend: true, legendPosition: "right" },
        gridX: 6,
        gridY: 2,
        gridW: 6,
        gridH: 4,
      },
    ],
    isActive: true,
    isDefault: true,
  },
  {
    name: "Operations Dashboard",
    nameVi: "Bảng điều khiển vận hành",
    description: "Real-time production and operations metrics",
    category: "operations",
    layout: DEFAULT_LAYOUT,
    widgets: [
      {
        widgetType: "kpi",
        title: "Active Work Orders",
        titleVi: "Lệnh SX đang chạy",
        dataSource: "production",
        metric: "ACTIVE_WORK_ORDERS",
        queryConfig: {},
        displayConfig: { formatter: "number" },
        gridX: 0,
        gridY: 0,
        gridW: 3,
        gridH: 2,
        refreshInterval: 60,
      },
      {
        widgetType: "kpi",
        title: "Production Efficiency",
        titleVi: "Hiệu suất sản xuất",
        dataSource: "production",
        metric: "PRODUCTION_EFFICIENCY",
        queryConfig: {},
        displayConfig: { formatter: "percent" },
        gridX: 3,
        gridY: 0,
        gridW: 3,
        gridH: 2,
        refreshInterval: 300,
      },
      {
        widgetType: "kpi",
        title: "Low Stock Items",
        titleVi: "Vật tư sắp hết",
        dataSource: "inventory",
        metric: "INV_LOW_STOCK",
        queryConfig: {},
        displayConfig: { formatter: "number" },
        gridX: 6,
        gridY: 0,
        gridW: 3,
        gridH: 2,
        refreshInterval: 300,
      },
      {
        widgetType: "kpi",
        title: "Open NCRs",
        titleVi: "NCR đang mở",
        dataSource: "quality",
        metric: "OPEN_NCRS",
        queryConfig: {},
        displayConfig: { formatter: "number" },
        gridX: 9,
        gridY: 0,
        gridW: 3,
        gridH: 2,
        refreshInterval: 300,
      },
      {
        widgetType: "chart-bar",
        title: "Work Orders by Status",
        titleVi: "Lệnh SX theo trạng thái",
        dataSource: "production",
        queryConfig: { groupBy: ["status"], metrics: ["count"] },
        displayConfig: { colors: ["#10B981", "#F59E0B", "#EF4444", "#6366F1"] },
        gridX: 0,
        gridY: 2,
        gridW: 6,
        gridH: 4,
      },
      {
        widgetType: "table",
        title: "Active Work Orders",
        titleVi: "Danh sách lệnh SX",
        dataSource: "production",
        queryConfig: {
          filters: [
            {
              field: "status",
              operator: "in",
              value: ["IN_PROGRESS", "RELEASED"],
            },
          ],
          limit: 10,
        },
        displayConfig: {},
        gridX: 6,
        gridY: 2,
        gridW: 6,
        gridH: 4,
      },
    ],
    isActive: true,
    isDefault: false,
  },
  {
    name: "Quality Dashboard",
    nameVi: "Bảng điều khiển chất lượng",
    description: "Quality metrics and NCR/CAPA tracking",
    category: "quality",
    layout: DEFAULT_LAYOUT,
    widgets: [
      {
        widgetType: "kpi",
        title: "First Pass Yield",
        titleVi: "Tỷ lệ đạt lần đầu",
        dataSource: "quality",
        metric: "FIRST_PASS_YIELD",
        queryConfig: {},
        displayConfig: { formatter: "percent", showTrend: true },
        gridX: 0,
        gridY: 0,
        gridW: 4,
        gridH: 2,
      },
      {
        widgetType: "kpi",
        title: "Defect Rate",
        titleVi: "Tỷ lệ lỗi",
        dataSource: "quality",
        metric: "DEFECT_RATE",
        queryConfig: {},
        displayConfig: { formatter: "percent", showTrend: true },
        gridX: 4,
        gridY: 0,
        gridW: 4,
        gridH: 2,
      },
      {
        widgetType: "kpi",
        title: "Open CAPAs",
        titleVi: "CAPA đang mở",
        dataSource: "quality",
        metric: "OPEN_CAPAS",
        queryConfig: {},
        displayConfig: { formatter: "number" },
        gridX: 8,
        gridY: 0,
        gridW: 4,
        gridH: 2,
      },
      {
        widgetType: "chart-line",
        title: "Quality Trend",
        titleVi: "Xu hướng chất lượng",
        dataSource: "quality",
        queryConfig: {
          groupBy: ["month"],
          metrics: ["firstPassYield", "defectRate"],
        },
        displayConfig: { colors: ["#10B981", "#EF4444"], curved: true },
        gridX: 0,
        gridY: 2,
        gridW: 8,
        gridH: 4,
      },
      {
        widgetType: "chart-pie",
        title: "NCRs by Category",
        titleVi: "NCR theo loại",
        dataSource: "quality",
        queryConfig: { groupBy: ["defectCategory"], metrics: ["count"] },
        displayConfig: { showLegend: true },
        gridX: 8,
        gridY: 2,
        gridW: 4,
        gridH: 4,
      },
    ],
    isActive: true,
    isDefault: false,
  },
];

// =============================================================================
// DASHBOARD SERVICE CLASS
// =============================================================================

class DashboardService {
  // ---------------------------------------------------------------------------
  // Dashboard CRUD
  // ---------------------------------------------------------------------------

  async createDashboard(
    userId: string,
    data: DashboardCreateInput,
  ): Promise<Dashboard> {
    const layout = { ...DEFAULT_LAYOUT, ...data.layout };

    // If this is set as default, unset other defaults first
    if (data.isDefault) {
      await prisma.analyticsDashboard.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const dashboard = await prisma.analyticsDashboard.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        layout: layout as unknown as Prisma.InputJsonValue,
        isPublic: data.isPublic ?? false,
        isDefault: data.isDefault ?? false,
      },
      include: { widgets: true },
    });

    return this.toDashboard(dashboard);
  }

  async getDashboard(id: string): Promise<Dashboard | null> {
    const dashboard = await prisma.analyticsDashboard.findUnique({
      where: { id },
      include: { widgets: true },
    });

    if (!dashboard) return null;

    // Increment view count
    await prisma.analyticsDashboard.update({
      where: { id },
      data: {
        viewCount: { increment: 1 },
        lastViewedAt: new Date(),
      },
    });

    return this.toDashboard(dashboard);
  }

  async getUserDashboards(userId: string): Promise<Dashboard[]> {
    const dashboards = await prisma.analyticsDashboard.findMany({
      where: {
        OR: [{ userId }, { isPublic: true }],
      },
      include: { widgets: true },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });

    return dashboards.map((d) => this.toDashboard(d));
  }

  async updateDashboard(
    id: string,
    data: DashboardUpdateInput,
  ): Promise<Dashboard> {
    // If setting as default, unset other defaults first
    if (data.isDefault) {
      const dashboard = await prisma.analyticsDashboard.findUnique({
        where: { id },
      });
      if (dashboard) {
        await prisma.analyticsDashboard.updateMany({
          where: { userId: dashboard.userId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
    }

    const updated = await prisma.analyticsDashboard.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        layout: data.layout as unknown as Prisma.InputJsonValue,
        isPublic: data.isPublic,
        isDefault: data.isDefault,
      },
      include: { widgets: true },
    });

    return this.toDashboard(updated);
  }

  async deleteDashboard(id: string): Promise<void> {
    await prisma.analyticsDashboard.delete({ where: { id } });
  }

  async getDefaultDashboard(userId: string): Promise<Dashboard | null> {
    const dashboard = await prisma.analyticsDashboard.findFirst({
      where: { userId, isDefault: true },
      include: { widgets: true },
    });

    if (!dashboard) {
      // Fall back to first dashboard
      const first = await prisma.analyticsDashboard.findFirst({
        where: { userId },
        include: { widgets: true },
        orderBy: { createdAt: "asc" },
      });
      return first ? this.toDashboard(first) : null;
    }

    return this.toDashboard(dashboard);
  }

  // ---------------------------------------------------------------------------
  // Widget Management
  // ---------------------------------------------------------------------------

  async addWidget(
    dashboardId: string,
    widget: Omit<DashboardWidget, "id" | "dashboardId">,
  ): Promise<DashboardWidget> {
    const created = await prisma.dashboardWidget.create({
      data: {
        dashboardId,
        widgetType: widget.widgetType,
        title: widget.title,
        titleVi: widget.titleVi,
        dataSource: widget.dataSource,
        metric: widget.metric,
        queryConfig: widget.queryConfig as unknown as Prisma.InputJsonValue,
        displayConfig: {
          ...DEFAULT_WIDGET_DISPLAY,
          ...widget.displayConfig,
        } as unknown as Prisma.InputJsonValue,
        gridX: widget.gridX,
        gridY: widget.gridY,
        gridW: widget.gridW,
        gridH: widget.gridH,
        refreshInterval: widget.refreshInterval,
        drillDownConfig:
          widget.drillDownConfig as unknown as Prisma.InputJsonValue,
      },
    });

    return this.toWidget(created);
  }

  async updateWidget(
    id: string,
    data: Partial<DashboardWidget>,
  ): Promise<DashboardWidget> {
    const updated = await prisma.dashboardWidget.update({
      where: { id },
      data: {
        widgetType: data.widgetType,
        title: data.title,
        titleVi: data.titleVi,
        dataSource: data.dataSource,
        metric: data.metric,
        queryConfig: data.queryConfig as unknown as Prisma.InputJsonValue,
        displayConfig: data.displayConfig as unknown as Prisma.InputJsonValue,
        gridX: data.gridX,
        gridY: data.gridY,
        gridW: data.gridW,
        gridH: data.gridH,
        refreshInterval: data.refreshInterval,
        drillDownConfig:
          data.drillDownConfig as unknown as Prisma.InputJsonValue,
      },
    });

    return this.toWidget(updated);
  }

  async removeWidget(id: string): Promise<void> {
    await prisma.dashboardWidget.delete({ where: { id } });
  }

  async updateWidgetPositions(
    updates: {
      id: string;
      gridX: number;
      gridY: number;
      gridW: number;
      gridH: number;
    }[],
  ): Promise<void> {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.dashboardWidget.update({
          where: { id: u.id },
          data: {
            gridX: u.gridX,
            gridY: u.gridY,
            gridW: u.gridW,
            gridH: u.gridH,
          },
        }),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Template Management
  // ---------------------------------------------------------------------------

  async getTemplates(category?: string): Promise<DashboardTemplate[]> {
    const where = category ? { category, isActive: true } : { isActive: true };

    const templates = await prisma.dashboardTemplate.findMany({
      where,
      orderBy: [{ isDefault: "desc" }, { usageCount: "desc" }],
    });

    return templates.map((t) => this.toTemplate(t));
  }

  async createFromTemplate(
    userId: string,
    templateId: string,
    name?: string,
  ): Promise<Dashboard> {
    const template = await prisma.dashboardTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new Error("Template not found");
    }

    // Increment usage count
    await prisma.dashboardTemplate.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    });

    // Create dashboard from template
    const dashboard = await this.createDashboard(userId, {
      name: name || template.name,
      description: template.description || undefined,
      layout: template.layout as unknown as DashboardLayout,
    });

    // Add widgets from template
    const templateWidgets = template.widgets as unknown as Omit<
      DashboardWidget,
      "id" | "dashboardId"
    >[];
    for (const widget of templateWidgets) {
      await this.addWidget(dashboard.id, widget);
    }

    // Return the complete dashboard
    return this.getDashboard(dashboard.id) as Promise<Dashboard>;
  }

  async seedTemplates(): Promise<void> {
    for (const template of DASHBOARD_TEMPLATES) {
      await prisma.dashboardTemplate.upsert({
        where: {
          id: `template-${template.category}-default`,
        },
        update: {
          name: template.name,
          nameVi: template.nameVi,
          description: template.description,
          category: template.category,
          layout: template.layout as unknown as Prisma.InputJsonValue,
          widgets: template.widgets as unknown as Prisma.InputJsonValue,
          isActive: template.isActive,
          isDefault: template.isDefault,
        },
        create: {
          id: `template-${template.category}-default`,
          name: template.name,
          nameVi: template.nameVi,
          description: template.description,
          category: template.category,
          layout: template.layout as unknown as Prisma.InputJsonValue,
          widgets: template.widgets as unknown as Prisma.InputJsonValue,
          isActive: template.isActive,
          isDefault: template.isDefault,
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Role-Based Dashboard Access
  // ---------------------------------------------------------------------------

  /**
   * Get the default dashboard for a user based on their role
   * If no dashboard exists, auto-provision one from the role's default template
   */
  async getDefaultDashboardForRole(
    userId: string,
    userRole: UserRole,
  ): Promise<Dashboard | null> {
    // First try to get existing default dashboard
    const existingDefault = await this.getDefaultDashboard(userId);
    if (existingDefault) {
      return existingDefault;
    }

    // Auto-provision from role's default template
    return this.autoProvisionDashboard(userId, userRole);
  }

  /**
   * Auto-provision a dashboard for a user based on their role's default template
   */
  async autoProvisionDashboard(
    userId: string,
    userRole: UserRole,
  ): Promise<Dashboard | null> {
    const config = getRoleDashboardConfig(userRole);
    const defaultTemplateId = config.defaultTemplate;

    // Check if template exists
    const template = await prisma.dashboardTemplate.findUnique({
      where: { id: defaultTemplateId },
    });

    if (!template) {
      // Seed templates if not exists
      await this.seedTemplates();
    }

    try {
      const dashboard = await this.createFromTemplate(
        userId,
        defaultTemplateId,
      );
      // Set as default
      await this.updateDashboard(dashboard.id, { isDefault: true });
      return this.getDashboard(dashboard.id);
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "dashboard-service", operation: "autoProvision" },
      );
      return null;
    }
  }

  /**
   * Check if a user with given role can access a specific template
   */
  canUserAccessTemplate(userRole: UserRole, templateId: string): boolean {
    return canAccessTemplate(userRole, templateId);
  }

  /**
   * Get permissions for a user's role
   */
  getUserPermissions(userRole: UserRole): RoleDashboardConfig["permissions"] {
    const config = getRoleDashboardConfig(userRole);
    return config.permissions;
  }

  /**
   * Get all features available for a user's role
   */
  getUserFeatures(userRole: UserRole): RoleDashboardConfig["features"] {
    const config = getRoleDashboardConfig(userRole);
    return config.features;
  }

  /**
   * Get templates filtered by user's role
   */
  async getTemplatesForRole(
    userRole: UserRole,
    category?: string,
  ): Promise<DashboardTemplate[]> {
    const allowedTemplates = getAllowedTemplatesForRole(userRole);

    const where: Prisma.DashboardTemplateWhereInput = {
      isActive: true,
      id: { in: allowedTemplates },
    };

    if (category) {
      where.category = category;
    }

    const templates = await prisma.dashboardTemplate.findMany({
      where,
      orderBy: [{ isDefault: "desc" }, { usageCount: "desc" }],
    });

    return templates.map((t) => this.toTemplate(t));
  }

  /**
   * Check if a user can create more dashboards based on their role limits
   */
  async canUserCreateDashboard(
    userId: string,
    userRole: UserRole,
  ): Promise<boolean> {
    const config = getRoleDashboardConfig(userRole);

    if (!config.permissions.canCreate) {
      return false;
    }

    if (config.maxDashboards === -1) {
      return true; // Unlimited
    }

    const currentCount = await prisma.analyticsDashboard.count({
      where: { userId },
    });

    return canCreateMoreDashboards(userRole, currentCount);
  }

  /**
   * Validate dashboard action based on role permissions
   */
  validateRolePermission(
    userRole: UserRole,
    action: "create" | "edit" | "delete" | "share" | "viewAll",
  ): boolean {
    const permissionMap = {
      create: "canCreate",
      edit: "canEdit",
      delete: "canDelete",
      share: "canShare",
      viewAll: "canViewAll",
    } as const;

    return hasPermission(userRole, permissionMap[action]);
  }

  /**
   * Get dashboards with role-based filtering
   */
  async getUserDashboardsWithRole(
    userId: string,
    userRole: UserRole,
  ): Promise<Dashboard[]> {
    const config = getRoleDashboardConfig(userRole);

    let dashboards: Dashboard[];

    if (config.permissions.canViewAll) {
      // Can view all public dashboards
      dashboards = await this.getUserDashboards(userId);
    } else {
      // Can only view own dashboards
      const ownDashboards = await prisma.analyticsDashboard.findMany({
        where: { userId },
        include: { widgets: true },
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      });
      dashboards = ownDashboards.map((d) => this.toDashboard(d));
    }

    return dashboards;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private toDashboard(
    data: Prisma.AnalyticsDashboardGetPayload<{ include: { widgets: true } }>,
  ): Dashboard {
    return {
      id: data.id,
      userId: data.userId,
      name: data.name,
      description: data.description ?? undefined,
      layout: data.layout as unknown as DashboardLayout,
      isPublic: data.isPublic,
      isDefault: data.isDefault,
      viewCount: data.viewCount,
      lastViewedAt: data.lastViewedAt ?? undefined,
      widgets: (data.widgets || []).map((w) => this.toWidget(w)),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }

  private toWidget(
    data: Prisma.DashboardWidgetGetPayload<Record<string, never>>,
  ): DashboardWidget {
    return {
      id: data.id,
      dashboardId: data.dashboardId,
      widgetType: data.widgetType as WidgetType,
      title: data.title,
      titleVi: data.titleVi ?? undefined,
      dataSource: data.dataSource as DataSource,
      metric: data.metric ?? undefined,
      queryConfig: data.queryConfig as WidgetQueryConfig,
      displayConfig: data.displayConfig as WidgetDisplayConfig,
      gridX: data.gridX,
      gridY: data.gridY,
      gridW: data.gridW,
      gridH: data.gridH,
      refreshInterval: data.refreshInterval ?? undefined,
      drillDownConfig: data.drillDownConfig as unknown as
        | DrillDownConfig
        | undefined,
    };
  }

  private toTemplate(
    data: Prisma.DashboardTemplateGetPayload<Record<string, never>>,
  ): DashboardTemplate {
    return {
      id: data.id,
      name: data.name,
      nameVi: data.nameVi ?? undefined,
      description: data.description ?? undefined,
      category: data.category,
      thumbnail: data.thumbnail ?? undefined,
      layout: data.layout as unknown as DashboardLayout,
      widgets: data.widgets as unknown as Omit<
        DashboardWidget,
        "id" | "dashboardId"
      >[],
      isActive: data.isActive,
      isDefault: data.isDefault,
      usageCount: data.usageCount,
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const dashboardService = new DashboardService();
export default dashboardService;
