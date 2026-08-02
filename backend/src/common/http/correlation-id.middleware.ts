import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export type CorrelatedRequest = Request & {
  correlationId?: string;
};

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SECRET_LIKE_CORRELATION_ID_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/i,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
  /(?:^|[/:])\.env(?:[./:]|$)/i,
];

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(
    request: CorrelatedRequest,
    response: Response,
    next: NextFunction,
  ): void {
    const suppliedId = request.header('x-correlation-id');
    const correlationId =
      suppliedId && this.isSafeCorrelationId(suppliedId)
        ? suppliedId
        : randomUUID();

    request.correlationId = correlationId;
    response.setHeader('x-correlation-id', correlationId);
    next();
  }

  private isSafeCorrelationId(value: string): boolean {
    return (
      CORRELATION_ID_PATTERN.test(value) &&
      !SECRET_LIKE_CORRELATION_ID_PATTERNS.some((pattern) =>
        pattern.test(value),
      )
    );
  }
}
