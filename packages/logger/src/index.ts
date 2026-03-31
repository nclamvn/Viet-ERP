// ============================================================
// @vierp/logger — Structured Logging + Request Tracing
// RRI-T Upgrade: DevOps Persona × D6 Infrastructure × INFRA Axis
//
// Fixes:
// - No structured logging → JSON structured logs with levels
// - No correlation ID → x-request-id propagation
// - No performance logging → request duration tracking
// - No context propagation → AsyncLocalStorage context
// ============================================================

import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  tenantId?: string;
  userId?: string;
  module?: string;
  duration?: number;        // ms
  statusCode?: number;
  method?: string;
  path?: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  metadata?: Record<string, any>;
}

export interface RequestContext {
  requestId: string;
  traceId: string;
  spanId: string;
  tenantId?: string;
  userId?: string;
  method?: string;
  path?: string;
  startTime: number;
  metadata: Record<string, any>;
}

export interface LoggerConfig {
  service: string;           // Module name (e.g., 'hrm', 'accounting')
  level: LogLevel;           // Minimum log level
  pretty?: boolean;          // Pretty print for development
  redactFields?: string[];   // Fields to redact from logs
  sampleRate?: number;       // 0-1, for high-volume debug logs
}

// ─── Log Level Hierarchy ─────────────────────────────────────

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

// ─── Async Context Storage ───────────────────────────────────

const requestStore = new AsyncLocalStorage<RequestContext>();

/**
 * Get current request context (from any async scope)
 */
export function getRequestContext(): RequestContext | undefined {
  return requestStore.getStore();
}

/**
 * Run a function within a request context
 * All logs inside will automatically include requestId, traceId, etc.
 */
export function withRequestContext<T>(
  context: Partial<RequestContext>,
  fn: () => T
): T {
  const fullContext: RequestContext = {
    requestId: context.requestId || generateId(),
    traceId: context.traceId || generateId(),
    spanId: context.spanId || generateShortId(),
    tenantId: context.tenantId,
    userId: context.userId,
    method: context.method,
    path: context.path,
    startTime: context.startTime || Date.now(),
    metadata: context.metadata || {},
  };
  return requestStore.run(fullContext, fn);
}

// ─── Logger Class ────────────────────────────────────────────

export class Logger {
  private config: Required<LoggerConfig>;
  private static defaultRedactFields = [
    'password', 'secret', 'token', 'apiKey', 'accessToken',
    'refreshToken', 'authorization', 'creditCard', 'cvv',
    'socialSecurityNumber', 'bankAccount',
  ];

  constructor(config: LoggerConfig) {
    this.config = {
      service: config.service,
      level: config.level || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
      pretty: config.pretty ?? process.env.NODE_ENV !== 'production',
      redactFields: [
        ...Logger.defaultRedactFields,
        ...(config.redactFields || []),
      ],
      sampleRate: config.sampleRate ?? 1,
    };
  }

  debug(message: string, metadata?: Record<string, any>): void {
    this.log('debug', message, metadata);
  }

  info(message: string, metadata?: Record<string, any>): void {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, any>): void {
    this.log('warn', message, metadata);
  }

  error(message: string, error?: Error | unknown, metadata?: Record<string, any>): void {
    const errorInfo = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
    } : error ? {
      name: 'UnknownError',
      message: String(error),
    } : undefined;

