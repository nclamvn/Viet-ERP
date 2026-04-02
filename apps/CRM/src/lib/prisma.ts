import { PrismaClient } from ".prisma/crm-client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? [
            { level: "query", emit: "event" },
            { level: "warn", emit: "stdout" },
            { level: "error", emit: "stdout" },
          ]
        : ["error"],
  });

if (process.env.NODE_ENV === "development") {
  // @ts-expect-error — Prisma event typing
  prisma.$on("query", (e: any) => {
    if (e.duration > 100) {
      console.warn(`[SLOW QUERY] ${e.duration}ms: ${e.query}`);
    }
  });
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
