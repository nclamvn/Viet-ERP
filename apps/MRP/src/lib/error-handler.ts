// =============================================================================
// VietERP MRP - ERROR HANDLING UTILITY
// Centralized error handling for API routes
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { logger } from "./logger";
import { ZodError, ZodIssue } from "zod";
import { Prisma } from ".prisma/mrp-client";

// =============================================================================
// TYPES
// =============================================================================

export type ErrorContext = Record<string, unknown>;
export type RouteParams = Record<string, string | string[]>;

interface ValidationDetail {
  field: string;
  message: string;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly context?: ErrorContext;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = "INTERNAL_ERROR",
    isOperational: boolean = true,
    context?: ErrorContext,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.context = context;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);

    // Set prototype explicitly for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// Common error classes
export class ValidationError extends AppError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 400, "VALIDATION_ERROR", true, context);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication required") {
    super(message, 401, "AUTHENTICATION_ERROR", true);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = "Permission denied") {
    super(message, 403, "AUTHORIZATION_ERROR", true);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      404,
      "NOT_FOUND",
      true,
    );
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT", true);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Too many requests") {
    super(message, 429, "RATE_LIMIT", true);
  }
}

// =============================================================================
// ERROR HANDLER
// =============================================================================

interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: ValidationDetail[] | ErrorContext;
}

export function handleError(error: unknown): NextResponse<ErrorResponse> {
  // Log the error
  if (error instanceof Error) {
    logger.logError(error);
  } else {
    logger.error("Unknown error", { error });
  }

  // Handle known error types
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
        details: error.context,
      },
      { status: error.statusCode },
    );
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const details = error.issues.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));

    return NextResponse.json(
      {
        success: false,
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details,
      },
      { status: 400 },
    );
  }

  // Handle Prisma errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return handlePrismaError(error);
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return NextResponse.json(
      {
        success: false,
        error: "Database validation error",
        code: "DB_VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  // Handle generic errors
  if (error instanceof Error) {
    // Don't expose internal error messages in production
    const message =
      process.env.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : error.message;

    return NextResponse.json(
      {
        success: false,
        error: message,
        code: "INTERNAL_ERROR",
      },
      { status: 500 },
    );
  }

  // Unknown error type
  return NextResponse.json(
    {
      success: false,
      error: "An unexpected error occurred",
      code: "UNKNOWN_ERROR",
    },
    { status: 500 },
  );
}

// =============================================================================
// PRISMA ERROR HANDLER
// =============================================================================

function handlePrismaError(
  error: Prisma.PrismaClientKnownRequestError,
): NextResponse<ErrorResponse> {
  switch (error.code) {
    case "P2002":
      // Unique constraint violation
      const field = (error.meta?.target as string[])?.join(", ") || "field";
      return NextResponse.json(
        {
          success: false,
          error: `A record with this ${field} already exists`,
          code: "DUPLICATE_ENTRY",
        },
        { status: 409 },
      );

    case "P2025":
      // Record not found
      return NextResponse.json(
        {
          success: false,
          error: "Record not found",
          code: "NOT_FOUND",
        },
        { status: 404 },
      );

    case "P2003":
      // Foreign key constraint violation
      return NextResponse.json(
        {
          success: false,
          error: "Related record not found",
          code: "FOREIGN_KEY_ERROR",
        },
        { status: 400 },
      );

    case "P2014":
      // Required relation violation
      return NextResponse.json(
        {
          success: false,
          error: "Required relation missing",
          code: "RELATION_ERROR",
        },
        { status: 400 },
      );

    default:
      logger.error("Unhandled Prisma error", {
        code: error.code,
        meta: error.meta,
      });
      return NextResponse.json(
        {
          success: false,
          error: "Database error",
          code: `DB_ERROR_${error.code}`,
        },
        { status: 500 },
      );
  }
}

// =============================================================================
// TRY-CATCH WRAPPER
// =============================================================================

type AsyncHandler<T> = () => Promise<T>;

/**
 * Wraps async function with error handling
 */
export async function tryCatch<T>(
  fn: AsyncHandler<T>,
  errorMessage?: string,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      errorMessage ||
        (error instanceof Error ? error.message : "Operation failed"),
      500,
      "OPERATION_FAILED",
    );
  }
}

// =============================================================================
// API ROUTE WRAPPER
// =============================================================================

type RouteHandler = (
  request: NextRequest,
  context?: { params: RouteParams },
) => Promise<NextResponse>;

/**
 * Wraps API route with error handling
 */
export function withErrorHandling(handler: RouteHandler): RouteHandler {
  return async (request: NextRequest, context?: { params: RouteParams }) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return handleError(error);
    }
  };
}

// =============================================================================
// SUCCESS RESPONSE HELPERS
// =============================================================================

export function successResponse<T>(
  data: T,
  message?: string,
  status: number = 200,
): NextResponse {
  return NextResponse.json(
    {
      success: true,
      data,
      message,
    },
    { status },
  );
}

export function createdResponse<T>(data: T, message?: string): NextResponse {
  return successResponse(data, message || "Created successfully", 201);
}

export function noContentResponse(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function paginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({
    success: true,
    data: {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      ...extra,
    },
  });
}
