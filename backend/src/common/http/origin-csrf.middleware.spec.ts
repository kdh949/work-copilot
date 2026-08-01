import { ForbiddenException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { OriginCsrfMiddleware } from './origin-csrf.middleware';

const requestFor = (
  method: string,
  headers: Record<string, string> = {},
  path = '/',
): Request =>
  ({
    method,
    path,
    header: (name: string) => headers[name.toLowerCase()],
  }) as unknown as Request;

describe('OriginCsrfMiddleware', () => {
  const middleware = new OriginCsrfMiddleware(['https://app.example.com']);
  const response = {} as Response;

  it('rejects a mutating request from an unapproved Origin', () => {
    const next = jest.fn() as NextFunction;

    middleware.use(
      requestFor('POST', {
        origin: 'https://attacker.example',
        'x-csrf-token': 'token',
      }),
      response,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });

  it('rejects a CSRF-less mutating request even from an approved Origin', () => {
    const next = jest.fn() as NextFunction;

    middleware.use(
      requestFor('PATCH', { origin: 'https://app.example.com' }),
      response,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });

  it('allows an approved Origin with a CSRF token', () => {
    const next = jest.fn() as NextFunction;

    middleware.use(
      requestFor('DELETE', {
        origin: 'https://app.example.com',
        'x-csrf-token': 'token',
      }),
      response,
      next,
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('does not apply CSRF validation to a safe request', () => {
    const next = jest.fn() as NextFunction;

    middleware.use(requestFor('GET'), response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('leaves only the dedicated webhook path to its route-secret ingress boundary', () => {
    const next = jest.fn() as NextFunction;

    middleware.use(
      requestFor('POST', {}, '/webhooks/profile-id/jira'),
      response,
      next,
    );

    expect(next).toHaveBeenCalledWith();
  });
});
