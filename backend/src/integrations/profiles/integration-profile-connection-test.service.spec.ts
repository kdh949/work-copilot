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

  it('uses Data Center OAuth paths and probes only allowlisted resources', async () => {
    const urlPolicy = {
      providerUrl: jest.fn(
        (baseUrl: string, path: string) => new URL(path, `${baseUrl}/`),
      ),
      assertSafeRequestUrl: jest.fn((url: URL) => Promise.resolve(url)),
      buildCallbackUrl: jest.fn(
        (provider: string) =>
          `https://api.example.test/integrations/${provider}/callback`,
      ),
    } as unknown as IntegrationProfileUrlPolicy;
    const fetchMock = jest.fn<typeof fetch>((input) => {
      const url = String(input);

      if (url.includes('/rest/api/2/project/')) {
        return Promise.resolve(response(303));
      }

      return Promise.resolve(response(200));
    });
    global.fetch = fetchMock;
    const service = new IntegrationProfileConnectionTestService(urlPolicy);

    const result = await service.test(profile());

    expect(result.jira.authorizationEndpoint).toBe('configured');
    expect(new URL(result.jira.authorizationUrl).pathname).toBe(
      '/rest/oauth2/latest/authorize',
    );
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats a protected-resource redirect as authorization required without following it', async () => {
    const urlPolicy = {
      providerUrl: jest.fn(
        (baseUrl: string, path: string) => new URL(path, `${baseUrl}/`),
      ),
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

    await expect(service.test(profile())).resolves.toMatchObject({
      jira: { allowedResources: { ENG: 'authorization_required' } },
      confluence: {
        allowedResources: { ENGSPACE: 'authorization_required' },
        parentPage: 'authorization_required',
      },
    });
  });
});
