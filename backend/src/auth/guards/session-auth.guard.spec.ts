import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { AuthSession } from '../entities/auth-session.entity';
import { SessionService } from '../session/session.service';
import { SessionAuthGuard } from './session-auth.guard';

const activeSession = {
  id: 'session-1',
  isWorkCopilotAdmin: false,
  csrfSecretHash: 'hashed-token',
  user: {
    id: 7,
    email: 'pilot@example.test',
    department: '엔지니어링',
  },
} as AuthSession;

const contextFor = (
  method: string,
  headers: Record<string, string> = {},
): { context: ExecutionContext; request: Record<string, unknown> } => {
  const request = {
    method,
    header: (name: string) => headers[name.toLowerCase()],
  };

  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
};

describe('SessionAuthGuard', () => {
  it('hydrates a principal only from an active server-side session', async () => {
    const sessionService = {
      findActive: jest.fn().mockResolvedValue(activeSession),
      hasValidCsrfToken: jest.fn(),
    } as unknown as SessionService;
    const { context, request } = contextFor('GET', {
      cookie: 'work_copilot_session=session-token',
    });

    await expect(
      new SessionAuthGuard(sessionService).canActivate(context),
    ).resolves.toBe(true);
    expect(request.user).toEqual(
      expect.objectContaining({
        sub: 7,
        role: 'employee',
        isWorkCopilotAdmin: false,
      }),
    );
  });

  it('rejects a mutating request when its CSRF token is not bound to the session', async () => {
    const sessionService = {
      findActive: jest.fn().mockResolvedValue(activeSession),
      hasValidCsrfToken: jest.fn().mockReturnValue(false),
    } as unknown as SessionService;
    const { context } = contextFor('POST', {
      cookie: 'work_copilot_session=session-token',
    });

    await expect(
      new SessionAuthGuard(sessionService).canActivate(context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
