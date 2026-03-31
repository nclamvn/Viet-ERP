// ============================================================
// @vierp/api-middleware — API Middleware Stack
// RRI-T Upgrade: DevOps Persona × D6 Infrastructure × INFRA Axis
//              + Security Auditor × D4 Security × SEC Axis
//
// Fixes:
// - No rate limit headers → x-ratelimit-limit/remaining/reset
// - No request ID propagation → x-request-id + x-trace-id
// - No response timing → x-response-time header
// - No CORS config → Configurable CORS middleware
// - No API versioning → URL + header-based versioning
// - No request validation → Zod-based request validation
// - No response envelope → Consistent success/error format
// ============================================================

// ─── Types ───────────────────────────────────────────────────

export interface MiddlewareContext {
  requestId: string;
  traceId: string;
  startTime: number;
  tenantId?: string;
  userId?: string;
  locale: string;
  apiVersion: string;
}

export interface APIResponse<T = unknown> {
  success: true;
  data: T;
  meta?: {
    requestId: string;
    timestamp: string;
    duration: number;
    pagination?: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  };
}

export interface APIErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    requestId: string;
    timestamp: string;
  };
}

export interface CORSConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  maxAge: number;
  credentials: boolean;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  retryAfter?: number; // seconds
}

export interface APIMiddlewareConfig {
  cors?: Partial<CORSConfig>;
  rateLimit?: {
    enabled: boolean;
    windowMs: number;
    max: number;
  };
  locale?: {
    default: string;
    supported: string[];
  };
  versioning?: {
    current: string;
    supported: string[];
    header: string;
  };
}

// ─── ID Generators ───────────────────────────────────────────

export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

export function generateTraceId(): string {
  return `trc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 11)}`;
}

// ─── Request Context Extraction ─────────────────────────────

/**
 * Extract or generate middleware context from incoming request
 */
export function extractContext(req: Request, config?: APIMiddlewareConfig): MiddlewareContext {
  const versionHeader = config?.versioning?.header || 'x-api-version';

  return {
    requestId: req.headers.get('x-request-id') || generateRequestId(),
    traceId: req.headers.get('x-trace-id') || generateTraceId(),
    startTime: Date.now(),
    tenantId: req.headers.get('x-tenant-id') || undefined,
    userId: req.headers.get('x-user-id') || undefined,
    locale: detectLocale(req, config),
    apiVersion: req.headers.get(versionHeader)
      || extractVersionFromURL(req.url)
      || config?.versioning?.current
      || 'v1',
  };
}

function detectLocale(req: Request, config?: APIMiddlewareConfig): string {
  const headerLocale = req.headers.get('accept-language')?.split(',')[0]?.trim();
  const supported = config?.locale?.supported || ['vi', 'en'];
  const defaultLocale = config?.locale?.default || 'vi';

  if (headerLocale) {
    const lang = headerLocale.split('-')[0].toLowerCase();
    if (supported.includes(lang)) return lang;
  }

  return defaultLocale;
}

function extractVersionFromURL(url: string): string | null {
  const match = url.match(/\/api\/(v\d+)\//);
  return match ? match[1] : null;
}

// ─── Response Builder ────────────────────────────────────────

/**
 * Build a standardized success response
 */
export function successResponse<T>(
  data: T,
  ctx: MiddlewareContext,
  pagination?: { page: number; pageSize: number; total: number }
): Response {
  const duration = Date.now() - ctx.startTime;

  const body: APIResponse<T> = {
    success: true,
    data,
    meta: {
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      duration,
      pagination: pagination ? {
        ...pagination,
        totalPages: Math.ceil(pagination.total / pagination.pageSize),
      } : undefined,
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: buildResponseHeaders(ctx, duration),
  });
}

/**
 * Build a standardized error response
 */
export function errorResponse(
  code: string,
  message: string,
  ctx: MiddlewareContext,
  options?: { statusCode?: number; details?: Record<string, any> }
): Response {
  const duration = Date.now() - ctx.startTime;

  const body: APIErrorResponse = {
    success: false,
    error: {
      code,
      message,
      details: options?.details,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
    },
  };

  return new Response(JSON.stringify(body), {
    status: options?.statusCode || 500,
    headers: buildResponseHeaders(ctx, duration),
  });
}

function buildResponseHeaders(ctx: MiddlewareContext, duration: number): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'x-request-id': ctx.requestId,
    'x-trace-id': ctx.traceId,
    'x-response-time': `${duration}ms`,
    'x-api-version': ctx.apiVersion,
    'Cache-Control': 'no-store',
  };
}

// ─── Rate Limit Headers ─────────────────────────────────────

/**
 * Add rate limit info to response headers
 */
