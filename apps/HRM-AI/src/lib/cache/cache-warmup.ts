// src/lib/cache/cache-warmup.ts

/**
 * LAC VIET HR - Cache Warmup
 * Pre-warm cache with frequently accessed data
 */

import { getCacheManager, CacheManager, CacheTTL } from "./cache-manager";
import { CacheKeys } from "./cache-keys";
import { PrismaClient } from ".prisma/hrm-ai-client";

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export interface WarmupConfig {
  departments?: boolean;
  employees?: boolean;
  positions?: boolean;
  systemConfig?: boolean;
  statistics?: boolean;
  concurrency?: number;
}

export interface WarmupResult {
  success: boolean;
  duration: number;
  itemsWarmed: number;
  errors: string[];
}

// ════════════════════════════════════════════════════════════════════════════════
// CACHE WARMER CLASS
// ════════════════════════════════════════════════════════════════════════════════

export class CacheWarmer {
  private cache: CacheManager;
  private prisma: PrismaClient;
  private concurrency: number;

  constructor(
    prisma: PrismaClient,
    cache?: CacheManager,
    concurrency?: number,
  ) {
    this.prisma = prisma;
    this.cache = cache || getCacheManager();
    this.concurrency = concurrency || 5;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN WARMUP
  // ─────────────────────────────────────────────────────────────────────────────

  async warmup(config: WarmupConfig = {}): Promise<WarmupResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let itemsWarmed = 0;

    const tasks: Promise<number>[] = [];

    // Default all to true if no config provided
    const shouldWarm = {
      departments: config.departments ?? true,
      employees: config.employees ?? true,
      positions: config.positions ?? true,
      systemConfig: config.systemConfig ?? true,
      statistics: config.statistics ?? true,
    };

    if (shouldWarm.departments) {
      tasks.push(
        this.warmDepartments().catch((e) => {
          errors.push(`Departments: ${e.message}`);
          return 0;
        }),
      );
    }

    if (shouldWarm.positions) {
      tasks.push(
        this.warmPositions().catch((e) => {
          errors.push(`Positions: ${e.message}`);
          return 0;
        }),
      );
    }

    if (shouldWarm.systemConfig) {
      tasks.push(
        this.warmSystemConfig().catch((e) => {
          errors.push(`System Config: ${e.message}`);
          return 0;
        }),
      );
    }

    if (shouldWarm.statistics) {
      tasks.push(
        this.warmStatistics().catch((e) => {
          errors.push(`Statistics: ${e.message}`);
          return 0;
        }),
      );
    }

    // Wait for all warmup tasks
    const results = await Promise.all(tasks);
    itemsWarmed = results.reduce((sum, count) => sum + count, 0);

    // Employee warmup is more intensive, do it with controlled concurrency
    if (shouldWarm.employees) {
      try {
        itemsWarmed += await this.warmEmployees();
      } catch (e: any) {
        errors.push(`Employees: ${e.message}`);
      }
    }

    const duration = Date.now() - startTime;

    if (errors.length > 0) {
      console.warn("[CacheWarmer] Errors:", errors);
    }

    return {
      success: errors.length === 0,
      duration,
      itemsWarmed,
      errors,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DEPARTMENT WARMUP
  // ─────────────────────────────────────────────────────────────────────────────

  private async warmDepartments(): Promise<number> {
    // Fetch all departments
    const departments = await this.prisma.department.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });

    // Cache department list
    await this.cache.set(CacheKeys.department.list(), departments, {
      ttl: CacheTTL.LONG,
      tags: ["departments"],
    });

    // Cache department tree
    const tree = this.buildDepartmentTree(departments);
    await this.cache.set(CacheKeys.department.tree(), tree, {
      ttl: CacheTTL.LONG,
      tags: ["departments"],
    });

    // Cache individual departments
    for (const dept of departments) {
      await this.cache.set(CacheKeys.department.byId(dept.id), dept, {
        ttl: CacheTTL.LONG,
        tags: ["departments", `department:${dept.id}`],
      });
    }

    return departments.length + 2; // +2 for list and tree
  }

