import { NextResponse } from "next/server";
import { Prisma } from ".prisma/crm-client";
import { logger } from "@/lib/logger";

// ── ApiError class ──────────────────────────────────────────────────

export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// ── Predefined errors ───────────────────────────────────────────────

export function BadRequest(
  message = "Yêu cầu không hợp lệ",
  details?: unknown,
) {
  return new ApiError(400, "BAD_REQUEST", message, details);
}

export function Unauthorized(message = "Chưa đăng nhập") {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function Forbidden(
  message = "Bạn không có quyền thực hiện thao tác này",
) {
  return new ApiError(403, "FORBIDDEN", message);
}

export function NotFound(resource = "Tài nguyên") {
  return new ApiError(404, "NOT_FOUND", `${resource} không tìm thấy`);
}

export function Conflict(message = "Dữ liệu đã tồn tại") {
  return new ApiError(409, "CONFLICT", message);
}

export function RateLimited(resetAt?: Date) {
  const retryAfter = resetAt
    ? Math.ceil((resetAt.getTime() - Date.now()) / 1000)
    : 60;
  return new ApiError(
    429,
    "RATE_LIMITED",
    "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
    {
      retryAfter,
    },
  );
}

export function InternalError(message = "Lỗi hệ thống") {
  return new ApiError(500, "INTERNAL_ERROR", message);
}

// ── Prisma error mapping ────────────────────────────────────────────

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): ApiError {
  switch (error.code) {
    case "P2002": {
      // Unique constraint violation
      const target = (error.meta?.target as string[]) || [];
      const field = target[0] || "field";
      return new ApiError(409, "CONFLICT", `${field} đã tồn tại`, {
        field,
        constraint: "unique",
      });
    }
    case "P2025":
      // Record not found
      return new ApiError(404, "NOT_FOUND", "Không tìm thấy bản ghi");
    case "P2003":
      // Foreign key constraint failed
      return new ApiError(400, "FOREIGN_KEY_ERROR", "Tham chiếu không hợp lệ");
    case "P2014":
      // Required relation violation
      return new ApiError(400, "RELATION_ERROR", "Vi phạm ràng buộc quan hệ");
    default:
      return new ApiError(500, "DATABASE_ERROR", "Lỗi cơ sở dữ liệu");
  }
}

// ── Error handler ───────────────────────────────────────────────────

export function handleApiError(error: unknown, path?: string): NextResponse {
  // ApiError → structured response
  if (error instanceof ApiError) {
    const body: Record<string, unknown> = {
      error: httpStatusText(error.statusCode),
      code: error.code,
      message: error.message,
    };
    if (error.details) body.details = error.details;

    // Add rate limit headers for 429
    if (error.statusCode === 429) {
      const retryAfter =
        (error.details as { retryAfter?: number })?.retryAfter || 60;
      return NextResponse.json(body, {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
        },
      });
    }

    return NextResponse.json(body, { status: error.statusCode });
  }

  // Prisma known request errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const apiError = mapPrismaError(error);
    logger.warn("Prisma error mapped", { code: error.code, path });
    return handleApiError(apiError, path);
  }

  // Prisma validation errors
  if (error instanceof Prisma.PrismaClientValidationError) {
    logger.warn("Prisma validation error", { path });
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: "Dữ liệu không hợp lệ",
      },
      { status: 400 },
    );
  }

  // Unknown errors → 500, log full error, return generic message
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error("Unhandled API error", err, { path });

  return NextResponse.json(
    {
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      message: "Lỗi hệ thống",
    },
    { status: 500 },
  );
}

function httpStatusText(status: number): string {
  const map: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    429: "Too Many Requests",
    500: "Internal Server Error",
  };
  return map[status] || "Error";
}
