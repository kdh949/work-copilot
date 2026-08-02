import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CorrelatedRequest } from '../../common/http/correlation-id.middleware';
import {
  SessionAuthGuard,
  AuthenticatedRequest,
} from '../../auth/guards/session-auth.guard';
import { WorkCopilotAdminGuard } from '../../auth/guards/work-copilot-admin.guard';
import { IntegrationProfilesController } from './integration-profiles.controller';
import { IntegrationProfilesService } from './integration-profiles.service';

describe('IntegrationProfilesController', () => {
  it('requires the session and Keycloak admin claim for every profile endpoint', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      IntegrationProfilesController,
    ) as unknown;

    expect(guards).toEqual([SessionAuthGuard, WorkCopilotAdminGuard]);
  });

  it('passes only actor and correlation metadata to the audit service', async () => {
    const create = jest.fn<Promise<{ id: string }>, [unknown, number, string]>(
      () => Promise.resolve({ id: 'profile-1' }),
    );
    const controller = new IntegrationProfilesController({
      create,
    } as unknown as IntegrationProfilesService);
    const request = {
      user: { sub: 42 },
      correlationId: 'correlation-123',
    } as AuthenticatedRequest & CorrelatedRequest;

    await controller.create(
      {
        jiraBaseUrl: 'https://jira.example.test',
        confluenceBaseUrl: 'https://confluence.example.test',
        jiraClientId: 'jira-client',
        confluenceClientId: 'confluence-client',
        jiraClientSecret: 'secret-input-never-audit-payload',
        confluenceClientSecret: 'other-secret-input-never-audit-payload',
        jiraScopes: ['READ'],
        confluenceScopes: ['READ'],
        allowedProjectKeys: ['ENG'],
        allowedSpaceKeys: ['ENG'],
        briefParentPageId: '123',
      },
      request,
    );

    expect(create).toHaveBeenCalledWith(
      expect.any(Object),
      42,
      'correlation-123',
    );
    const [, actorUserId, correlationId] = create.mock.calls[0] ?? [];
    expect(actorUserId).toBe(42);
    expect(correlationId).toBe('correlation-123');
  });
});
