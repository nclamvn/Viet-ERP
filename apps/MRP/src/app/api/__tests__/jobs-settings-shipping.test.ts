/**
 * Jobs, Settings (Feature Flags), Setup, Shipping Backorders,
 * and Warehouse Receipts API Route Tests
 */

import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks - must be declared before importing route handlers
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    productionReceipt: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    systemSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
  prisma: {
    productionReceipt: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    systemSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkReadEndpointLimit: vi.fn().mockResolvedValue(null),
  checkWriteEndpointLimit: vi.fn().mockResolvedValue(null),
  checkHeavyEndpointLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    logError: vi.fn(),
  },
}));

vi.mock("@/lib/jobs/job-queue", () => {
  const mockJobQueue = {
    getAllJobs: vi.fn(),
    getJobsByStatus: vi.fn(),
    getStats: vi.fn(),
    add: vi.fn(),
    getJob: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(),
  };
  return {
    jobQueue: mockJobQueue,
    JOB_NAMES: {
      EXCEL_IMPORT: "excel:import",
      EXCEL_EXPORT: "excel:export",
      MRP_CALCULATION: "mrp:calculate",
      REPORT_GENERATION: "report:generate",
      CACHE_WARMING: "cache:warm",
      EMAIL_SEND: "email:send",
      DATA_SYNC: "data:sync",
      CLEANUP: "system:cleanup",
    },
  };
});

vi.mock("@/lib/jobs/handlers", () => ({}));

vi.mock("@/lib/features/feature-flags", () => ({
  FEATURE_FLAGS: {
    USE_WIP_WAREHOUSE: "use_wip_warehouse",
    USE_FG_WAREHOUSE: "use_fg_warehouse",
    USE_SHIP_WAREHOUSE: "use_ship_warehouse",
  },
  getAllFeatureFlags: vi.fn(),
  setFeatureFlag: vi.fn(),
}));

vi.mock("@/lib/shipping/backorder-service", () => ({
  detectBackorders: vi.fn(),
  processBackorders: vi.fn(),
  getBackorderSummary: vi.fn(),
}));

vi.mock("@/lib/error-handler", () => ({
  handleError: vi
    .fn()
    .mockReturnValue(
      new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
      }),
    ),
}));

vi.mock("@/lib/pagination", () => ({
  parsePaginationParams: vi.fn().mockReturnValue({
    page: 1,
    pageSize: 20,
    sortBy: undefined,
    sortOrder: "desc",
  }),
  buildOffsetPaginationQuery: vi.fn().mockReturnValue({ skip: 0, take: 20 }),
  buildPaginatedResponse: vi
    .fn()
    .mockImplementation((data, total, params, startTime) => ({
      data,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / params.pageSize),
        hasNextPage: false,
        hasPrevPage: false,
      },
      meta: { took: Date.now() - startTime, cached: false },
    })),
  paginatedSuccess: vi.fn(),
}));

// Setup route uses its own PrismaClient - mock bcryptjs and .prisma/mrp-client
vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed-password"),
  },
}));

