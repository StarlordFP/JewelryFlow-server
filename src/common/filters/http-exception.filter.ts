import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * HttpExceptionFilter
 *
 * Returns every error in a consistent envelope:
 * {
 *   success:    false,
 *   statusCode: 404,
 *   error:      "Not Found",
 *   message:    "Customer abc123 not found",
 *   path:       "/customers/abc123",
 *   timestamp:  "2024-03-15T10:30:00.000Z"
 * }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();

      if (typeof exResponse === 'string') {
        message = exResponse;
      } else if (typeof exResponse === 'object' && exResponse !== null) {
        const resp = exResponse as any;
        message = resp.message ?? message;
        error = resp.error ?? exception.name;
      }
    } else if (exception instanceof Error) {
      // Prisma unique constraint violation
      if ((exception as any).code === 'P2002') {
        status = HttpStatus.CONFLICT;
        error = 'Conflict';
        message = 'A record with that value already exists';
      }
      // Prisma record not found
      else if ((exception as any).code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        error = 'Not Found';
        message = 'Record not found';
      }
      // Log unexpected errors
      else {
        this.logger.error(exception.message, exception.stack);
      }
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
