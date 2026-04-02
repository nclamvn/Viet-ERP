// src/lib/database/connection-pool.ts

/**
 * LAC VIET HR - Database Connection Pool
 * Optimized Prisma client with connection pooling and query logging
 */

import { PrismaClient, Prisma } from ".prisma/hrm-unified-client";

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export interface DatabaseConfig {
  url: string;
  maxConnections?: number;
  minConnections?: number;
  connectionTimeout?: number;
  idleTimeout?: number;
  queryTimeout?: number;
  logQueries?: boolean;
  logSlowQueries?: number; // ms threshold
}

export interface QueryMetrics {
  query: string;
  duration: number;
  timestamp: Date;
  params?: unknown;
}

// ════════════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: DatabaseConfig = {
  url: process.env.DATABASE_URL || "",
  maxConnections: parseInt(process.env.DATABASE_MAX_CONNECTIONS || "20"),
  minConnections: parseInt(process.env.DATABASE_MIN_CONNECTIONS || "5"),
  connectionTimeout: 10000, // 10 seconds
  idleTimeout: 60000, // 1 minute
  queryTimeout: 30000, // 30 seconds
  logQueries: process.env.NODE_ENV === "development",
  logSlowQueries: 500, // Log queries > 500ms
};

// ════════════════════════════════════════════════════════════════════════════════
// QUERY METRICS COLLECTOR
// ════════════════════════════════════════════════════════════════════════════════

class QueryMetricsCollector {
  private metrics: QueryMetrics[] = [];
  private maxMetrics: number = 1000;

