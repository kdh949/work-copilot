import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AtlassianOAuthClientService,
  type OAuthClientConfiguration,
  ProviderReauthorizationRequiredError,
} from './atlassian-oauth-client.service';
import { IntegrationProfileUrlPolicy } from '../profiles/integration-profile-url.policy';

const configuration: OAuthClientConfiguration = {
  provider: 'jira',
  baseUrl: 'https://jira.example.test/',
  clientId: 'jira-client',
  clientSecret: 'client-secret',
  scopes: ['READ'],
  redirectUri: 'https://api.example.test/integrations/jira/callback',
};

const discovery = {
  authorization_endpoint: 'https://jira.example.test/oauth/authorize',
  token_endpoint: 'https://jira.example.test/oauth/token',
  revocation_endpoint: 'https://jira.example.test/oauth/revoke',
};

const response = (status: number, body: string): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => String(Buffer.byteLength(body, 'utf8')) },
    text: jest.fn(() => Promise.resolve(body)),
  }) as unknown as Response;

describe('AtlassianOAuthClientService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeService() {
    const urlPolicy = {
      providerUrl: jest.fn(
        (baseUrl: string, path: string) => new URL(path, baseUrl),
      ),
      assertProviderEndpoint: jest.fn((value: string) => new URL(value)),
      assertSafeRequestUrl: jest.fn((url: URL) => Promise.resolve(url)),
      buildCallbackUrl: jest.fn(
        (provider: string) =>
          `https://api.example.test/integrations/${provider}/callback`,
      ),
    } as unknown as IntegrationProfileUrlPolicy;

    return new AtlassianOAuthClientService(urlPolicy);
  }

  it('builds an authorization code request with S256 PKCE after same-origin discovery', async () => {
    const service = makeService();
    const requests: RequestInit[] = [];
    const fetchMock = jest.fn(
      (_url: unknown, init?: RequestInit): Promise<Response> => {
        requests.push(init ?? {});
        return Promise.resolve(response(200, JSON.stringify(discovery)));
      },
    );
    global.fetch = fetchMock;

    const authorizationUrl = new URL(
      await service.createAuthorizationUrl(
        configuration,
        'state-value',
        'verifier-value',
      ),
    );

    expect(authorizationUrl.origin).toBe('https://jira.example.test');
    expect(authorizationUrl.searchParams.get('state')).toBe('state-value');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(authorizationUrl.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update('verifier-value').digest('base64url'),
    );
    expect(requests[0]).toEqual(
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('maps provider 401/403 without reading its body or using an Authorization header', async () => {
    const service = makeService();
    const providerBody =
      'provider response containing an access token must stay unread';
    const unreadProviderBody = jest.fn<Promise<string>, []>(() =>
      Promise.resolve(providerBody),
    );
    const unauthorized = {
      ...response(401, providerBody),
      text: unreadProviderBody,
    } as unknown as Response;
    const responses = [response(200, JSON.stringify(discovery)), unauthorized];
    const requests: RequestInit[] = [];
    const fetchMock = jest.fn(
      (_url: unknown, init?: RequestInit): Promise<Response> => {
        const next = responses.shift();

        if (!next) {
          throw new Error('unexpected OAuth request');
        }

        requests.push(init ?? {});
        return Promise.resolve(next);
      },
    );
    global.fetch = fetchMock;

    await expect(
      service.refresh(configuration, 'refresh-token'),
    ).rejects.toBeInstanceOf(ProviderReauthorizationRequiredError);

    expect(unreadProviderBody).not.toHaveBeenCalled();
    expect(requests[1]?.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
  });

  it('rejects an invalid discovery document without exposing the provider response', async () => {
    const service = makeService();
    const providerBody = JSON.stringify({ error: 'untrusted provider detail' });
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(response(200, providerBody));
    global.fetch = fetchMock;

    await expect(
      service.createAuthorizationUrl(
        configuration,
        'state-value',
        'verifier-value',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
