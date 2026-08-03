import { IntegrationProfileConnectionTestService } from './integration-profile-connection-test.service';
import { IntegrationProfile } from './entities/integration-profile.entity';
import { IntegrationProfileUrlPolicy } from './integration-profile-url.policy';

const response = (
  status: number,
  body?: unknown,
  location: string | null = null,
  contentType: string | null = null,
): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: jest.fn((name: string) => {
        if (name.toLowerCase() === 'location') return location;
        if (name.toLowerCase() === 'content-type') return contentType;
        return null;
      }),
    },
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
    const tokenRequests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = jest.fn(
      (
        input: URL | Request | string,
        init?: RequestInit,
      ): Promise<Response> => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.includes('/rest/oauth2/latest/token')) {
          tokenRequests.push({ url, init });
          return Promise.resolve(
            response(
              400,
              { error: 'invalid_client' },
              null,
              'application/json',
            ),
          );
        }

        if (url.includes('/rest/api/2/project/')) {
          return Promise.resolve(response(303));
        }

        return Promise.resolve(response(200));
      },
    );
    global.fetch = fetchMock as typeof fetch;
    const service = new IntegrationProfileConnectionTestService(urlPolicy);

    const result = await service.test(profile());

    expect(result.jira.authorizationEndpoint).toBe('configured');
    expect(new URL(result.jira.authorizationUrl).pathname).toBe(
      '/rest/oauth2/latest/authorize',
    );
    expect(result.jira.authorizationUrl).toContain('client_id=jira-client');
    expect(result.jira.authorizationUrl).toContain('scope=READ');
    expect(result.jira.tokenEndpoint).toBe('reachable');
    expect(result.confluence.tokenEndpoint).toBe('reachable');
    expect(result.jira.allowedResources).toEqual({
      ENG: 'authorization_required',
    });
    expect(result.confluence.allowedResources).toEqual({
      ENGSPACE: 'reachable',
    });
    expect(result.confluence.parentPage).toBe('reachable');
    expect(JSON.stringify(result)).not.toContain('provider-response-body');
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const jiraTokenRequest = tokenRequests[0];
    const confluenceTokenRequest = tokenRequests[1];
    expect(jiraTokenRequest).toBeDefined();
    expect(confluenceTokenRequest).toBeDefined();
    const jiraTokenUrl = new URL(jiraTokenRequest?.url ?? '');
    const jiraTokenInit = jiraTokenRequest?.init;
    const confluenceTokenUrl = new URL(confluenceTokenRequest?.url ?? '');
    const confluenceTokenInit = confluenceTokenRequest?.init;
    expect(jiraTokenUrl.searchParams.get('client_id')).toBe(
      'diagnostic-probe-client',
    );
    expect(jiraTokenUrl.searchParams.get('client_secret')).toBe(
      'diagnostic-probe-secret',
    );
    expect(jiraTokenInit?.body).toBeUndefined();
    expect(confluenceTokenUrl.search).toBe('');
    expect(confluenceTokenInit?.body).toContain(
      'client_id=diagnostic-probe-client',
    );
    expect(JSON.stringify(tokenRequests)).not.toContain('jira-client');
    expect(JSON.stringify(tokenRequests)).not.toContain('confluence-client');
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
      jira: {
        tokenEndpoint: 'unavailable',
        allowedResources: { ENG: 'authorization_required' },
      },
      confluence: {
        tokenEndpoint: 'unavailable',
        allowedResources: { ENGSPACE: 'authorization_required' },
        parentPage: 'authorization_required',
      },
    });
  });

  it('distinguishes non-JSON edge denials from provider authorization responses', async () => {
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
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(response(403, undefined, null, 'text/html'));
    const service = new IntegrationProfileConnectionTestService(urlPolicy);

    await expect(service.test(profile())).resolves.toMatchObject({
      jira: {
        tokenEndpoint: 'edge_blocked',
        allowedResources: { ENG: 'edge_blocked' },
      },
      confluence: {
        tokenEndpoint: 'edge_blocked',
        allowedResources: { ENGSPACE: 'edge_blocked' },
        parentPage: 'edge_blocked',
      },
    });
  });

  it('keeps JSON 403 responses in provider-level classifications', async () => {
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
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(403, { error: 'invalid_client' }, null, 'application/json'),
      );
    const service = new IntegrationProfileConnectionTestService(urlPolicy);

    await expect(service.test(profile())).resolves.toMatchObject({
      jira: {
        tokenEndpoint: 'reachable',
        allowedResources: { ENG: 'authorization_required' },
      },
      confluence: {
        tokenEndpoint: 'reachable',
        allowedResources: { ENGSPACE: 'authorization_required' },
        parentPage: 'authorization_required',
      },
    });
  });

  it('returns unavailable instead of failing the whole test on network errors', async () => {
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
    global.fetch = jest.fn<typeof fetch>().mockRejectedValue(new Error('down'));
    const service = new IntegrationProfileConnectionTestService(urlPolicy);

    await expect(service.test(profile())).resolves.toMatchObject({
      jira: {
        tokenEndpoint: 'unavailable',
        allowedResources: { ENG: 'unavailable' },
      },
      confluence: {
        tokenEndpoint: 'unavailable',
        allowedResources: { ENGSPACE: 'unavailable' },
        parentPage: 'unavailable',
      },
    });
  });
});