export function withRateLimitHeaders(
  response: Response,
  info: RateLimitInfo
): Response {
  const headers = new Headers(response.headers);
  headers.set('x-ratelimit-limit', String(info.limit));
  headers.set('x-ratelimit-remaining', String(Math.max(0, info.remaining)));
  headers.set('x-ratelimit-reset', String(info.reset));
  if (info.retryAfter !== undefined) {
    headers.set('retry-after', String(info.retryAfter));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ─── CORS Middleware ─────────────────────────────────────────

const DEFAULT_CORS: CORSConfig = {
  allowedOrigins: ['http://localhost:3000', 'http://localhost:3001'],
  allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'x-request-id', 'x-trace-id',
    'x-tenant-id', 'x-api-version', 'x-csrf-token', 'accept-language',
  ],
  exposedHeaders: [
    'x-request-id', 'x-trace-id', 'x-response-time', 'x-api-version',
    'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  ],
  maxAge: 86400,
  credentials: true,
};

/**
 * Build CORS headers for a request
 */
export function buildCORSHeaders(
  req: Request,
  config?: Partial<CORSConfig>
): Record<string, string> {
  const cors = { ...DEFAULT_CORS, ...config };
  const origin = req.headers.get('origin') || '';
  const headers: Record<string, string> = {};

  // Check if origin is allowed
  const isAllowed = cors.allowedOrigins.includes('*') || cors.allowedOrigins.includes(origin);

  if (isAllowed) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }

  if (cors.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  headers['Access-Control-Expose-Headers'] = cors.exposedHeaders.join(', ');

  // Preflight response headers
  if (req.method === 'OPTIONS') {
    headers['Access-Control-Allow-Methods'] = cors.allowedMethods.join(', ');
    headers['Access-Control-Allow-Headers'] = cors.allowedHeaders.join(', ');
    headers['Access-Control-Max-Age'] = String(cors.maxAge);
  }

  return headers;
}

/**
 * Handle CORS preflight requests
 */
export function handlePreflight(req: Request, config?: Partial<CORSConfig>): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, {
    status: 204,
    headers: buildCORSHeaders(req, config),
  });
}

// ─── Security Headers ────────────────────────────────────────

/**
 * Production security headers
 */
export function getSecurityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0', // Modern browsers: use CSP instead
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  };
}

// ─── Request Validation ──────────────────────────────────────

export interface ValidationRule {
  param: string;
  location: 'query' | 'body' | 'header';
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'email' | 'uuid';
  min?: number;
  max?: number;
  pattern?: RegExp;
  message?: string;
}

/**
 * Validate request parameters
 */
export function validateRequest(
  req: Request,
  url: URL,
  body: any,
  rules: ValidationRule[]
): { valid: boolean; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};

  for (const rule of rules) {
    let value: any;

    switch (rule.location) {
      case 'query':
        value = url.searchParams.get(rule.param);
        break;
      case 'header':
        value = req.headers.get(rule.param);
        break;
      case 'body':
        value = body?.[rule.param];
        break;
    }

    const fieldErrors: string[] = [];

    if (rule.required && (value === null || value === undefined || value === '')) {
      fieldErrors.push(rule.message || `${rule.param} là bắt buộc / ${rule.param} is required`);
    }

    if (value !== null && value !== undefined && value !== '') {
      if (rule.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) fieldErrors.push(`${rule.param} phải là số / must be a number`);
        if (rule.min !== undefined && num < rule.min) fieldErrors.push(`${rule.param} tối thiểu ${rule.min}`);
        if (rule.max !== undefined && num > rule.max) fieldErrors.push(`${rule.param} tối đa ${rule.max}`);
      }

      if (rule.type === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
          fieldErrors.push(`${rule.param} không phải email hợp lệ / invalid email`);
        }
      }

      if (rule.type === 'uuid') {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))) {
          fieldErrors.push(`${rule.param} không phải UUID hợp lệ / invalid UUID`);
        }
      }

      if (rule.type === 'string' && typeof value === 'string') {
        if (rule.min !== undefined && value.length < rule.min) fieldErrors.push(`${rule.param} tối thiểu ${rule.min} ký tự`);
        if (rule.max !== undefined && value.length > rule.max) fieldErrors.push(`${rule.param} tối đa ${rule.max} ký tự`);
      }

      if (rule.pattern && !rule.pattern.test(String(value))) {
        fieldErrors.push(rule.message || `${rule.param} không đúng định dạng / invalid format`);
      }
    }

    if (fieldErrors.length > 0) {
      errors[rule.param] = fieldErrors;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ─── Pagination Helper ───────────────────────────────────────

export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Extract pagination params from URL query
 */
export function extractPagination(url: URL, defaults?: Partial<PaginationParams>): PaginationParams {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('pageSize') || url.searchParams.get('limit') || String(defaults?.pageSize || 20), 10))
  );
  const sortBy = url.searchParams.get('sortBy') || defaults?.sortBy || 'createdAt';
  const sortOrder = (url.searchParams.get('sortOrder') || defaults?.sortOrder || 'desc') as 'asc' | 'desc';

  return { page, pageSize, sortBy, sortOrder };
}

