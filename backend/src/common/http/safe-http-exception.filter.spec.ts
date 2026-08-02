import {
  ArgumentsHost,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { SafeHttpExceptionFilter } from './safe-http-exception.filter';

describe('SafeHttpExceptionFilter', () => {
  it('does not expose an unexpected exception message', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = {
      status,
      json,
    } as unknown as Response;
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ correlationId: 'correlation-123' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new SafeHttpExceptionFilter().catch(
      new Error('provider body must stay private'),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      correlationId: 'correlation-123',
    });
  });

  it('keeps a safe diagnostic code out of the public unauthorized response', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = {
      status,
      json,
    } as unknown as Response;
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ correlationId: 'correlation-456' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    const exception = Object.assign(new UnauthorizedException(), {
      diagnosticCode: 'OIDC_EMAIL_DOMAIN_NOT_ALLOWED',
    });

    new SafeHttpExceptionFilter().catch(exception, host);

    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.UNAUTHORIZED,
      code: 'UNAUTHORIZED',
      correlationId: 'correlation-456',
    });
  });
});
