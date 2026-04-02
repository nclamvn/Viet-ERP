import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '.prisma/tpm-nestjs-client';

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  meta: {
    timestamp: string;
    path: string;
    requestId: string;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let details: any = undefined;

    // Handle HTTP exceptions
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as any;
        message = resp.message || exception.message;
        code = resp.error || this.getErrorCode(status);
        details = resp.details;

        // Handle validation errors
        if (Array.isArray(resp.message)) {
          code = 'VALIDATION_ERROR';
          details = resp.message.map((msg: string) => ({
            message: msg,
          }));
          message = 'Validation failed';
        }
      } else {
        message = exceptionResponse as string;
      }
    }
    // Handle Prisma errors
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          code = 'DUPLICATE_ERROR';
          message = 'A record with this value already exists';
          details = { fields: exception.meta?.target };
          break;
        case 'P2021':
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          code = 'TABLE_NOT_FOUND';
          message = `Table does not exist. Run prisma db push to create schema.`;
          details = { prismaCode: exception.code, meta: exception.meta };
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          code = 'NOT_FOUND';
          message = 'Record not found';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          code = 'FOREIGN_KEY_ERROR';
          message = 'Related record not found';
          break;
        default:
          code = 'DATABASE_ERROR';
          message = `Database error [${exception.code}]`;
          details = { prismaCode: exception.code, meta: exception.meta };
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      code = 'VALIDATION_ERROR';
      message = 'Invalid data provided';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      code = 'DATABASE_CONNECTION_ERROR';
      message = `Database connection failed [${exception.errorCode}]`;
    }
    // Handle other errors
    else if (exception instanceof Error) {
      message = exception.message;
    }

    // Log error
    this.logger.error(
      `${request.method} ${request.url} - ${status} - ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    // Send response matching frontend expectations
    const errorResponse: ErrorResponse = {
      success: false,
      error: {
        code,
        message,
        details,
      },
      meta: {
        timestamp: new Date().toISOString(),
        path: request.url,
        requestId:
          (request.headers['x-request-id'] as string) ||
          `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      },
    };

    response.status(status).json(errorResponse);
  }

  private getErrorCode(status: number): string {
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
    };
    return codes[status] || 'ERROR';
  }
}
