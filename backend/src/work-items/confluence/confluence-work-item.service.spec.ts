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
});