vi.mock(".prisma/mrp-client", async () => {
  const { vi: _vi } = await import("vitest");
  class MockPrismaClient {
    user = {
      count: _vi.fn().mockResolvedValue(0),
      create: _vi.fn().mockResolvedValue({}),
    };
    warehouse = {
      count: _vi.fn().mockResolvedValue(0),
      create: _vi.fn().mockResolvedValue({}),
    };
    $disconnect = _vi.fn().mockResolvedValue(undefined);
  }
  return { PrismaClient: MockPrismaClient, Prisma: {} };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { auth } from "@/lib/auth";
import { jobQueue } from "@/lib/jobs/job-queue";
import {
  getAllFeatureFlags,
  setFeatureFlag,
} from "@/lib/features/feature-flags";
import {
  detectBackorders,
  processBackorders,
  getBackorderSummary,
} from "@/lib/shipping/backorder-service";
import prisma from "@/lib/prisma";

import {
  GET as jobsGET,
  POST as jobsPOST,
  DELETE as jobsDELETE,
} from "../jobs/route";
import { GET as jobIdGET, DELETE as jobIdDELETE } from "../jobs/[id]/route";
import {
  GET as featureFlagsGET,
  PUT as featureFlagsPUT,
} from "../settings/feature-flags/route";
import { GET as setupGET } from "../setup/route";
import {
  GET as backordersGET,
  POST as backordersPOST,
} from "../shipping/backorders/route";
import { GET as warehouseReceiptsGET } from "../warehouse-receipts/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockContext = { params: Promise.resolve({}) };
const mockIdContext = (id: string) => ({ params: Promise.resolve({ id }) });
const adminSession = {
  user: { id: "user-1", name: "Admin", email: "admin@test.com", role: "admin" },
};
const viewerSession = {
  user: {
    id: "user-3",
    name: "Viewer",
    email: "viewer@test.com",
    role: "viewer",
  },
};

// ============================================================================
// JOBS API
// ============================================================================

describe("Jobs API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- GET /api/jobs ----------
  describe("GET /api/jobs", () => {
    it("should return all jobs and stats", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      const mockJobs = [
        {
          id: "j1",
          name: "excel:import",
          status: "completed",
          priority: 0,
          attempts: 1,
          progress: 100,
          createdAt: new Date(),
          startedAt: new Date(),
          completedAt: new Date(),
          error: null,
        },
      ];
      const mockStats = { pending: 0, running: 0, completed: 1, failed: 0 };
      vi.mocked(jobQueue.getAllJobs).mockReturnValue(mockJobs as any);
      vi.mocked(jobQueue.getStats).mockReturnValue(mockStats as any);

      const request = new NextRequest("http://localhost:3000/api/jobs");
      const response = await jobsGET(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.jobs).toHaveLength(1);
      expect(data.stats).toEqual(mockStats);
    });

    it("should filter jobs by status query param", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      vi.mocked(jobQueue.getJobsByStatus).mockReturnValue([]);
      vi.mocked(jobQueue.getStats).mockReturnValue({
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
      } as any);

      const request = new NextRequest(
        "http://localhost:3000/api/jobs?status=pending",
      );
      const response = await jobsGET(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(jobQueue.getJobsByStatus).toHaveBeenCalledWith("pending");
    });

    it("should return 401 when not authenticated", async () => {
      (auth as Mock).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/jobs");
      const response = await jobsGET(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  // ---------- POST /api/jobs ----------
  describe("POST /api/jobs", () => {
    it("should create a new job with valid name", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      const newJob = {
        id: "j2",
        name: "excel:import",
        status: "pending",
        priority: 0,
        createdAt: new Date(),
      };
      vi.mocked(jobQueue.add).mockReturnValue(newJob as any);

      const request = new NextRequest("http://localhost:3000/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          name: "excel:import",
          data: { file: "test.xlsx" },
        }),
      });
      const response = await jobsPOST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.job.name).toBe("excel:import");
    });

    it("should return 400 for invalid job name", async () => {
      (auth as Mock).mockResolvedValue(adminSession);

      const request = new NextRequest("http://localhost:3000/api/jobs", {
        method: "POST",
        body: JSON.stringify({ name: "nonexistent:job" }),
      });
      const response = await jobsPOST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid job name");
    });

    it("should return 400 for missing job name", async () => {
      (auth as Mock).mockResolvedValue(adminSession);

      const request = new NextRequest("http://localhost:3000/api/jobs", {
        method: "POST",
        body: JSON.stringify({ data: {} }),
      });
      const response = await jobsPOST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Validation failed");
    });
  });

  // ---------- GET /api/jobs/[id] ----------
  describe("GET /api/jobs/[id]", () => {
    it("should return job details by id", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      const mockJob = {
        id: "j1",
        name: "excel:import",
        status: "completed",
        progress: 100,
        attempts: 1,
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        error: null,
        result: { rowsImported: 50 },
      };
      vi.mocked(jobQueue.getJob).mockReturnValue(mockJob as any);

      const request = new NextRequest("http://localhost:3000/api/jobs/j1");
      const response = await jobIdGET(request, mockIdContext("j1"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe("j1");
      expect(data.status).toBe("completed");
      expect(data.result).toEqual({ rowsImported: 50 });
    });

    it("should return 404 when job not found", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      vi.mocked(jobQueue.getJob).mockReturnValue(undefined as any);

      const request = new NextRequest("http://localhost:3000/api/jobs/missing");
      const response = await jobIdGET(request, mockIdContext("missing"));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Job not found");
    });
  });

  // ---------- DELETE /api/jobs/[id] ----------
  describe("DELETE /api/jobs/[id]", () => {
    it("should cancel a pending job", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      vi.mocked(jobQueue.cancel).mockReturnValue(true);

      const request = new NextRequest("http://localhost:3000/api/jobs/j1", {
        method: "DELETE",
      });
      const response = await jobIdDELETE(request, mockIdContext("j1"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("should return 400 when job cannot be cancelled", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      vi.mocked(jobQueue.cancel).mockReturnValue(false);

      const request = new NextRequest("http://localhost:3000/api/jobs/j1", {
        method: "DELETE",
      });
      const response = await jobIdDELETE(request, mockIdContext("j1"));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("cannot be cancelled");
    });
  });
});

// ============================================================================
// FEATURE FLAGS API
// ============================================================================

describe("Feature Flags API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- GET /api/settings/feature-flags ----------
  describe("GET /api/settings/feature-flags", () => {
    it("should return all feature flags", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      const mockFlags = {
        use_wip_warehouse: true,
        use_fg_warehouse: false,
        use_ship_warehouse: true,
      };
      vi.mocked(getAllFeatureFlags).mockResolvedValue(mockFlags);

      const request = new NextRequest(
        "http://localhost:3000/api/settings/feature-flags",
      );
      const response = await featureFlagsGET(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.flags).toEqual(mockFlags);
    });

    it("should return 401 when not authenticated", async () => {
      (auth as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/settings/feature-flags",
      );
      const response = await featureFlagsGET(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 500 when getAllFeatureFlags throws", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      vi.mocked(getAllFeatureFlags).mockRejectedValue(new Error("DB error"));

      const request = new NextRequest(
        "http://localhost:3000/api/settings/feature-flags",
      );
      const response = await featureFlagsGET(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch feature flags");
    });
  });

  // ---------- PUT /api/settings/feature-flags ----------
  describe("PUT /api/settings/feature-flags", () => {
    it("should update a valid feature flag", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      vi.mocked(setFeatureFlag).mockResolvedValue(undefined);

      const request = new NextRequest(
        "http://localhost:3000/api/settings/feature-flags",
        {
          method: "PUT",
          body: JSON.stringify({ key: "use_wip_warehouse", value: "true" }),
        },
      );
      const response = await featureFlagsPUT(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.key).toBe("use_wip_warehouse");
      expect(data.value).toBe("true");
      expect(setFeatureFlag).toHaveBeenCalledWith(
        "use_wip_warehouse",
        true,
        "user-1",
      );
    });

    it("should return 400 for invalid flag key", async () => {
      (auth as Mock).mockResolvedValue(adminSession);

      const request = new NextRequest(
        "http://localhost:3000/api/settings/feature-flags",
        {
          method: "PUT",
          body: JSON.stringify({ key: "nonexistent_flag", value: "true" }),
        },
      );
      const response = await featureFlagsPUT(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid flag key");
    });

    it("should return 400 for missing value", async () => {
      (auth as Mock).mockResolvedValue(adminSession);

      const request = new NextRequest(
        "http://localhost:3000/api/settings/feature-flags",
        {
          method: "PUT",
          body: JSON.stringify({ key: "use_wip_warehouse" }),
        },
      );
      const response = await featureFlagsPUT(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Validation failed");
    });
  });
});

// ============================================================================
// SETUP API
// ============================================================================

describe("Setup API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/setup", () => {
    it("should handle setup request successfully", async () => {
      // Set required env var for setup
      process.env.SEED_ADMIN_PASSWORD = "TestPassword123!@#";

      // The setup route creates its own PrismaClient at module level.
      // Our class-based mock is instantiated once when the module loads.
      // The mock defaults to count=0, so it will attempt to create an admin user.
      const request = new NextRequest("http://localhost:3000/api/setup");
      const response = await setupGET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      delete process.env.SEED_ADMIN_PASSWORD;
    });

    it("should return 500 when SEED_ADMIN_PASSWORD is not set", async () => {
      delete process.env.SEED_ADMIN_PASSWORD;

      const request = new NextRequest("http://localhost:3000/api/setup");
      const response = await setupGET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("SEED_ADMIN_PASSWORD");
    });
  });
});

// ============================================================================
// SHIPPING BACKORDERS API
// ============================================================================

describe("Shipping Backorders API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/shipping/backorders", () => {
    it("should return backorders and summary", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      const mockBackorders = [
        { id: "bo1", orderNumber: "SO-001", item: "Widget", qty: 10 },
      ];
      const mockSummary = { totalBackorders: 1, totalValue: 500 };
      vi.mocked(detectBackorders).mockResolvedValue(mockBackorders as any);
      vi.mocked(getBackorderSummary).mockResolvedValue(mockSummary as any);

      const request = new NextRequest(
        "http://localhost:3000/api/shipping/backorders",
      );
      const response = await backordersGET(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toEqual(mockBackorders);
      expect(data.summary).toEqual(mockSummary);
    });

    it("should return 401 when not authenticated", async () => {
      (auth as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/shipping/backorders",
      );
      const response = await backordersGET(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 500 when detectBackorders throws", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      vi.mocked(detectBackorders).mockRejectedValue(new Error("service error"));

      const request = new NextRequest(
        "http://localhost:3000/api/shipping/backorders",
      );
      const response = await backordersGET(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch backorders");
    });
  });

  // ---------- POST /api/shipping/backorders ----------
  describe("POST /api/shipping/backorders", () => {
    it("should process backorders successfully", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      const mockResult = { processed: 3, created: 2 };
      vi.mocked(processBackorders).mockResolvedValue(mockResult as any);

      const request = new NextRequest(
        "http://localhost:3000/api/shipping/backorders",
        { method: "POST" },
      );
      const response = await backordersPOST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockResult);
      expect(processBackorders).toHaveBeenCalledWith("user-1");
    });

    it("should return 500 when processing fails", async () => {
      (auth as Mock).mockResolvedValue(adminSession);
      vi.mocked(processBackorders).mockRejectedValue(
        new Error("process error"),
      );

      const request = new NextRequest(
        "http://localhost:3000/api/shipping/backorders",
        { method: "POST" },
      );
      const response = await backordersPOST(request, mockContext);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process backorders");
    });
  });
});