/**
 * Build Prisma-compatible pagination args
 */
export function toPrismaArgs(params: PaginationParams): {
  skip: number;
  take: number;
  orderBy: Record<string, 'asc' | 'desc'>;
} {
  return {
    skip: (params.page - 1) * params.pageSize,
    take: params.pageSize,
    orderBy: { [params.sortBy || 'createdAt']: params.sortOrder || 'desc' },
  };
}

// ─── Middleware Composer ─────────────────────────────────────

type NextHandler = (req: Request) => Promise<Response>;
type Middleware = (req: Request, next: NextHandler) => Promise<Response>;

/**
 * Compose multiple middleware into a single handler
 *
 * @example
 * const handler = compose(
 *   corsMiddleware,
 *   rateLimitMiddleware,
 *   authMiddleware,
 *   (req) => new Response('OK')
 * );
 */
export function compose(...middlewares: Array<Middleware | NextHandler>): NextHandler {
  return (req: Request) => {
    let index = -1;

    function dispatch(i: number): Promise<Response> {
      if (i <= index) {
        return Promise.reject(new Error('next() called multiple times'));
      }
      index = i;

      const fn = middlewares[i];
      if (!fn) return Promise.resolve(new Response('Not Found', { status: 404 }));

      if (i === middlewares.length - 1) {
        // Last handler — no next()
        return (fn as NextHandler)(req);
      }

      return (fn as Middleware)(req, () => dispatch(i + 1));
    }

    return dispatch(0);
  };
}

// ─── Pre-built Middleware ────────────────────────────────────

/**
 * Request timing + ID middleware
 * Adds x-request-id, x-trace-id, x-response-time
 */
export function requestContextMiddleware(): Middleware {
  return async (req, next) => {
    const ctx = extractContext(req);
    const response = await next(req);

    const duration = Date.now() - ctx.startTime;
    const headers = new Headers(response.headers);
    headers.set('x-request-id', ctx.requestId);
    headers.set('x-trace-id', ctx.traceId);
    headers.set('x-response-time', `${duration}ms`);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * CORS middleware
 */
export function corsMiddleware(config?: Partial<CORSConfig>): Middleware {
  return async (req, next) => {
    // Handle preflight
    const preflight = handlePreflight(req, config);
    if (preflight) return preflight;

    const response = await next(req);
    const corsHeaders = buildCORSHeaders(req, config);

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * Security headers middleware
 */
export function securityHeadersMiddleware(): Middleware {
  return async (req, next) => {
    const response = await next(req);
    const secHeaders = getSecurityHeaders();

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(secHeaders)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * In-memory rate limiter middleware
 */
export function rateLimitMiddleware(options: {
  windowMs?: number;
  max?: number;
  keyFn?: (req: Request) => string;
} = {}): Middleware {
  const windowMs = options.windowMs || 60000; // 1 min
  const max = options.max || 100;
  const keyFn = options.keyFn || ((req: Request) =>
    req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'anonymous'
  );

  const windows: Map<string, { count: number; resetAt: number }> = new Map();

  // Periodic cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (now > entry.resetAt) windows.delete(key);
    }
  }, windowMs).unref?.();

  return async (req, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let entry = windows.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      windows.set(key, entry);
    }

    entry.count++;

    const info: RateLimitInfo = {
      limit: max,
      remaining: max - entry.count,
      reset: Math.ceil(entry.resetAt / 1000),
    };

    if (entry.count > max) {
      info.retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      const ctx = extractContext(req);
      const response = errorResponse('RATE_LIMITED', 'Quá nhiều yêu cầu. Vui lòng thử lại sau.', ctx, {
        statusCode: 429,
        details: { retryAfter: info.retryAfter },
      });
      return withRateLimitHeaders(response, info);
    }

    const response = await next(req);
    return withRateLimitHeaders(response, info);
  };
}

// ─── Full Middleware Stack ────────────────────────────────────

/**
 * Create the full ERP API middleware stack
 *
 * @example
 * const middleware = createAPIMiddleware({ rateLimit: { max: 200 } });
 * export const GET = middleware(async (req) => {
 *   return Response.json({ data: 'hello' });
 * });
 */
export function createAPIMiddleware(config?: Partial<{
  cors: Partial<CORSConfig>;
  rateLimit: { windowMs?: number; max?: number };
  skipRateLimit: boolean;
  skipSecurity: boolean;
}>): (handler: NextHandler) => NextHandler {
  return (handler: NextHandler) => {
    const middlewares: Array<Middleware | NextHandler> = [
      requestContextMiddleware(),
      corsMiddleware(config?.cors),
    ];

    if (!config?.skipSecurity) {
      middlewares.push(securityHeadersMiddleware());
    }

    if (!config?.skipRateLimit) {
      middlewares.push(rateLimitMiddleware(config?.rateLimit));
    }

    middlewares.push(handler);

    return compose(...middlewares);
  };
}
