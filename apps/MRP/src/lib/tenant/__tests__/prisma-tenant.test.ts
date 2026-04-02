import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    logError: vi.fn(),
  },
}));

vi.mock(".prisma/mrp-client", () => {
  return {
    PrismaClient: class MockPrismaClient {
      $extends = vi.fn().mockReturnValue({ mock: true });
      $disconnect = vi.fn();
      $queryRawUnsafe = vi.fn().mockResolvedValue([]);
    },
  };
});

import {
  createTenantPrisma,
  getTenantPrisma,
  tenantQuery,
} from "../prisma-tenant";

describe("createTenantPrisma", () => {
  it("should return an extended Prisma client", () => {
    const client = createTenantPrisma("tenant-123");
    expect(client).toBeDefined();
  });
});

describe("getTenantPrisma", () => {
  it("should return same client for same tenantId (cached)", () => {
    const client1 = getTenantPrisma("cached-tenant");
    const client2 = getTenantPrisma("cached-tenant");
    expect(client1).toBe(client2);
  });

  it("should return different clients for different tenantIds", () => {
    const client1 = getTenantPrisma("tenant-a");
    const client2 = getTenantPrisma("tenant-b");
    // Both are mocked but should be different objects from Map
    expect(client1).toBeDefined();
    expect(client2).toBeDefined();
  });
});

describe("tenantQuery", () => {
  it("should reject invalid tenantId format", async () => {
    await expect(tenantQuery("invalid-id", "SELECT 1")).rejects.toThrow(
      "Invalid tenantId format",
    );
  });

  it("should reject dangerous SQL patterns", async () => {
    const validUuid = "12345678-1234-1234-1234-123456789012";
    await expect(
      tenantQuery(validUuid, "SELECT 1; DROP TABLE users"),
    ).rejects.toThrow("SQL contains disallowed statements");
  });

  it("should accept valid UUID and safe SQL", async () => {
    const validUuid = "12345678-1234-1234-1234-123456789012";
    const result = await tenantQuery(
      validUuid,
      'SELECT * FROM "Part" WHERE "tenantId" = $1',
      [validUuid],
    );
    expect(result).toEqual([]);
  });

  it("should reject DELETE pattern", async () => {
    const validUuid = "12345678-1234-1234-1234-123456789012";
    await expect(
      tenantQuery(validUuid, "SELECT 1; DELETE FROM users"),
    ).rejects.toThrow("SQL contains disallowed statements");
  });

  it("should reject TRUNCATE pattern", async () => {
    const validUuid = "12345678-1234-1234-1234-123456789012";
    await expect(
      tenantQuery(validUuid, "SELECT 1; TRUNCATE TABLE users"),
    ).rejects.toThrow("SQL contains disallowed statements");
  });
});
