import { IntegrationsOAuthService } from '../../integrations/oauth/integrations-oauth.service';
import { IntegrationProfile } from '../../integrations/profiles/entities/integration-profile.entity';
import { AtlassianReadClientService } from '../atlassian-read-client.service';
import { IntegrationAccessPolicyService } from '../integration-access-policy.service';
import { ConfluenceWorkItemService } from './confluence-work-item.service';

const profile = {
  id: 'profile-1',
  jiraBaseUrl: 'https://jira.example.test/',
  confluenceBaseUrl: 'https://confluence.example.test/',
  allowedProjectKeys: ['ENG'],
  allowedSpaceKeys: ['ENG'],
} as IntegrationProfile;

describe('ConfluenceWorkItemService', () => {
  it('looks up page body and version within an allowlisted space without returning the raw excerpt', async () => {
    const accessPolicy = {
      activeProfile: jest.fn(() => Promise.resolve(profile)),
      assertAllowedSpace: jest.fn(
        (_profile: IntegrationProfile, spaceKey: string) =>
          spaceKey.toUpperCase(),
      ),
      providerBaseUrl: jest.fn(() => profile.confluenceBaseUrl),
      providerUrl: jest.fn(
        (_profile: IntegrationProfile, _provider: 'confluence', path: string) =>
          new URL(path, profile.confluenceBaseUrl),
      ),
    } as unknown as IntegrationAccessPolicyService;
    const getAccessToken = jest.fn(() => Promise.resolve('token-user-a'));
    const oauth = { getAccessToken } as unknown as IntegrationsOAuthService;
    const getJson = jest.fn((url: URL, _baseUrl: string, token: string) => {
      expect(token).toBe('token-user-a');

      if (url.pathname.endsWith('/search')) {
        expect(url.searchParams.get('cql')).toContain('space = "ENG"');
        return Promise.resolve({
          status: 'ok' as const,
          body: {
            results: [
              { content: { id: '200', space: { key: 'ENG' } } },
              { id: '201', space: { key: 'HR' } },
            ],
          },
        });
      }

      return Promise.resolve({
        status: 'ok' as const,
        body: {
          id: '200',
          title: 'Engineering decision',
          space: { key: 'ENG' },
          version: { number: 7 },
          body: { storage: { value: '<p>private page excerpt</p>' } },
        },
      });
    });
    const readClient = { getJson } as unknown as AtlassianReadClientService;
    const service = new ConfluenceWorkItemService(
      accessPolicy,
      readClient,
      oauth,
    );

    const result = await service.searchEvidence(1, 'eng', 'decision', 'corr-a');

    expect(result).toEqual({
      accessStatus: 'accessible',
      evidence: [
        expect.objectContaining({
          id: 'confluence:200',
          sourceId: '200',
          version: '7',
          excerptLength: 20,
          dlpStatus: 'not_evaluated',
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private page excerpt');
    expect(getAccessToken).toHaveBeenCalledWith(1, 'confluence', 'corr-a');
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it('recommends Confluence metadata from Jira key and summary without fetching page storage', async () => {
    const accessPolicy = {
      activeProfile: jest.fn(() => Promise.resolve(profile)),
      assertAllowedSpace: jest.fn(
        (_profile: IntegrationProfile, spaceKey: string) =>
          spaceKey.toUpperCase(),
      ),
      providerBaseUrl: jest.fn(() => profile.confluenceBaseUrl),
      providerUrl: jest.fn(
        (_profile: IntegrationProfile, _provider: 'confluence', path: string) =>
          new URL(path, profile.confluenceBaseUrl),
      ),
    } as unknown as IntegrationAccessPolicyService;
    const getJson = jest.fn((url: URL) => {
      expect(url.pathname).toBe('/rest/api/content/search');
      expect(url.searchParams.get('expand')).toBe('space,version');
      expect(url.searchParams.get('expand')).not.toContain('body.storage');
      expect(url.searchParams.get('cql')).toContain('title ~');
      return Promise.resolve({
        status: 'ok' as const,
        body: {
          results: [
            {
              id: '200',
              title: 'ENG-1 배포 정책',
              space: { key: 'ENG' },
              version: { number: 7 },
              body: { storage: { value: '<p>untrusted page instruction</p>' } },
            },
          ],
        },
      });
    });
    const service = new ConfluenceWorkItemService(
      accessPolicy,
      { getJson } as unknown as AtlassianReadClientService,
      {
        getAccessToken: jest.fn(() => Promise.resolve('token-user-a')),
      } as unknown as IntegrationsOAuthService,
    );

    const result = await service.recommendEvidence(
      1,
      'eng-1',
      '배포 정책 점검',
      'corr-a',
    );

    expect(result).toEqual({
      accessStatus: 'accessible',
      recommendations: [
        expect.objectContaining({
          id: 'confluence:200',
          excerptLength: 0,
          recommendationReasons: ['jira_issue', 'jira_summary'],
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain('untrusted page instruction');
    expect(getJson).toHaveBeenCalled();
  });

  it('keeps selected page storage inside the draft-only adapter and returns metadata without the raw excerpt', async () => {
    const accessPolicy = {
      activeProfile: jest.fn(() => Promise.resolve(profile)),
      assertAllowedSpace: jest.fn(
        (_profile: IntegrationProfile, spaceKey: string) =>
          spaceKey.toUpperCase(),
      ),
      providerBaseUrl: jest.fn(() => profile.confluenceBaseUrl),
      providerUrl: jest.fn(
        (_profile: IntegrationProfile, _provider: 'confluence', path: string) =>
          new URL(path, profile.confluenceBaseUrl),
      ),
    } as unknown as IntegrationAccessPolicyService;
    const getJson = jest.fn((url: URL) => {
      const hasBodyExpansion = url.searchParams
        .get('expand')
        ?.includes('body.storage');

      return Promise.resolve({
        status: 'ok' as const,
        body: {
          id: '200',
          title: 'Engineering decision',
          space: { key: 'ENG' },
          version: { number: 7 },
          ...(hasBodyExpansion
            ? { body: { storage: { value: '<p>private page excerpt</p>' } } }
            : {}),
        },
      });
    });
    const service = new ConfluenceWorkItemService(
      accessPolicy,
      { getJson } as unknown as AtlassianReadClientService,
      {
        getAccessToken: jest.fn(() => Promise.resolve('token-user-a')),
      } as unknown as IntegrationsOAuthService,
    );

    const metadata = await service.collectEvidenceMetadata(
      1,
      ['confluence:200'],
      'corr-a',
    );
    const draftContext = await service.collectDraftEvidence(
      1,
      ['confluence:200'],
      'corr-a',
    );

    expect(metadata).toEqual({
      accessStatus: 'accessible',
      profileId: profile.id,
      evidence: [expect.objectContaining({ id: 'confluence:200' })],
    });
    expect(JSON.stringify(metadata)).not.toContain('private page excerpt');
    expect(draftContext.evidence[0].content).toContain('private page excerpt');
    expect(getJson.mock.calls[0][0].searchParams.get('expand')).toBe(
      'space,version',
    );
    expect(getJson.mock.calls[1][0].searchParams.get('expand')).toBe(
      'space,version,body.storage',
    );
  });

  it('fails closed when a selected page no longer belongs to an allowlisted space', async () => {
    const accessPolicy = {
      activeProfile: jest.fn(() => Promise.resolve(profile)),
      assertAllowedSpace: jest.fn(() => {
        throw new Error('space is denied');
      }),
      providerBaseUrl: jest.fn(() => profile.confluenceBaseUrl),
      providerUrl: jest.fn(
        (_profile: IntegrationProfile, _provider: 'confluence', path: string) =>
          new URL(path, profile.confluenceBaseUrl),
      ),
    } as unknown as IntegrationAccessPolicyService;
    const service = new ConfluenceWorkItemService(
      accessPolicy,
      {
        getJson: jest.fn(() =>
          Promise.resolve({
            status: 'ok' as const,
            body: {
              id: '200',
              title: '비공개 페이지',
              space: { key: 'HR' },
              version: { number: 7 },
            },
          }),
        ),
      } as unknown as AtlassianReadClientService,
      {
        getAccessToken: jest.fn(() => Promise.resolve('token-user-a')),
      } as unknown as IntegrationsOAuthService,
    );

    const result = await service.collectEvidenceMetadata(
      1,
      ['confluence:200'],
      'corr-a',
    );

    expect(result).toEqual({
      accessStatus: 'access_limited',
      profileId: null,
      evidence: [],
    });
    expect(JSON.stringify(result)).not.toContain('비공개 페이지');
  });
});
