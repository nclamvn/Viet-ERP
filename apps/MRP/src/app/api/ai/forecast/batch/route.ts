// =============================================================================
// AI FORECAST - BATCH OPERATIONS API ROUTE
// POST /api/ai/forecast/batch - Run batch forecast operations
// GET /api/ai/forecast/batch - Get batch job status
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/with-auth";
import { Prisma } from ".prisma/mrp-client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  getForecastEngine,
  getAIEnhancerService,
  getAccuracyTrackerService,
  ForecastConfig,
  ForecastResult,
} from "@/lib/ai/forecast";

import { checkHeavyEndpointLimit } from "@/lib/rate-limit";

const batchBodySchema = z.object({
  action: z.enum(["generate", "enhance", "sync-actuals", "cleanup", "analyze"]),
  productIds: z.array(z.string()).optional(),
  config: z.any().optional(),
  periodType: z.enum(["weekly", "monthly"]).optional(),
  options: z
    .object({
      skipExisting: z.boolean().optional(),
      maxProducts: z.number().optional(),
      daysToKeep: z.number().optional(),
      category: z.string().optional(),
      months: z.number().optional(),
    })
    .optional(),
});
// =============================================================================
// TYPES
// =============================================================================

interface BatchRequest {
  action: "generate" | "enhance" | "sync-actuals" | "cleanup" | "analyze";
  productIds?: string[];
  config?: Partial<ForecastConfig>;
  periodType?: "weekly" | "monthly";
  options?: {
    skipExisting?: boolean;
    maxProducts?: number;
    daysToKeep?: number;
    category?: string;
  };
}

interface BatchResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  latency?: number;
}

interface BatchJobResult {
  jobId: string;
  action: string;
  status: "running" | "completed" | "failed";
  progress: {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  };
  startTime: Date;
  endTime?: Date;
  results?: unknown[];
  errors?: string[];
}

// In-memory job storage (in production, use Redis or database)
const batchJobs = new Map<string, BatchJobResult>();

// =============================================================================
// RATE LIMITING FOR BATCH OPERATIONS
// =============================================================================

const batchRateLimitMap = new Map<
  string,
  { count: number; resetTime: number }
>();
const BATCH_RATE_LIMIT = 5; // Max 5 batch operations per window
const BATCH_RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 minutes

function checkBatchRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = batchRateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    batchRateLimitMap.set(ip, {
      count: 1,
      resetTime: now + BATCH_RATE_LIMIT_WINDOW,
    });
    return true;
  }

  if (record.count >= BATCH_RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

// =============================================================================
// POST - Run Batch Forecast Operation
// =============================================================================

export const POST = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkHeavyEndpointLimit(request);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.retryAfter || 60),
          "X-RateLimit-Limit": String(rateLimitResult.limit),
          "X-RateLimit-Remaining": String(rateLimitResult.remaining),
        },
      },
    );
  }

  const startTime = Date.now();

  try {
    // Rate limiting
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    if (!checkBatchRateLimit(ip)) {
      return NextResponse.json(
        {
          success: false,
          error: "Batch rate limit exceeded. Max 5 operations per 5 minutes.",
        },
        { status: 429 },
      );
    }

    const rawBody = await request.json();
    const parseResult = batchBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input",
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }
    const {
      action,
      productIds,
      config = {},
      periodType = "monthly",
      options = {},
    } = parseResult.data;

    const forecastEngine = getForecastEngine();
    const aiEnhancer = getAIEnhancerService();
    const accuracyTracker = getAccuracyTrackerService();

    // Generate job ID
    const jobId = `batch_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    let result: unknown;

    switch (action) {
      case "generate": {
        // Batch generate forecasts
        let targetProducts: string[];

        if (productIds && productIds.length > 0) {
          targetProducts = productIds;
        } else {
          // Get all finished goods products
          const products = await prisma.part.findMany({
            where: {
              partType: "FINISHED_GOOD",
              ...(options.category ? { category: options.category } : {}),
            },
            select: { id: true },
            take: options.maxProducts || 1000,
          });
          targetProducts = products.map((p) => p.id);
        }

        // Initialize job
        const job: BatchJobResult = {
          jobId,
          action: "generate",
          status: "running",
          progress: {
            total: targetProducts.length,
            processed: 0,
            succeeded: 0,
            failed: 0,
          },
          startTime: new Date(),
          results: [],
          errors: [],
        };
        batchJobs.set(jobId, job);

        // Process in batches
        const batchSize = 10;
        const successResults: ForecastResult[] = [];
        const failedProducts: string[] = [];

        for (let i = 0; i < targetProducts.length; i += batchSize) {
          const batch = targetProducts.slice(i, i + batchSize);

          await Promise.all(
            batch.map(async (productId) => {
              try {
                // Skip if exists and skipExisting is true
                if (options.skipExisting) {
                  const existing = await prisma.demandForecast.findFirst({
                    where: {
                      productId: productId,
                      createdAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
                      },
                    },
                  });
                  if (existing) {
                    job.progress.processed++;
                    job.progress.succeeded++;
                    return;
                  }
                }

                const forecast = await forecastEngine.generateForecast(
                  productId,
                  {
                    ...config,
                    periodType,
                  },
                );

                if (forecast) {
                  await forecastEngine.saveForecast(forecast);
                  successResults.push(forecast);
                  job.progress.succeeded++;
                } else {
                  failedProducts.push(productId);
                  job.progress.failed++;
                  job.errors?.push(
                    `Insufficient data for product ${productId}`,
                  );
                }
              } catch (err) {
                failedProducts.push(productId);
                job.progress.failed++;
                job.errors?.push(
                  `Error for ${productId}: ${err instanceof Error ? err.message : "Unknown error"}`,
                );
              }
              job.progress.processed++;
            }),
          );
        }

        job.status = "completed";
        job.endTime = new Date();
        job.results = successResults.map((f) => ({
          productId: f.productId,
          productName: f.productName,
          model: f.model,
          metrics: f.metrics,
        }));

        result = {
          jobId,
          success: job.progress.succeeded,
          failed: job.progress.failed,
          total: job.progress.total,
          duration: Date.now() - startTime,
          message: `Generated ${job.progress.succeeded}/${job.progress.total} forecasts`,
        };
        break;
      }

      case "enhance": {
        // Batch enhance existing forecasts with AI
        if (!productIds || productIds.length === 0) {
          return NextResponse.json(
            { success: false, error: "productIds required for enhance action" },
            { status: 400 },
          );
        }

        const enhancedResults: unknown[] = [];
        const errors: string[] = [];

        for (const productId of productIds.slice(
          0,
          options.maxProducts || 50,
        )) {
          try {
            const forecast = await forecastEngine.generateForecast(productId, {
              ...config,
              periodType,
            });

            if (forecast) {
              const enhanced = await aiEnhancer.enhanceForecast(forecast);
              await forecastEngine.saveForecast(forecast);
              enhancedResults.push({
                productId,
                productName: forecast.productName,
                hasInsights: !!enhanced.aiInsights,
                hasRisks: !!enhanced.riskAssessment,
              });
            }
          } catch (err) {
            errors.push(
              `Error for ${productId}: ${err instanceof Error ? err.message : "Unknown"}`,
            );
          }
        }

        result = {
          enhanced: enhancedResults.length,
          failed: errors.length,
          results: enhancedResults,
          errors: errors.length > 0 ? errors : undefined,
        };
        break;
      }

      case "sync-actuals": {
        // Sync actual sales data for accuracy tracking
        const months =
          ((options as Record<string, unknown>).months as number) || 3;
        const syncResult = await accuracyTracker.autoRecordActuals(
          periodType,
          Math.min(months, 12),
        );

        result = {
          ...syncResult,
          message: `Synced ${syncResult.periodsProcessed} periods, updated ${syncResult.recordsUpdated} records`,
        };
        break;
      }

      case "cleanup": {
        // Clean up old forecast records
        const daysToKeep = options.daysToKeep || 90;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        const whereClause: Prisma.DemandForecastWhereInput = {
          createdAt: { lt: cutoffDate },
        };

        if (productIds && productIds.length > 0) {
          whereClause.productId = { in: productIds };
        }

        const deleted = await prisma.demandForecast.deleteMany({
          where: whereClause,
        });

        result = {
          deletedCount: deleted.count,
          cutoffDate: cutoffDate.toISOString(),
          daysToKeep,
          message: `Deleted ${deleted.count} forecast records older than ${daysToKeep} days`,
        };
        break;
      }

      case "analyze": {
        // Analyze forecast performance across products
        const summary = await accuracyTracker.getAccuracySummary();
        const modelPerformance = await accuracyTracker.getModelPerformance();

        // Get top and bottom performers
        const products = await prisma.part.findMany({
          where: { partType: "FINISHED_GOOD" },
          select: { id: true, partNumber: true, name: true },
          take: 100,
        });

        const productAccuracies: {
          productId: string;
          partNumber: string;
          name: string;
          mape?: number;
        }[] = [];

        for (const product of products) {
          const accuracy = await accuracyTracker.getProductAccuracy(
            product.id,
            periodType,
          );
          if (accuracy && accuracy.metrics) {
            productAccuracies.push({
              productId: product.id,
              partNumber: product.partNumber,
              name: product.name,
              mape: accuracy.metrics.mape,
            });
          }
        }

        // Sort by MAPE
        productAccuracies.sort((a, b) => (a.mape || 100) - (b.mape || 100));

        result = {
          summary,
          modelPerformance,
          topPerformers: productAccuracies.slice(0, 10),
          bottomPerformers: productAccuracies.slice(-10).reverse(),
          analyzedProducts: productAccuracies.length,
        };
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }

    return NextResponse.json({
      success: true,
      data: result,
      latency: Date.now() - startTime,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "POST /api/ai/forecast/batch",
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to process batch forecast operation",
        latency: Date.now() - startTime,
      },
      { status: 500 },
    );
  }
});

// =============================================================================
// GET - Get Batch Job Status
// =============================================================================

export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkHeavyEndpointLimit(request);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.retryAfter || 60),
          "X-RateLimit-Limit": String(rateLimitResult.limit),
          "X-RateLimit-Remaining": String(rateLimitResult.remaining),
        },
      },
    );
  }

  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    const action = searchParams.get("action") || "status";

    switch (action) {
      case "status": {
        if (!jobId) {
          // Return list of all jobs
          const jobs = Array.from(batchJobs.values()).map((job) => ({
            jobId: job.jobId,
            action: job.action,
            status: job.status,
            progress: job.progress,
            startTime: job.startTime,
            endTime: job.endTime,
          }));

          return NextResponse.json({
            success: true,
            data: { jobs, count: jobs.length },
            latency: Date.now() - startTime,
          });
        }

        const job = batchJobs.get(jobId);
        if (!job) {
          return NextResponse.json(
            { success: false, error: "Job not found" },
            { status: 404 },
          );
        }

        return NextResponse.json({
          success: true,
          data: job,
          latency: Date.now() - startTime,
        });
      }

      case "summary": {
        // Get summary of all forecasts in system
        const [totalForecasts, recentForecasts, productCount] =
          await Promise.all([
            prisma.demandForecast.count(),
            prisma.demandForecast.count({
              where: {
                createdAt: {
                  gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
                },
              },
            }),
            prisma.part.count({
              where: { partType: "FINISHED_GOOD" },
            }),
          ]);

        // Get forecasts by model
        const forecastsByModel = await prisma.demandForecast.groupBy({
          by: ["model"],
          _count: true,
        });

        return NextResponse.json({
          success: true,
          data: {
            totalForecasts,
            recentForecasts,
            productCount,
            forecastsByModel: forecastsByModel.map((m) => ({
              model: m.model,
              count: m._count,
            })),
            activeJobs: Array.from(batchJobs.values()).filter(
              (j) => j.status === "running",
            ).length,
          },
          latency: Date.now() - startTime,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/ai/forecast/batch",
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch batch job data",
        latency: Date.now() - startTime,
      },
      { status: 500 },
    );
  }
});

// =============================================================================
// DELETE - Cancel/Clear Batch Jobs
// =============================================================================

export const DELETE = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkHeavyEndpointLimit(request);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.retryAfter || 60),
          "X-RateLimit-Limit": String(rateLimitResult.limit),
          "X-RateLimit-Remaining": String(rateLimitResult.remaining),
        },
      },
    );
  }

  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    const scope = searchParams.get("scope") || "single";

    if (scope === "all") {
      // Clear all completed jobs
      const completedJobs = Array.from(batchJobs.entries()).filter(
        ([, job]) => job.status !== "running",
      );

      for (const [id] of completedJobs) {
        batchJobs.delete(id);
      }

      return NextResponse.json({
        success: true,
        data: {
          cleared: completedJobs.length,
          message: `Cleared ${completedJobs.length} completed batch jobs`,
        },
        latency: Date.now() - startTime,
      });
    }

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: "jobId is required" },
        { status: 400 },
      );
    }

    const job = batchJobs.get(jobId);
    if (!job) {
      return NextResponse.json(
        { success: false, error: "Job not found" },
        { status: 404 },
      );
    }

    if (job.status === "running") {
      // Mark as cancelled (actual cancellation logic would need more implementation)
      job.status = "failed";
      job.endTime = new Date();
      job.errors?.push("Job cancelled by user");
    }

    batchJobs.delete(jobId);

    return NextResponse.json({
      success: true,
      data: {
        jobId,
        message: "Job removed",
      },
      latency: Date.now() - startTime,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "DELETE /api/ai/forecast/batch",
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to delete batch job",
        latency: Date.now() - startTime,
      },
      { status: 500 },
    );
  }
});
