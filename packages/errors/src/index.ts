// ============================================================
// @vierp/errors — Domain Error Hierarchy + Global Error Handler
// RRI-T Upgrade: QA Destroyer × D7 Edge Cases × ERROR Axis
//
// Fixes:
// - No domain-specific errors → Full error class hierarchy
// - No global error handler → Centralized handler middleware
// - No error codes docs → Self-documenting error codes
// - No i18n error messages → Bilingual Vi/En messages
// ============================================================

// ─── Base Error ──────────────────────────────────────────────

export abstract class ERPError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  readonly isOperational: boolean;
  readonly timestamp: Date;
  readonly details?: Record<string, any>;

  constructor(message: string, options?: { details?: Record<string, any>; cause?: Error; isOperational?: boolean }) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    this.details = options?.details;
    this.isOperational = options?.isOperational ?? true;
    if (options?.cause) this.cause = options.cause;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON(): Record<string, any> {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

// ─── HTTP Errors (4xx / 5xx) ─────────────────────────────────

export class NotFoundError extends ERPError {
  readonly code = 'NOT_FOUND';
  readonly statusCode = 404;

  constructor(resource: string, identifier?: string) {
    const msg = identifier
      ? `Không tìm thấy ${resource}: ${identifier}`
      : `Không tìm thấy ${resource}`;
    super(msg, { details: { resource, identifier } });
  }
}

export class ValidationError extends ERPError {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 422;
  readonly fieldErrors: Record<string, string[]>;

  constructor(fieldErrors: Record<string, string[]>, message?: string) {
    super(message || 'Dữ liệu không hợp lệ', { details: { fields: fieldErrors } });
    this.fieldErrors = fieldErrors;
  }

  static fromZodError(zodError: any): ValidationError {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of zodError.issues || []) {
      const path = issue.path.join('.') || '_root';
      if (!fieldErrors[path]) fieldErrors[path] = [];
      fieldErrors[path].push(issue.message);
    }
    return new ValidationError(fieldErrors);
  }
}

export class ConflictError extends ERPError {
  readonly code = 'CONFLICT';
  readonly statusCode = 409;

  constructor(message: string, details?: Record<string, any>) {
    super(message, { details });
  }
}

export class UnauthorizedError extends ERPError {
  readonly code = 'UNAUTHORIZED';
  readonly statusCode = 401;

  constructor(message: string = 'Vui lòng đăng nhập để tiếp tục') {
    super(message);
  }
}

export class ForbiddenError extends ERPError {
  readonly code = 'FORBIDDEN';
  readonly statusCode = 403;

  constructor(message: string = 'Bạn không có quyền thực hiện thao tác này', details?: Record<string, any>) {
    super(message, { details });
  }
}

export class RateLimitError extends ERPError {
  readonly code = 'RATE_LIMITED';
  readonly statusCode = 429;
  readonly retryAfter: number;

  constructor(retryAfter: number) {
    super(`Quá nhiều yêu cầu. Vui lòng thử lại sau ${retryAfter} giây.`, { details: { retryAfter } });
    this.retryAfter = retryAfter;
  }
}

export class InternalError extends ERPError {
  readonly code = 'INTERNAL_ERROR';
  readonly statusCode = 500;

  constructor(message: string = 'Đã xảy ra lỗi hệ thống', cause?: Error) {
    super(message, { isOperational: false, cause });
  }
}

export class ServiceUnavailableError extends ERPError {
  readonly code = 'SERVICE_UNAVAILABLE';
  readonly statusCode = 503;

  constructor(service: string) {
    super(`Dịch vụ ${service} tạm thời không khả dụng. Vui lòng thử lại sau.`, { details: { service } });
  }
}

// ─── Domain Errors ───────────────────────────────────────────

// Accounting
export class JournalImbalanceError extends ERPError {
  readonly code = 'JOURNAL_IMBALANCE';
  readonly statusCode = 422;

  constructor(debitTotal: string, creditTotal: string) {
    super(`Bút toán không cân: Nợ ${debitTotal} ≠ Có ${creditTotal}`, {
      details: { debitTotal, creditTotal },
    });
  }
}

export class PeriodClosedError extends ERPError {
  readonly code = 'PERIOD_CLOSED';
  readonly statusCode = 422;

  constructor(period: string) {
    super(`Kỳ kế toán ${period} đã đóng. Không thể thêm/sửa bút toán.`, { details: { period } });
  }
}

export class InsufficientStockError extends ERPError {
  readonly code = 'INSUFFICIENT_STOCK';
  readonly statusCode = 422;

  constructor(productName: string, available: number, requested: number) {
    super(`Không đủ tồn kho "${productName}": có ${available}, cần ${requested}`, {
      details: { productName, available, requested },
    });
  }
}

// E-commerce
export class PaymentFailedError extends ERPError {
  readonly code = 'PAYMENT_FAILED';
  readonly statusCode = 402;

  constructor(provider: string, reason: string) {
    super(`Thanh toán qua ${provider} thất bại: ${reason}`, {
      details: { provider, reason },
    });
  }
}

