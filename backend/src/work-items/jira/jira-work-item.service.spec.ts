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
  policy: {},
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
  function makeService(confluenceWorkItemService?: unknown) {
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
      service: new JiraWorkItemService(
        accessPolicy,
        readClient,
        oauth,
        confluenceWorkItemService as never,
      ),
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

  it('adds metadata-only Jira and Confluence recommendations when both user connections are available', async () => {
    const recommendEvidence = jest.fn(() =>
      Promise.resolve({
        accessStatus: 'accessible' as const,
        recommendations: [
          {
            id: 'confluence:200',
            provider: 'confluence' as const,
            sourceId: '200',
            url: 'https://confluence.example.test/pages/viewpage.action?pageId=200',
            title: 'ENG-1 배포 결정',
            version: '7',
            excerptLength: 0,
            accessStatus: 'accessible' as const,
            dlpStatus: 'not_evaluated' as const,
            recommendationReasons: ['jira_issue' as const],
          },
        ],
      }),
    );
    const { service } = makeService({ recommendEvidence });

    const result = await service.collectIssueEvidence(1, 'ENG-1', 'corr-a');

    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'jira:100',
          recommendationReasons: ['source_jira'],
        }),
        expect.objectContaining({
          id: 'jira:101',
          recommendationReasons: ['linked_jira'],
        }),
        expect.objectContaining({
          id: 'confluence:200',
          excerptLength: 0,
        }),
      ]),
    );
    expect(recommendEvidence).toHaveBeenCalledWith(
      1,
      'ENG-1',
      'Root issue',
      'corr-a',
    );
    expect(JSON.stringify(result)).not.toContain('private root description');
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

  it('returns no title, body, or key when a one-hop blocker is inaccessible', async () => {
    const readinessRoot = {
      id: '100',
      key: 'ENG-1',
      fields: {
        project: { key: 'ENG' },
        updated: '2026-08-02T00:00:00.000+0000',
        resolution: null,
        issuelinks: [
          {
            type: {
              name: 'Blocks',
              inward: 'is blocked by',
              outward: 'blocks',
            },
            inwardIssue: { key: 'ENG-2' },
          },
        ],
      },
    };
    const profileWithTemplate = {
      ...profile,
      policy: {
        childTaskTemplate: { issueTypeId: '10001', fields: {} },
      },
    } as IntegrationProfile;
    const accessPolicy = {
      activeProfile: jest.fn(() => Promise.resolve(profileWithTemplate)),
      assertAllowedProject: jest.fn((_profile, projectKey: string) => {
        if (projectKey !== 'ENG') throw new ForbiddenException();
        return projectKey;
      }),
      providerBaseUrl: jest.fn(() => profile.jiraBaseUrl),
      providerUrl: jest.fn(
        (_profile, _provider: 'jira', path: string) =>
          new URL(path, profile.jiraBaseUrl),
      ),
    } as unknown as IntegrationAccessPolicyService;
    const getJson = jest.fn((url: URL) => {
      if (url.pathname.endsWith('/ENG-1')) {
        return Promise.resolve({ status: 'ok' as const, body: readinessRoot });
      }
      return Promise.resolve({ status: 'access_limited' as const });
    });
    const service = new JiraWorkItemService(
      accessPolicy,
      { getJson } as unknown as AtlassianReadClientService,
      {
        getAccessToken: jest.fn(() => Promise.resolve('user-token')),
      } as unknown as IntegrationsOAuthService,
    );

    const result = await service.collectReadinessContext(
      7,
      'ENG-1',
      'corr-readiness',
      false,
    );

    expect(result.dependencies).toEqual([{ kind: 'access_limited' }]);
    expect(JSON.stringify(result)).not.toContain('ENG-2');
    expect(JSON.stringify(result)).not.toContain('private linked description');
    expect(getJson.mock.calls[0][0].search).toContain(
      'fields=project%2Cupdated%2Cstatus%2Cresolution%2Cissuelinks',
    );
  });

  it('shows a one-hop blocker key only after the current user can read it', async () => {
    const readinessRoot = {
      id: '100',
      key: 'ENG-1',
      fields: {
        project: { key: 'ENG' },
        updated: '2026-08-02T00:00:00.000+0000',
        resolution: null,
        issuelinks: [
          {
            type: {
              name: 'Blocks',
              inward: 'is blocked by',
              outward: 'blocks',
            },
            inwardIssue: { key: 'ENG-2' },
          },
        ],
      },
    };
    const visibleBlocker = {
      id: '101',
      key: 'ENG-2',
      fields: {
        project: { key: 'ENG' },
        updated: '2026-08-02T00:01:00.000+0000',
        resolution: null,
        status: { statusCategory: { key: 'indeterminate' } },
        summary: '이 값은 readiness 결과에 포함되지 않습니다',
        description: 'private linked description',
        issuelinks: [],
      },
    };
    const accessPolicy = {
      activeProfile: jest.fn(() => Promise.resolve(profile)),
      assertAllowedProject: jest.fn(() => 'ENG'),
      providerBaseUrl: jest.fn(() => profile.jiraBaseUrl),
      providerUrl: jest.fn(
        (_profile, _provider: 'jira', path: string) =>
          new URL(path, profile.jiraBaseUrl),
      ),
    } as unknown as IntegrationAccessPolicyService;
    const getJson = jest.fn((url: URL) => {
      if (url.pathname.endsWith('/ENG-1')) {
        return Promise.resolve({ status: 'ok' as const, body: readinessRoot });
      }
      return Promise.resolve({ status: 'ok' as const, body: visibleBlocker });
    });
    const service = new JiraWorkItemService(
      accessPolicy,
      { getJson } as unknown as AtlassianReadClientService,
      {
        getAccessToken: jest.fn(() => Promise.resolve('user-token')),
      } as unknown as IntegrationsOAuthService,
    );

    const result = await service.collectReadinessContext(
      7,
      'ENG-1',
      'corr-readiness',
      false,
    );

    expect(result.dependencies).toEqual([
      {
        kind: 'visible_blocker',
        issueKey: 'ENG-2',
        url: 'https://jira.example.test/browse/ENG-2',
        crossProject: false,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('private linked description');
    expect(JSON.stringify(result)).not.toContain(
      '이 값은 readiness 결과에 포함되지 않습니다',
    );
  });

  it('reads only required Jira createmeta field IDs for the configured child task type', async () => {
    const readinessRoot = {
      id: '100',
      key: 'ENG-1',
      fields: {
        project: { key: 'ENG' },
        updated: '2026-08-02T00:00:00.000+0000',
        resolution: null,
        issuelinks: [],
      },
    };
    const profileWithTemplate = {
      ...profile,
      policy: {
        childTaskTemplate: { issueTypeId: '10001', fields: {} },
      },
    } as IntegrationProfile;
    const accessPolicy = {
      activeProfile: jest.fn(() => Promise.resolve(profileWithTemplate)),
      assertAllowedProject: jest.fn(() => 'ENG'),
      providerBaseUrl: jest.fn(() => profile.jiraBaseUrl),
      providerUrl: jest.fn(
        (_profile, _provider: 'jira', path: string) =>
          new URL(path, profile.jiraBaseUrl),
      ),
    } as unknown as IntegrationAccessPolicyService;
    const getJson = jest.fn((url: URL) => {
      if (url.pathname.endsWith('/ENG-1')) {
        return Promise.resolve({ status: 'ok' as const, body: readinessRoot });
      }
      if (url.pathname.endsWith('/createmeta')) {
        return Promise.resolve({
          status: 'ok' as const,
          body: {
            projects: [
              {
                key: 'ENG',
                issuetypes: [
                  {
                    id: '10001',
                    fields: {
                      summary: { required: true },
                      customfield_10100: { required: true },
                      labels: { required: false },
                    },
                  },
                ],
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const service = new JiraWorkItemService(
      accessPolicy,
      { getJson } as unknown as AtlassianReadClientService,
      {
        getAccessToken: jest.fn(() => Promise.resolve('user-token')),
      } as unknown as IntegrationsOAuthService,
    );

    const result = await service.collectReadinessContext(
      7,
      'ENG-1',
      'corr-readiness',
      true,
    );

    expect(result.createMetadata).toEqual({
      status: 'available',
      requiredFieldIds: ['customfield_10100', 'summary'],
    });
    expect(getJson.mock.calls[1][0].search).toContain(
      'expand=projects.issuetypes.fields',
    );
  });
});