// ============================================================================
// WAREHOUSE RECEIPTS API
// ============================================================================

describe("Warehouse Receipts API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/warehouse-receipts", () => {
    it("should return paginated warehouse receipts", async () => {
      // warehouse-receipts uses a different withAuth from @/lib/auth/middleware
      // which checks permissions. We mock auth to return a session with admin role.
      (auth as Mock).mockResolvedValue({
        user: {
          id: "user-1",
          email: "admin@test.com",
          name: "Admin",
          role: "admin",
        },
      });

      const mockReceipts = [
        {
          id: "wr1",
          status: "PENDING",
          workOrder: {
            woNumber: "WO-001",
            status: "COMPLETED",
            completedQty: 100,
          },
          product: { id: "p1", sku: "SKU-001", name: "Widget A" },
          warehouse: { id: "w1", code: "WH-MAIN", name: "Main Warehouse" },
        },
      ];

      vi.mocked(prisma.productionReceipt.count).mockResolvedValue(1);
      vi.mocked(prisma.productionReceipt.findMany).mockResolvedValue(
        mockReceipts as any,
      );

      const request = new NextRequest(
        "http://localhost:3000/api/warehouse-receipts?status=PENDING",
      );
      const response = await warehouseReceiptsGET(request, {
        params: {},
      } as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
    });

    it("should return 401 when not authenticated", async () => {
      (auth as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/warehouse-receipts",
      );
      const response = await warehouseReceiptsGET(request, {
        params: {},
      } as any);
      const data = await response.json();

      expect(response.status).toBe(401);
    });
  });
});
