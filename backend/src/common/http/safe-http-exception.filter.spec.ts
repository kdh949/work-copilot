import { ArgumentsHost, HttpStatus } from '@nestjs/common';
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
});
