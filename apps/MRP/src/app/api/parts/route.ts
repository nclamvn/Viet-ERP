import { NextRequest, NextResponse } from "next/server";
import { Prisma } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api/with-auth";
import {
  parsePaginationParams,
  buildOffsetPaginationQuery,
  buildPaginatedResponse,
  paginatedSuccess,
  paginatedError,
} from "@/lib/pagination";
import { validateQuery, validateBody } from "@/lib/api/validation";
import { PartQuerySchema, PartCreateSchema } from "@/lib/validations";
import { logger } from "@/lib/logger";
import { logApi } from "@/lib/audit/audit-logger";
import { auditCreate } from "@/lib/audit/route-audit";
import { handleError } from "@/lib/error-handler";

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
// Allowed filters for parts
const ALLOWED_FILTERS = ["category", "lifecycleStatus", "makeOrBuy"];
const SEARCH_FIELDS = [
  "partNumber",
  "name",
  "description",
  "manufacturerPn",
  "manufacturer",
];

// GET - List all parts with pagination
export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const startTime = Date.now();

  try {
    // Validate query params
    const queryResult = validateQuery(
      PartQuerySchema,
      request.nextUrl.searchParams,
    );
    if (!queryResult.success) {
      // Log validation error for Gate 5.3 evidence
      logApi(request, 400, session.user?.id, "Validation error");
      return queryResult.response;
    }
    const {
      category,
      lifecycleStatus,
      makeOrBuy,
      ndaaCompliant,
      includeRelations,
      search,
      supplierId,
    } = queryResult.data;

    // Parse pagination params
    const params = parsePaginationParams(request);

    // Build where clause
    const where: Prisma.PartWhereInput = {};

    if (category) where.category = category;
    if (lifecycleStatus) where.lifecycleStatus = lifecycleStatus;
    if (makeOrBuy) where.makeOrBuy = makeOrBuy;
    if (ndaaCompliant) {
      where.ndaaCompliant = ndaaCompliant === "true";
    }
    if (supplierId) {
      where.partSuppliers = { some: { supplierId } };
    }
    if (search) {
      where.OR = SEARCH_FIELDS.map((field) => ({
        [field]: { contains: search, mode: "insensitive" as const },
      }));
    }

    const shouldIncludeRelations = includeRelations === "true";

    // Get total count and paginated data in parallel
    const [totalCount, parts] = await Promise.all([
      prisma.part.count({ where }),
      prisma.part.findMany({
        where,
        ...buildOffsetPaginationQuery(params),
        orderBy: params.sortBy
          ? { [params.sortBy]: params.sortOrder }
          : { partNumber: "asc" },
        include: shouldIncludeRelations
          ? {
              partSuppliers: {
                include: { supplier: true },
                orderBy: { isPreferred: "desc" },
                take: 3, // Limit suppliers
              },
              partAlternates: {
                include: { alternatePart: true },
                where: { approved: true },
                take: 3, // Limit alternates
              },
              partDocuments: {
                take: 5, // Limit documents
              },
              partCertifications: {
                where: {
                  OR: [
                    { expiryDate: null },
                    { expiryDate: { gte: new Date() } },
                  ],
                },
                take: 3, // Limit certifications
              },
              planning: true,
              costs: true,
              specs: true,
              compliance: true,
            }
          : {
              partSuppliers: {
                include: { supplier: true },
                orderBy: { isPreferred: "desc" },
                take: 1,
              },
              planning: true,
              costs: true,
            },
      }),
    ]);

    return paginatedSuccess(
      buildPaginatedResponse(parts, totalCount, params, startTime),
    );
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "GET /api/parts",
    });
    return paginatedError("Failed to fetch parts", 500);
  }
});

