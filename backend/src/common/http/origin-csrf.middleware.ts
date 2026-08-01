import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import {
  CSRF_HEADER_NAME,
  isAllowedOrigin,
} from '../../config/security.config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class OriginCsrfMiddleware implements NestMiddleware {
  constructor(private readonly allowedOrigins: readonly string[]) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    if (request.path?.startsWith('/webhooks/')) {
      // Webhooks use a dedicated route secret and ingress allowlist instead of browser CSRF.
      next();
      return;
    }

    if (SAFE_METHODS.has(request.method)) {
      next();
      return;
    }

    const origin = request.header('origin');

    if (origin && !isAllowedOrigin(origin, this.allowedOrigins)) {
      next(new ForbiddenException('Origin is not allowed.'));
      return;
    }

    if (!request.header(CSRF_HEADER_NAME)) {
      next(new ForbiddenException('CSRF token is required.'));
      return;
    }

    next();
  }
}