export class OrderTransitionError extends ERPError {
  readonly code = 'INVALID_ORDER_TRANSITION';
  readonly statusCode = 422;

  constructor(from: string, to: string) {
    super(`Không thể chuyển đơn hàng từ "${from}" sang "${to}"`, {
      details: { from, to },
    });
  }
}

// Tenant / SaaS
export class TierLimitError extends ERPError {
  readonly code = 'TIER_LIMIT_EXCEEDED';
  readonly statusCode = 403;

  constructor(metric: string, limit: number, current: number, suggestedTier?: string) {
    super(`Đã đạt giới hạn ${metric} (${current}/${limit}). Vui lòng nâng cấp gói.`, {
      details: { metric, limit, current, suggestedTier },
    });
  }
}

export class FeatureNotAvailableError extends ERPError {
  readonly code = 'FEATURE_NOT_AVAILABLE';
  readonly statusCode = 403;

  constructor(feature: string, requiredTier: string) {
    super(`Tính năng "${feature}" yêu cầu gói ${requiredTier}`, {
      details: { feature, requiredTier },
    });
  }
}

// ─── Error Code Registry ─────────────────────────────────────

export const ERROR_CODES: Record<string, { statusCode: number; vi: string; en: string }> = {
  NOT_FOUND:                { statusCode: 404, vi: 'Không tìm thấy', en: 'Not found' },
  VALIDATION_ERROR:         { statusCode: 422, vi: 'Dữ liệu không hợp lệ', en: 'Validation error' },
  CONFLICT:                 { statusCode: 409, vi: 'Xung đột dữ liệu', en: 'Data conflict' },
  UNAUTHORIZED:             { statusCode: 401, vi: 'Chưa xác thực', en: 'Unauthorized' },
  FORBIDDEN:                { statusCode: 403, vi: 'Không có quyền', en: 'Forbidden' },
  RATE_LIMITED:             { statusCode: 429, vi: 'Quá nhiều yêu cầu', en: 'Rate limited' },
  INTERNAL_ERROR:           { statusCode: 500, vi: 'Lỗi hệ thống', en: 'Internal error' },
  SERVICE_UNAVAILABLE:      { statusCode: 503, vi: 'Dịch vụ không khả dụng', en: 'Service unavailable' },
  JOURNAL_IMBALANCE:        { statusCode: 422, vi: 'Bút toán không cân', en: 'Journal imbalance' },
  PERIOD_CLOSED:            { statusCode: 422, vi: 'Kỳ đã đóng', en: 'Period closed' },
  INSUFFICIENT_STOCK:       { statusCode: 422, vi: 'Không đủ tồn kho', en: 'Insufficient stock' },
  PAYMENT_FAILED:           { statusCode: 402, vi: 'Thanh toán thất bại', en: 'Payment failed' },
  INVALID_ORDER_TRANSITION: { statusCode: 422, vi: 'Trạng thái không hợp lệ', en: 'Invalid transition' },
  TIER_LIMIT_EXCEEDED:      { statusCode: 403, vi: 'Vượt giới hạn gói', en: 'Tier limit exceeded' },
  FEATURE_NOT_AVAILABLE:    { statusCode: 403, vi: 'Tính năng chưa mở', en: 'Feature not available' },
};

// ─── Global Error Handler ────────────────────────────────────

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    requestId?: string;
  };
}

/**
 * Convert any error to a standardized API error response
 */
export function toErrorResponse(err: unknown, requestId?: string): { status: number; body: ErrorResponse } {
  if (err instanceof ERPError) {
    return {
      status: err.statusCode,
      body: {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          requestId,
        },
      },
    };
  }

  if (err instanceof Error) {
    // Prisma known request error
    if (err.name === 'PrismaClientKnownRequestError') {
      const prismaErr = err as any;
      if (prismaErr.code === 'P2002') {
        return toErrorResponse(
          new ConflictError('Dữ liệu đã tồn tại', { fields: prismaErr.meta?.target }),
          requestId
        );
      }
      if (prismaErr.code === 'P2025') {
        return toErrorResponse(new NotFoundError('Record'), requestId);
      }
    }

    // Zod validation error
    if (err.name === 'ZodError') {
      return toErrorResponse(ValidationError.fromZodError(err), requestId);
    }
  }

  // Unknown error — don't leak details
  return {
    status: 500,
    body: {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.',
        requestId,
      },
    },
  };
}

/**
 * Type guard: is this error operational (expected) or programmer error?
 */
export function isOperationalError(err: unknown): boolean {
  if (err instanceof ERPError) return err.isOperational;
  return false;
}

/**
 * Wrap an async API handler with error handling
 */
export function withErrorHandler(
  handler: (req: Request) => Promise<Response>,
  options?: { requestIdHeader?: string }
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      const requestId = req.headers.get(options?.requestIdHeader || 'x-request-id') || undefined;
      const { status, body } = toErrorResponse(err, requestId);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (requestId) headers['x-request-id'] = requestId;
      if (err instanceof RateLimitError) {
        headers['Retry-After'] = String(err.retryAfter);
      }

      return new Response(JSON.stringify(body), { status, headers });
    }
  };
}