  add(metric: QueryMetrics): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }
  }

  getSlowQueries(thresholdMs: number = 500): QueryMetrics[] {
    return this.metrics.filter((m) => m.duration >= thresholdMs);
  }

  getAverageQueryTime(): number {
    if (this.metrics.length === 0) return 0;
    const total = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    return total / this.metrics.length;
  }

  getQueryCount(): number {
    return this.metrics.length;
  }

  clear(): void {
    this.metrics = [];
  }

  getStats(): {
    totalQueries: number;
    avgDuration: number;
    slowQueries: number;
    p95Duration: number;
  } {
    if (this.metrics.length === 0) {
      return {
        totalQueries: 0,
        avgDuration: 0,
        slowQueries: 0,
        p95Duration: 0,
      };
    }

    const durations = this.metrics.map((m) => m.duration).sort((a, b) => a - b);
    const p95Index = Math.floor(durations.length * 0.95);

    return {
      totalQueries: this.metrics.length,
      avgDuration: Math.round(this.getAverageQueryTime()),
      slowQueries: this.getSlowQueries().length,
      p95Duration: durations[p95Index] || 0,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// EXTENDED PRISMA CLIENT
// ════════════════════════════════════════════════════════════════════════════════

export class DatabasePool {
  private static instance: DatabasePool;
  private prisma: PrismaClient;
  private config: DatabaseConfig;
  private metricsCollector: QueryMetricsCollector;
  private isConnected: boolean = false;

  private constructor(config: Partial<DatabaseConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metricsCollector = new QueryMetricsCollector();
    this.prisma = this.createPrismaClient();
  }

  static getInstance(config?: Partial<DatabaseConfig>): DatabasePool {
    if (!DatabasePool.instance) {
      DatabasePool.instance = new DatabasePool(config);
    }
    return DatabasePool.instance;
  }

  private createPrismaClient(): PrismaClient {
    const logConfig: Prisma.PrismaClientOptions["log"] = [];

    if (this.config.logQueries) {
      logConfig.push({ emit: "event", level: "query" });
    }
    logConfig.push({ emit: "event", level: "error" });
    logConfig.push({ emit: "event", level: "warn" });

    // Build connection URL with pooling parameters
    const connectionUrl = this.buildConnectionUrl();

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: connectionUrl,
        },
      },
      log: logConfig,
    });

    // Setup query logging
    this.setupQueryLogging(prisma);

    return prisma;
  }

  private buildConnectionUrl(): string {
    try {
      const url = new URL(this.config.url);

      // Add connection pool parameters
      url.searchParams.set(
        "connection_limit",
        this.config.maxConnections!.toString(),
      );
      url.searchParams.set(
        "pool_timeout",
        Math.floor(this.config.connectionTimeout! / 1000).toString(),
      );
      url.searchParams.set(
        "connect_timeout",
        Math.floor(this.config.connectionTimeout! / 1000).toString(),
      );

      // For serverless environments
      if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
        url.searchParams.set("pgbouncer", "true");
        url.searchParams.set("connection_limit", "1");
      }

      return url.toString();
    } catch {
      // If URL parsing fails, return the original URL
      return this.config.url;
    }
  }

  private setupQueryLogging(prisma: PrismaClient): void {
    // @ts-ignore - Prisma event types
    prisma.$on(
      "query",
      (e: { query: string; params: string; duration: number }) => {
        const metric: QueryMetrics = {
          query: e.query,
          duration: e.duration,
          timestamp: new Date(),
          params: e.params,
        };

        this.metricsCollector.add(metric);

        // Log slow queries
        if (e.duration >= this.config.logSlowQueries!) {
          console.warn(
            `[DB SLOW QUERY] ${e.duration}ms: ${e.query.substring(0, 100)}...`,
          );
        }
      },
    );

    // @ts-ignore
    prisma.$on("error", (e: { message: string }) => {
      console.error("[DB ERROR]", e.message);
    });

    // @ts-ignore
    prisma.$on("warn", (e: { message: string }) => {
      console.warn("[DB WARN]", e.message);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONNECTION MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      await this.prisma.$connect();
      this.isConnected = true;
    } catch (error) {
      console.error("[Database] Connection failed:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    await this.prisma.$disconnect();
    this.isConnected = false;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PRISMA CLIENT ACCESS
  // ─────────────────────────────────────────────────────────────────────────────

  getClient(): PrismaClient {
    return this.prisma;
  }

  // Convenience method for transactions
  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T> {
    return this.prisma.$transaction(fn, {
      maxWait: options?.maxWait || 5000,
      timeout: options?.timeout || this.config.queryTimeout,
      isolationLevel:
        options?.isolationLevel ||
        Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }

  // Raw query with timeout
  async rawQuery<T>(sql: string, params?: unknown[]): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await this.prisma.$queryRawUnsafe<T>(
        sql,
        ...(params || []),
      );

      const duration = Date.now() - startTime;
      this.metricsCollector.add({
        query: sql,
        duration,
        timestamp: new Date(),
        params,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[DB] Query failed after ${duration}ms:`, error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // METRICS
  // ─────────────────────────────────────────────────────────────────────────────

  getMetrics(): ReturnType<QueryMetricsCollector["getStats"]> {
    return this.metricsCollector.getStats();
  }

  getSlowQueries(thresholdMs?: number): QueryMetrics[] {
    return this.metricsCollector.getSlowQueries(thresholdMs);
  }

  clearMetrics(): void {
    this.metricsCollector.clear();
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PRISMA CLIENT EXTENSION WITH CACHING
// ════════════════════════════════════════════════════════════════════════════════

export function createPrismaClientWithCache(cacheManager: any) {
  const pool = DatabasePool.getInstance();
  const prisma = pool.getClient();

  return prisma.$extends({
    query: {
      $allModels: {
        async findUnique({ model, operation, args, query }) {
          const cacheKey = `${model}:${JSON.stringify(args.where)}`;

          // Try cache first
          const cached = await cacheManager.get(cacheKey);
          if (cached.hit) {
            return cached.value;
          }

          // Query database
          const result = await query(args);

          // Cache result
          if (result) {
            await cacheManager.set(cacheKey, result, { ttl: 300 });
          }

          return result;
        },
      },
    },
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

export function getDatabasePool(): DatabasePool {
  return DatabasePool.getInstance();
}

export function getPrismaClient(): PrismaClient {
  return DatabasePool.getInstance().getClient();
}

// Global Prisma instance for convenience
declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma || DatabasePool.getInstance().getClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export default DatabasePool;
