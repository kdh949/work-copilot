import { ForbiddenException } from '@nestjs/common';
import { IntegrationsOAuthService } from '../../integrations/oauth/integrations-oauth.service';
import { IntegrationProfile } from '../../integrations/profiles/entities/integration-profile.entity';
import { AtlassianReadClientService } from '../atlassian-read-client.service';
import { IntegrationAccessPolicyService } from '../integration-access-policy.service';
import { JiraWorkItemService } from './jira-work-item.service';

const profile = {
  id: 'profile-1',
  jiraBaseUrl: 'https://jira.example.test/',
  confluenceBaseUrl: 'https://confluence.example.test/',
  allowedProjectKeys: ['ENG'],
  allowedSpaceKeys: ['ENG'],
} as IntegrationProfile;

const rootIssue = {
  id: '100',
  key: 'ENG-1',
  fields: {
    project: { key: 'ENG' },
    summary: 'Root issue',
    updated: '2026-08-02T00:00:00.000+0000',
    description: 'private root description',
    issuelinks: [{ outwardIssue: { key: 'ENG-2' } }],
  },
};

const linkedIssue = {
  id: '101',
  key: 'ENG-2',
  fields: {
    project: { key: 'ENG' },
    summary: 'Linked issue',
    updated: '2026-08-02T00:01:00.000+0000',
    description: 'private linked description',
    issuelinks: [],
  },
};

describe('JiraWorkItemService', () => {
  function makeService() {
    const activeProfile = jest.fn(() => Promise.resolve(profile));
    const assertAllowedProject = jest.fn(
      (_profile: IntegrationProfile, projectKey: string) => {
        if (!profile.allowedProjectKeys.includes(projectKey)) {
          throw new ForbiddenException();
        }
        return projectKey;
      },
    );
    const accessPolicy = {
      activeProfile,
      assertAllowedProject,
      providerBaseUrl: jest.fn(() => profile.jiraBaseUrl),
      providerUrl: jest.fn(
        (_profile: IntegrationProfile, _provider: 'jira', path: string) =>
          new URL(path, profile.jiraBaseUrl),
      ),
    } as unknown as IntegrationAccessPolicyService;
    const getAccessToken = jest.fn((userId: number) =>
      Promise.resolve(userId === 1 ? 'token-user-a' : 'token-user-b'),
    );
    const oauth = {
      getAccessToken,
    } as unknown as IntegrationsOAuthService;
    const getJson = jest.fn((url: URL, _baseUrl: string, token: string) => {
      if (url.pathname.endsWith('/ENG-1')) {
        return Promise.resolve({ status: 'ok' as const, body: rootIssue });
      }

      if (url.pathname.endsWith('/ENG-2') && token === 'token-user-a') {
        return Promise.resolve({ status: 'ok' as const, body: linkedIssue });
      }

      return Promise.resolve({ status: 'access_limited' as const });
    });
    const readClient = { getJson } as unknown as AtlassianReadClientService;

    return {
      service: new JiraWorkItemService(accessPolicy, readClient, oauth),
      getAccessToken,
      getJson,
      assertAllowedProject,
    };
  }

  it('returns only the Jira evidence accessible to each user and omits raw excerpts', async () => {
    const { service, getAccessToken, getJson } = makeService();

    const [userA, userB] = await Promise.all([
      service.collectIssueEvidence(1, 'eng-1', 'corr-a'),
      service.collectIssueEvidence(2, 'ENG-1', 'corr-b'),
    ]);

    expect(userA).toEqual({
      accessStatus: 'accessible',
      evidence: [
        expect.objectContaining({
          id: 'jira:100',
          sourceId: '100',
          dlpStatus: 'not_evaluated',
          accessStatus: 'accessible',
        }),
        expect.objectContaining({ id: 'jira:101', sourceId: '101' }),
      ],
    });
    expect(userB).toEqual({
      accessStatus: 'accessible',
      evidence: [expect.objectContaining({ id: 'jira:100' })],
    });
    expect(JSON.stringify(userA)).not.toContain('private root description');
    expect(JSON.stringify(userA)).not.toContain('private linked description');
    expect(getAccessToken).toHaveBeenCalledWith(1, 'jira', 'corr-a');
    expect(getAccessToken).toHaveBeenCalledWith(2, 'jira', 'corr-b');
    expect(getJson).toHaveBeenCalledWith(
      expect.any(URL),
      profile.jiraBaseUrl,
      'token-user-a',
    );
  });

  it('rejects a non-allowlisted project before obtaining a user OAuth token', async () => {
    const { service, getAccessToken, assertAllowedProject } = makeService();

    await expect(
      service.collectIssueEvidence(1, 'HR-1', 'corr-a'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertAllowedProject).toHaveBeenCalledWith(profile, 'HR');
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('collects every allowlisted linked issue returned by Jira without an arbitrary truncation', async () => {
    const linkedKeys = Array.from(
      { length: 11 },
      (_, index) => `ENG-${index + 2}`,
    );
    const manyLinksRoot = {
      ...rootIssue,
      fields: {
        ...rootIssue.fields,
        issuelinks: linkedKeys.map((key) => ({ outwardIssue: { key } })),
      },
    };
    const accessPolicy = {
      activeProfile: jest.fn(() => Promise.resolve(profile)),
      assertAllowedProject: jest.fn(
        (_profile: IntegrationProfile, projectKey: string) => {
          if (projectKey !== 'ENG') {
            throw new ForbiddenException();
          }

          return projectKey;
        },
      ),
      providerBaseUrl: jest.fn(() => profile.jiraBaseUrl),
      providerUrl: jest.fn(
        (_profile: IntegrationProfile, _provider: 'jira', path: string) =>
          new URL(path, profile.jiraBaseUrl),
      ),
    } as unknown as IntegrationAccessPolicyService;
    const readClient = {
      getJson: jest.fn((url: URL) => {
        const issueKey = decodeURIComponent(
          url.pathname.split('/').at(-1) ?? '',
        );

        if (issueKey === 'ENG-1') {
          return Promise.resolve({
            status: 'ok' as const,
            body: manyLinksRoot,
          });
        }

        const sourceId = issueKey.slice('ENG-'.length);
        return Promise.resolve({
          status: 'ok' as const,
          body: {
            ...linkedIssue,
            id: sourceId,
            key: issueKey,
            fields: {
              ...linkedIssue.fields,
              summary: `Linked issue ${sourceId}`,
            },
          },
        });
      }),
    } as unknown as AtlassianReadClientService;
    const service = new JiraWorkItemService(accessPolicy, readClient, {
      getAccessToken: jest.fn(() => Promise.resolve('token-user-a')),
    } as unknown as IntegrationsOAuthService);

    const result = await service.collectIssueEvidence(1, 'ENG-1', 'corr-a');

    expect(result.evidence).toHaveLength(12);
    expect(result.evidence.map((item) => item.id)).toEqual(
      expect.arrayContaining(['jira:100', 'jira:2', 'jira:12']),
    );
  });
});