    this.log('error', message, { ...metadata, error: errorInfo });
  }

  fatal(message: string, error?: Error | unknown, metadata?: Record<string, any>): void {
    const errorInfo = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
    } : undefined;

    this.log('fatal', message, { ...metadata, error: errorInfo });
  }

  /**
   * Log an HTTP request/response cycle
   */
  request(method: string, path: string, statusCode: number, duration: number, metadata?: Record<string, any>): void {
    const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    this.log(level, `${method} ${path} ${statusCode} ${duration}ms`, {
      method,
      path,
      statusCode,
      duration,
      ...metadata,
    });
  }

  /**
   * Log a database query
   */
  query(operation: string, table: string, duration: number, metadata?: Record<string, any>): void {
    this.log('debug', `DB ${operation} ${table} ${duration}ms`, {
      dbOperation: operation,
      dbTable: table,
      duration,
      ...metadata,
    });
  }

  /**
   * Log an event publish/subscribe
   */
  event(action: 'publish' | 'subscribe' | 'handle' | 'ack' | 'nack', subject: string, metadata?: Record<string, any>): void {
    this.log('info', `EVENT ${action} ${subject}`, {
      eventAction: action,
      eventSubject: subject,
      ...metadata,
    });
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, any>): Logger {
    const child = new Logger(this.config);
    (child as any)._childContext = context;
    return child;
  }

  /**
   * Time a function and log its duration
   */
  async time<T>(label: string, fn: () => Promise<T>, metadata?: Record<string, any>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.info(`${label} completed`, { duration: Date.now() - start, ...metadata });
      return result;
    } catch (err) {
      this.error(`${label} failed`, err, { duration: Date.now() - start, ...metadata });
      throw err;
    }
  }

  // ── Internal ────────────────────────────────────────────────

  private log(level: LogLevel, message: string, metadata?: Record<string, any>): void {
    // Level check
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.level]) return;

    // Sampling for debug logs
    if (level === 'debug' && this.config.sampleRate < 1) {
      if (Math.random() > this.config.sampleRate) return;
    }

    // Build log entry
    const ctx = getRequestContext();
    const childCtx = (this as any)._childContext;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.config.service,
      requestId: ctx?.requestId,
      traceId: ctx?.traceId,
      spanId: ctx?.spanId,
      tenantId: ctx?.tenantId,
      userId: ctx?.userId,
      method: ctx?.method,
      path: ctx?.path,
    };

    // Merge metadata
    if (metadata) {
      if (metadata.error) entry.error = metadata.error;
      if (metadata.duration) entry.duration = metadata.duration;
      if (metadata.statusCode) entry.statusCode = metadata.statusCode;

      const { error: _e, duration: _d, statusCode: _s, ...rest } = metadata;
      if (Object.keys(rest).length > 0) {
        entry.metadata = { ...childCtx, ...this.redact(rest) };
      }
    } else if (childCtx) {
      entry.metadata = childCtx;
    }

    // Output
    if (this.config.pretty) {
      this.prettyPrint(entry);
    } else {
      // JSON structured log — one line per entry (for log aggregators)
      process.stdout.write(JSON.stringify(entry) + '\n');
    }
  }

  private prettyPrint(entry: LogEntry): void {
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m',  // green
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
      fatal: '\x1b[35m', // magenta
    };
    const reset = '\x1b[0m';
    const dim = '\x1b[2m';
    const color = levelColors[entry.level];

    const time = entry.timestamp.split('T')[1].replace('Z', '');
    const reqId = entry.requestId ? ` ${dim}[${entry.requestId.slice(0, 8)}]${reset}` : '';
    const dur = entry.duration ? ` ${dim}(${entry.duration}ms)${reset}` : '';
    const tenant = entry.tenantId ? ` ${dim}T:${entry.tenantId.slice(0, 8)}${reset}` : '';

    let line = `${dim}${time}${reset} ${color}${entry.level.toUpperCase().padEnd(5)}${reset} ${dim}[${entry.service}]${reset}${reqId}${tenant} ${entry.message}${dur}`;

    if (entry.error?.stack && ['error', 'fatal'].includes(entry.level)) {
      line += `\n${dim}${entry.error.stack}${reset}`;
    }

    console.log(line);
  }

  private redact(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (this.config.redactFields.includes(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.redact(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

// ─── Next.js Middleware Integration ──────────────────────────

/**
 * Request logging middleware for Next.js API routes
 * Adds x-request-id header and logs request/response
 */
export function requestLoggingMiddleware(logger: Logger) {
  return async function middleware(
    request: Request,
    handler: (req: Request) => Promise<Response>
  ): Promise<Response> {
    const requestId = (request.headers.get('x-request-id') || generateId());
    const traceId = (request.headers.get('x-trace-id') || requestId);
    const url = new URL(request.url);

    return withRequestContext(
      {
        requestId,
        traceId,
        method: request.method,
        path: url.pathname,
        tenantId: request.headers.get('x-tenant-id') || undefined,
        userId: request.headers.get('x-user-id') || undefined,
      },
      async () => {
        const start = Date.now();

        try {
          const response = await handler(request);
          const duration = Date.now() - start;

          // Add tracing headers to response
          const headers = new Headers(response.headers);
          headers.set('x-request-id', requestId);
          headers.set('x-trace-id', traceId);
          headers.set('x-response-time', `${duration}ms`);

          logger.request(request.method, url.pathname, response.status, duration);

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        } catch (err) {
          const duration = Date.now() - start;
          logger.error('Unhandled request error', err, { duration });

          return new Response(
            JSON.stringify({
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.',
                requestId,
              },
            }),
            {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                'x-request-id': requestId,
                'x-trace-id': traceId,
              },
            }
          );
        }
      }
    );
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

function generateShortId(): string {
  return crypto.randomBytes(4).toString('hex');
}

// ─── Factory ─────────────────────────────────────────────────

export function createLogger(service: string, options?: Partial<LoggerConfig>): Logger {
  return new Logger({
    service,
    level: (process.env.LOG_LEVEL as LogLevel) || 'info',
    ...options,
  });
}