// POST - Create a new part
export const POST = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    // Validate request body
    const bodyResult = await validateBody(PartCreateSchema, request);
    if (!bodyResult.success) {
      logger.error("[Part Create] Validation failed", {
        context: "POST /api/parts",
        details: bodyResult.response,
      });
      return bodyResult.response;
    }
    const data = bodyResult.data;
    logger.debug("[Part Create] Validated data", { data });

    // Generate ID if not provided
    const id = data.id || `PRT-${Date.now()}`;

    const part = await prisma.part.create({
      data: {
        id,
        partNumber: data.partNumber,
        name: data.name,
        description: data.description,
        category: data.category,
        unit: data.unit || "EA",

        // ROOT LEVEL FIELDS - Keep in sync with nested relations for queries
        // (Same pattern as Update API for consistency)
        unitCost: data.unitCost ?? 0,
        standardCost: data.standardCost,
        averageCost: data.averageCost,
        landedCost: data.landedCost,
        freightPercent: data.freightPercent,
        dutyPercent: data.dutyPercent,
        overheadPercent: data.overheadPercent,
        priceBreakQty1: data.priceBreakQty1,
        priceBreakCost1: data.priceBreakCost1,
        priceBreakQty2: data.priceBreakQty2,
        priceBreakCost2: data.priceBreakCost2,
        priceBreakQty3: data.priceBreakQty3,
        priceBreakCost3: data.priceBreakCost3,
        weightKg: data.weightKg,
        lengthMm: data.lengthMm,
        widthMm: data.widthMm,
        heightMm: data.heightMm,
        volumeCm3: data.volumeCm3,
        color: data.color,
        material: data.material,
        leadTimeDays: data.leadTimeDays ?? 14,
        minStockLevel: data.minStockLevel ?? 0,
        reorderPoint: data.reorderPoint ?? 0,
        safetyStock: data.safetyStock ?? 0,
        makeOrBuy: data.makeOrBuy ?? "BUY",
        procurementType: data.procurementType ?? "STOCK",
        moq: data.moq ?? 1,
        orderMultiple: data.orderMultiple ?? 1,
        manufacturer: data.manufacturer,
        manufacturerPn: data.manufacturerPn,
        countryOfOrigin: data.countryOfOrigin,
        ndaaCompliant: data.ndaaCompliant ?? true,
        itarControlled: data.itarControlled ?? false,
        rohsCompliant: data.rohsCompliant ?? true,
        reachCompliant: data.reachCompliant ?? true,
        drawingNumber: data.drawingNumber,
        drawingUrl: data.drawingUrl,
        datasheetUrl: data.datasheetUrl,
        subCategory: data.subCategory,
        partType: data.partType,
        buyerCode: data.buyerCode,
        standardPack: data.standardPack ?? 1,
        hsCode: data.hsCode,
        eccn: data.eccn,
        lotControl: data.lotControl ?? false,
        serialControl: data.serialControl ?? false,
        shelfLifeDays: data.shelfLifeDays,
        inspectionRequired: data.inspectionRequired ?? true,
        inspectionPlan: data.inspectionPlan,
        aqlLevel: data.aqlLevel,
        certificateRequired: data.certificateRequired ?? false,
        revisionDate: data.revisionDate
          ? new Date(data.revisionDate)
          : undefined,
        isCritical: data.isCritical ?? false,

        status: "active",
        lifecycleStatus: data.lifecycleStatus || "ACTIVE",

        // Revision tracking
        revision: data.revision || "A",

        tags: data.tags || [],
        createdBy: session.user?.email || "system",

        // Nested Writes
        costs: {
          create: {
            unitCost: data.unitCost || 0,
            standardCost: data.standardCost,
            averageCost: data.averageCost,
            landedCost: data.landedCost,
            freightPercent: data.freightPercent,
            dutyPercent: data.dutyPercent,
            overheadPercent: data.overheadPercent,

            priceBreakQty1: data.priceBreakQty1,
            priceBreakCost1: data.priceBreakCost1,
            priceBreakQty2: data.priceBreakQty2,
            priceBreakCost2: data.priceBreakCost2,
            priceBreakQty3: data.priceBreakQty3,
            priceBreakCost3: data.priceBreakCost3,
          },
        },

        planning: {
          create: {
            minStockLevel: data.minStockLevel || 0,
            reorderPoint: data.reorderPoint || 0,
            maxStock: data.maxStock,
            safetyStock: data.safetyStock || 0,
            leadTimeDays: data.leadTimeDays || 0,
            makeOrBuy: data.makeOrBuy || "BUY",
            procurementType: data.procurementType || "STOCK",
            buyerCode: data.buyerCode,
            moq: data.moq || 1,
            orderMultiple: data.orderMultiple || 1,
            standardPack: data.standardPack || 1,
          },
        },

        specs: {
          create: {
            weightKg: data.weightKg,
            lengthMm: data.lengthMm,
            widthMm: data.widthMm,
            heightMm: data.heightMm,
            volumeCm3: data.volumeCm3,
            color: data.color,
            material: data.material,
            drawingNumber: data.drawingNumber,
            drawingUrl: data.drawingUrl,
            datasheetUrl: data.datasheetUrl,
            specDocument: data.specDocument,
            manufacturerPn: data.manufacturerPn,
            manufacturer: data.manufacturer,
            subCategory: data.subCategory,
            partType: data.partType,
          },
        },

        compliance: {
          create: {
            countryOfOrigin: data.countryOfOrigin,
            hsCode: data.hsCode,
            eccn: data.eccn,
            ndaaCompliant: data.ndaaCompliant ?? true,
            itarControlled: data.itarControlled ?? false,
            lotControl: data.lotControl ?? false,
            serialControl: data.serialControl ?? false,
            shelfLifeDays: data.shelfLifeDays,
            inspectionRequired: data.inspectionRequired ?? true,
            aqlLevel: data.aqlLevel,
            certificateRequired: data.certificateRequired ?? false,
            rohsCompliant: data.rohsCompliant ?? true,
            reachCompliant: data.reachCompliant ?? true,
          },
        },
      },
      include: {
        costs: true,
        planning: true,
        specs: true,
        compliance: true,
        partSuppliers: {
          include: { supplier: true },
        },
      },
    });

    // Create PartSupplier relation if primarySupplierId is provided
    if (data.primarySupplierId) {
      await prisma.partSupplier.create({
        data: {
          partId: part.id,
          supplierId: data.primarySupplierId,
          isPreferred: true,
          unitPrice: data.unitCost ?? 0,
          leadTimeDays: data.leadTimeDays ?? 0,
          minOrderQty: data.moq ?? 1,
        },
      });
    }

    // Create PartSupplier relations for secondary suppliers
    if (data.secondarySupplierIds && data.secondarySupplierIds.length > 0) {
      await prisma.partSupplier.createMany({
        data: data.secondarySupplierIds.map((supplierId: string) => ({
          partId: part.id,
          supplierId,
          isPreferred: false,
          unitPrice: data.unitCost ?? 0,
          leadTimeDays: data.leadTimeDays ?? 0,
          minOrderQty: data.moq ?? 1,
        })),
      });
    }

    // Re-fetch with supplier included
    const result =
      data.primarySupplierId ||
      (data.secondarySupplierIds && data.secondarySupplierIds.length > 0)
        ? await prisma.part.findUnique({
            where: { id: part.id },
            include: {
              costs: true,
              planning: true,
              specs: true,
              compliance: true,
              partSuppliers: { include: { supplier: true } },
            },
          })
        : part;

    // Audit trail: log creation
    auditCreate(request, session.user, "Part", part.id, {
      partNumber: part.partNumber,
      name: part.name,
      category: part.category,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    return handleError(error);
  }
});
