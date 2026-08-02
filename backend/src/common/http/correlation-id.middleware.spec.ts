import { NextFunction, Request, Response } from 'express';
import {
  CorrelationIdMiddleware,
  CorrelatedRequest,
} from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  const middleware = new CorrelationIdMiddleware();

  it('preserves a valid inbound correlation ID', () => {
    const setHeader = jest.fn();
    const request = {
      header: jest.fn().mockReturnValue('request-123'),
    } as unknown as CorrelatedRequest;
    const response = { setHeader } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(request, response, next);

    expect(request.correlationId).toBe('request-123');
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'request-123');
    expect(next).toHaveBeenCalledWith();
  });

  it('replaces an unsafe inbound value', () => {
    const setHeader = jest.fn();
    const request = {
      header: jest.fn().mockReturnValue('bad value\nwith-break'),
    } as unknown as CorrelatedRequest;
    const response = { setHeader } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(request, response, next);

    expect(request.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replaces an API-key-looking correlation ID before it can enter logs', () => {
    const setHeader = jest.fn();
    const request = {
      header: jest.fn().mockReturnValue('sk-proj-abcdefghijklmnopqrstuv'),
    } as unknown as CorrelatedRequest;
    const response = { setHeader } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(request, response, next);

    expect(request.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).not.toHaveBeenCalledWith(
      'x-correlation-id',
      'sk-proj-abcdefghijklmnopqrstuv',
    );
  });
});
