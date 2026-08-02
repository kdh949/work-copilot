import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CorrelatedRequest } from './correlation-id.middleware';

const publicErrorCodes: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

const publicErrorCode = (status: number): string =>
  publicErrorCodes[status] ?? 'INTERNAL_SERVER_ERROR';

const diagnosticCode = (exception: unknown): string | undefined => {
  if (!(exception instanceof HttpException)) {
    return undefined;
  }

  const value = (exception as HttpException & { diagnosticCode?: unknown })
    .diagnosticCode;

  return typeof value === 'string' && /^OIDC_[A-Z_]{1,96}$/.test(value)
    ? value
    : undefined;
};

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<CorrelatedRequest & Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = publicErrorCode(status);
    const correlationId = request.correlationId ?? 'missing-correlation-id';
    const rejectionCode = diagnosticCode(exception);

    this.logger.warn(
      `${code}${rejectionCode ? ` diagnosticCode=${rejectionCode}` : ''} correlationId=${correlationId}`,
    );
    response.status(status).json({
      statusCode: status,
      code,
      correlationId,
    });
  }
}
