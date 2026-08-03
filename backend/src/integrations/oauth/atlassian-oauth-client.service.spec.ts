import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AtlassianOAuthClientService,
  ProviderAuthorizationCodeRejectedError,
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

  it('builds a Data Center authorization code request with S256 PKCE', async () => {
    const service = makeService();
    const fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;

    const authorizationUrl = new URL(
      await service.createAuthorizationUrl(
        configuration,
        'state-value',
        'verifier-value',
      ),
    );

    expect(authorizationUrl.origin).toBe('https://jira.example.test');
    expect(authorizationUrl.pathname).toBe('/rest/oauth2/latest/authorize');
    expect(authorizationUrl.searchParams.get('state')).toBe('state-value');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(authorizationUrl.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update('verifier-value').digest('base64url'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a rejected refresh token without reading its body', async () => {
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
    const responses = [unauthorized];
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
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const body = new URLSearchParams(String(requests[0]?.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-token');
    expect(body.get('redirect_uri')).toBe(configuration.redirectUri);
  });

  it('uses form-encoded token parameters and classifies an invalid client safely', async () => {
    const service = makeService();
    const providerDescription =
      'provider-controlled detail containing credentials must not leave the backend';
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      response(
        401,
        JSON.stringify({
          error: 'invalid_client',
          error_description: providerDescription,
        }),
      ),
    );
    global.fetch = fetchMock;

    let rejection: unknown;

    try {
      await service.exchangeAuthorizationCode(
        configuration,
        'authorization-code',
        'verifier-value',
      );
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(ProviderAuthorizationCodeRejectedError);
    expect(rejection).toMatchObject({ reason: 'invalid_client' });
    expect(JSON.stringify(rejection)).not.toContain(providerDescription);

    const tokenUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(tokenUrl.pathname).toBe('/rest/oauth2/latest/token');
    expect(tokenUrl.search).toBe('');
    const body = new URLSearchParams(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    );
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('authorization-code');
    expect(body.get('client_id')).toBe(configuration.clientId);
    expect(body.get('client_secret')).toBe(configuration.clientSecret);
    expect(body.get('redirect_uri')).toBe(configuration.redirectUri);
    expect(body.get('code_verifier')).toBe('verifier-value');
  });

  it.each([
    ['invalid_grant', 'invalid_grant'],
    ['invalid_scope', 'invalid_scope'],
    ['invalid_request', 'invalid_request'],
    ['untrusted_provider_code', 'unknown'],
  ] as const)(
    'keeps only the recognized OAuth error code for %s',
    async (providerError, expectedReason) => {
      const service = makeService();
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue(
        response(
          400,
          JSON.stringify({
            error: providerError,
            error_description: 'provider-controlled detail',
          }),
        ),
      );

      let rejection: unknown;

      try {
        await service.exchangeAuthorizationCode(
          configuration,
          'authorization-code',
          'verifier-value',
        );
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toMatchObject({ reason: expectedReason });
      expect(JSON.stringify(rejection)).not.toContain(
        'provider-controlled detail',
      );
    },
  );

  it('does not expose a non-JSON provider rejection', async () => {
    const service = makeService();
    const providerBody = 'provider response must not leave the backend';
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(response(400, providerBody));

    let rejection: unknown;

    try {
      await service.exchangeAuthorizationCode(
        configuration,
        'authorization-code',
        'verifier-value',
      );
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toMatchObject({ reason: 'unknown' });
    expect(JSON.stringify(rejection)).not.toContain(providerBody);
  });

  it('rejects an invalid token response without exposing the provider response', async () => {
    const service = makeService();
    const providerBody = JSON.stringify({ error: 'untrusted provider detail' });
    const fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue(response(200, providerBody));
    global.fetch = fetchMock;

    await expect(
      service.exchangeAuthorizationCode(
        configuration,
        'authorization-code',
        'verifier-value',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
