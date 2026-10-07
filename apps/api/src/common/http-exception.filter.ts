import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

function codeFromStatus(status: number): string {
  const name = HttpStatus[status];
  return typeof name === 'string' ? name : 'ERROR';
}

/**
 * Normalizes every error to the spec §51 contract. HttpExceptions may carry
 * `{ code, message, details }` in their response body to set a domain code.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const requestId = String(req.id ?? '');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeFromStatus(status);
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { code?: unknown; message?: unknown; details?: unknown };
        if (typeof b.code === 'string') code = b.code;
        if (Array.isArray(b.message)) {
          message = 'Validation failed';
          details = b.message;
        } else if (typeof b.message === 'string') {
          message = b.message;
        }
        if (b.details !== undefined) details = b.details;
      }
    } else {
      this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    }

    const payload: ApiErrorBody = { error: { code, message, requestId } };
    if (details !== undefined) payload.error.details = details;
    res.status(status).json(payload);
  }
}
