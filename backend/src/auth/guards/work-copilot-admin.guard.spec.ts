import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { WorkCopilotAdminGuard } from './work-copilot-admin.guard';

const contextFor = (isWorkCopilotAdmin: boolean): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user: { isWorkCopilotAdmin } }),
    }),
  }) as unknown as ExecutionContext;

describe('WorkCopilotAdminGuard', () => {
  it('allows the Keycloak work-copilot-admin claim', () => {
    expect(new WorkCopilotAdminGuard().canActivate(contextFor(true))).toBe(
      true,
    );
  });

  it('rejects a session without the Keycloak admin claim', () => {
    expect(() =>
      new WorkCopilotAdminGuard().canActivate(contextFor(false)),
    ).toThrow(ForbiddenException);
  });
});
