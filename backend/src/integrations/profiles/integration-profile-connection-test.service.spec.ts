import { IntegrationProfileConnectionTestService } from './integration-profile-connection-test.service';
import { IntegrationProfile } from './entities/integration-profile.entity';
import { IntegrationProfileUrlPolicy } from './integration-profile-url.policy';

const response = (
  status: number,
  body?: unknown,
  location: string | null = null,
): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: jest.fn().mockReturnValue(location) },
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as Response;

const profile = (): IntegrationProfile =>
  ({
    id: 'profile-1',
    jiraBaseUrl: 'https://jira.example.test',
    confluenceBaseUrl: 'https://confluence.example.test',
    jiraClientId: 'jira-client',
    confluenceClientId: 'confluence-client',
    allowedProjectKeys: ['ENG'],
    allowedSpaceKeys: ['ENGSPACE'],
    briefParentPageId: '12345',
    policy: { oauthScopes: { jira: ['READ'], confluence: ['READ'] } },
  }) as IntegrationProfile;

describe('IntegrationProfileConnectionTestService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('probes only allowlisted metadata endpoints and returns no provider body', async () => {
    const urlPolicy = {
      providerUrl: jest.fn(
        (baseUrl: string, path: string) => new URL(path, `${baseUrl}/`),
      ),
      assertProviderEndpoint: jest.fn((value: string) => new URL(value)),
      assertSafeRequestUrl: jest.fn((url: URL) => Promise.resolve(url)),
      buildCallbackUrl: jest.fn(
        (provider: string) =>
          `https://api.example.test/integrations/${provider}/callback`,
      ),
    } as unknown as IntegrationProfileUrlPolicy;
    const fetchMock = jest.fn<typeof fetch>((input) => {
      const url = String(input);

      if (url.includes('.well-known/openid-configuration')) {
        return Promise.resolve(
          response(200, {
            authorization_endpoint: `${new URL(url).origin}/authorize`,
          }),
        );
      }

      if (url.includes('/rest/api/2/project/')) {
        return Promise.resolve(response(401));
      }

      return Promise.resolve(response(200));
    });
    global.fetch = fetchMock;
    const service = new IntegrationProfileConnectionTestService(urlPolicy);

    const result = await service.test(profile());

    expect(result.jira.authorizationUrl).toContain('client_id=jira-client');
    expect(result.jira.authorizationUrl).toContain('scope=READ');
    expect(result.jira.allowedResources).toEqual({
      ENG: 'authorization_required',
    });
    expect(result.confluence.allowedResources).toEqual({
      ENGSPACE: 'reachable',
    });
    expect(result.confluence.parentPage).toBe('reachable');
    expect(JSON.stringify(result)).not.toContain('provider-response-body');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('rejects a redirect that cannot be validated against the stored origin', async () => {
    const assertProviderEndpoint = jest.fn(() => {
      throw new Error('cross-origin redirect');
    });
    const urlPolicy = {
      providerUrl: jest.fn(
        (baseUrl: string, path: string) => new URL(path, `${baseUrl}/`),
      ),
      assertProviderEndpoint,
      assertSafeRequestUrl: jest.fn((url: URL) => Promise.resolve(url)),
      buildCallbackUrl: jest.fn(
        (provider: string) =>
          `https://api.example.test/integrations/${provider}/callback`,
      ),
    } as unknown as IntegrationProfileUrlPolicy;
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(302, undefined, 'https://attacker.example.test'),
      );
    global.fetch = fetchMock;
    const service = new IntegrationProfileConnectionTestService(urlPolicy);

    await expect(service.test(profile())).rejects.toThrow(
      'cross-origin redirect',
    );
  });
});