  private buildDepartmentTree(departments: any[]): any[] {
    const map = new Map<string, any>();
    const roots: any[] = [];

    // Create map
    departments.forEach((dept) => {
      map.set(dept.id, { ...dept, children: [] });
    });

    // Build tree
    departments.forEach((dept) => {
      const node = map.get(dept.id)!;
      if (dept.parentId && map.has(dept.parentId)) {
        map.get(dept.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // POSITION WARMUP
  // ─────────────────────────────────────────────────────────────────────────────

  private async warmPositions(): Promise<number> {
    const positions = await this.prisma.position.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });

    await this.cache.set("position:list", positions, {
      ttl: CacheTTL.VERY_LONG,
      tags: ["positions"],
    });

    for (const position of positions) {
      await this.cache.set(`position:${position.id}`, position, {
        ttl: CacheTTL.VERY_LONG,
        tags: ["positions", `position:${position.id}`],
      });
    }

    return positions.length + 1;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EMPLOYEE WARMUP (with pagination)
  // ─────────────────────────────────────────────────────────────────────────────

  private async warmEmployees(): Promise<number> {
    let warmed = 0;
    const pageSize = 100;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const employees = await this.prisma.employee.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          employeeCode: true,
          fullName: true,
          workEmail: true,
          departmentId: true,
          positionId: true,
          status: true,
          hireDate: true,
        },
        skip: page * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      });

      if (employees.length === 0) {
        hasMore = false;
        break;
      }

      // Cache employee list page
      await this.cache.set(
        `employee:list:page:${page + 1}:limit:${pageSize}`,
        employees,
        { ttl: CacheTTL.MEDIUM, tags: ["employees", "employee-list"] },
      );

      // Cache first few pages of employees individually
      if (page < 3) {
        await Promise.all(
          employees.map((emp) =>
            this.cache.set(CacheKeys.employee.byId(emp.id), emp, {
              ttl: CacheTTL.MEDIUM,
              tags: ["employees", `employee:${emp.id}`],
            }),
          ),
        );
      }

      warmed += employees.length;
      page++;

      if (employees.length < pageSize) {
        hasMore = false;
      }

      // Limit warmup to first 1000 employees
      if (page * pageSize >= 1000) {
        hasMore = false;
      }
    }

    // Cache employee count
    const count = await this.prisma.employee.count({
      where: { status: "ACTIVE" },
    });
    await this.cache.set(CacheKeys.employee.count(), count, {
      ttl: CacheTTL.MEDIUM,
      tags: ["employees"],
    });

    return warmed + 1;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SYSTEM CONFIG WARMUP
  // ─────────────────────────────────────────────────────────────────────────────

  private async warmSystemConfig(): Promise<number> {
    // Try to warm system settings if the table exists
    try {
      // This is a safe check - if the table doesn't exist, it will throw
      const settings = await (this.prisma as any).systemSetting?.findMany?.();

      if (settings && settings.length > 0) {
        const configMap = settings.reduce(
          (acc: Record<string, string>, s: any) => {
            acc[s.key] = s.value;
            return acc;
          },
          {},
        );

        await this.cache.set(CacheKeys.system.settings(), configMap, {
          ttl: CacheTTL.VERY_LONG,
          tags: ["config"],
        });

        return 1;
      }
    } catch {
      // Settings table might not exist - this is fine
    }

    return 0;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STATISTICS WARMUP
  // ─────────────────────────────────────────────────────────────────────────────

  private async warmStatistics(): Promise<number> {
    let warmed = 0;

    // Employee counts by department
    const deptCounts = await this.prisma.employee.groupBy({
      by: ["departmentId"],
      _count: true,
      where: { status: "ACTIVE" },
    });

    await this.cache.set("stats:employee-count-by-department", deptCounts, {
      ttl: CacheTTL.MEDIUM,
      tags: ["stats", "employees"],
    });
    warmed++;

    // Employee counts by position
    const posCounts = await this.prisma.employee.groupBy({
      by: ["positionId"],
      _count: true,
      where: { status: "ACTIVE" },
    });

    await this.cache.set("stats:employee-count-by-position", posCounts, {
      ttl: CacheTTL.MEDIUM,
      tags: ["stats", "employees"],
    });
    warmed++;

    // Recent hires count (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentHires = await this.prisma.employee.count({
      where: {
        hireDate: { gte: thirtyDaysAgo },
        status: "ACTIVE",
      },
    });

    await this.cache.set("stats:recent-hires", recentHires, {
      ttl: CacheTTL.MEDIUM,
      tags: ["stats", "employees"],
    });
    warmed++;

    return warmed;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // WARMUP ON STARTUP
  // ─────────────────────────────────────────────────────────────────────────────

  static async warmupOnStartup(prisma: PrismaClient): Promise<WarmupResult> {
    const warmer = new CacheWarmer(prisma);
    return warmer.warmup();
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// STARTUP HOOK
// ════════════════════════════════════════════════════════════════════════════════

export async function initializeCacheWarmup(
  prisma: PrismaClient,
): Promise<void> {
  if (process.env.SKIP_CACHE_WARMUP === "true") {
    return;
  }

  try {
    const result = await CacheWarmer.warmupOnStartup(prisma);

    if (!result.success) {
      console.warn(
        "[CacheWarmer] Warmup completed with errors:",
        result.errors,
      );
    }
  } catch (error) {
    console.error("[CacheWarmer] Warmup failed:", error);
    // Don't throw - warmup failure shouldn't prevent app startup
  }
}

export default CacheWarmer;
