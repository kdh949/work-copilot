import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { IntegrationProfile } from '../profiles/entities/integration-profile.entity';
import {
  IntegrationProfileUrlPolicy,
  type IntegrationProvider,
} from '../profiles/integration-profile-url.policy';

const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

export type OAuthClientConfiguration = {
  provider: IntegrationProvider;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
};

export type OAuthTokenPair = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
};

export class ProviderReauthorizationRequiredError extends Error {
  constructor() {
    super('Provider reauthorization is required.');
  }
}

@Injectable()
export class AtlassianOAuthClientService {
  constructor(private readonly urlPolicy: IntegrationProfileUrlPolicy) {}

  async createAuthorizationUrl(
    configuration: OAuthClientConfiguration,
    state: string,
    verifier: string,
  ): Promise<string> {
    const discovery = await this.discovery(configuration);
    const authorizationUrl = new URL(discovery.authorizationEndpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', configuration.clientId);
    authorizationUrl.searchParams.set(
      'redirect_uri',
      configuration.redirectUri,
    );
    authorizationUrl.searchParams.set('scope', configuration.scopes.join(' '));
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set(
      'code_challenge',
      this.sha256Base64Url(verifier),
    );
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');

    return authorizationUrl.toString();
  }

  async exchangeAuthorizationCode(
    configuration: OAuthClientConfiguration,
    code: string,
    verifier: string,
  ): Promise<OAuthTokenPair> {
    const discovery = await this.discovery(configuration);
    return this.requestToken(configuration, discovery.tokenEndpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: configuration.redirectUri,
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      code_verifier: verifier,
    });
  }

  async refresh(
    configuration: OAuthClientConfiguration,
    refreshToken: string,
  ): Promise<OAuthTokenPair> {
    const discovery = await this.discovery(configuration);
    return this.requestToken(configuration, discovery.tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
    });
  }

  async revoke(
    configuration: OAuthClientConfiguration,
    refreshToken: string,
  ): Promise<void> {
    try {
      const discovery = await this.discovery(configuration);

      if (!discovery.revocationEndpoint) {
        return;
      }

      const response = await this.fetchSameOrigin(
        new URL(discovery.revocationEndpoint),
        configuration.baseUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: refreshToken,
            token_type_hint: 'refresh_token',
            client_id: configuration.clientId,
            client_secret: configuration.clientSecret,
          }).toString(),
        },
      );

      if (!response.ok) {
        return;
      }
    } catch {
      // Local token removal proceeds even when remote revocation is unavailable.
    }
  }

  configurationFromProfile(
    provider: IntegrationProvider,
    profile: IntegrationProfile,
    clientSecret: string,
  ): OAuthClientConfiguration {
    const scopes = profile.policy.oauthScopes?.[provider];

    if (!scopes || scopes.length === 0) {
      throw new BadRequestException('Integration scopes are not configured.');
    }

    return {
      provider,
      baseUrl:
        provider === 'jira' ? profile.jiraBaseUrl : profile.confluenceBaseUrl,
      clientId:
        provider === 'jira' ? profile.jiraClientId : profile.confluenceClientId,
      clientSecret,
      scopes,
      redirectUri: this.urlPolicy.buildCallbackUrl(provider),
    };
  }

  private async discovery(configuration: OAuthClientConfiguration): Promise<{
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revocationEndpoint?: string;
  }> {
    const discoveryUrl = this.urlPolicy.providerUrl(
      configuration.baseUrl,
      '.well-known/openid-configuration',
    );
    const response = await this.fetchSameOrigin(
      discoveryUrl,
      configuration.baseUrl,
      { headers: { Accept: 'application/json' } },
    );

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Integration discovery is unavailable.',
      );
    }

    const document = await this.readJson(
      response,
      'Integration discovery is invalid.',
    );
    const authorizationEndpoint = this.requiredEndpoint(
      document.authorization_endpoint,
      configuration.baseUrl,
    );
    const tokenEndpoint = this.requiredEndpoint(
      document.token_endpoint,
      configuration.baseUrl,
    );
    const revocationEndpoint =
      typeof document.revocation_endpoint === 'string'
        ? this.urlPolicy
            .assertProviderEndpoint(
              document.revocation_endpoint,
              configuration.baseUrl,
            )
            .toString()
        : undefined;

    return {
      authorizationEndpoint: authorizationEndpoint.toString(),
      tokenEndpoint: tokenEndpoint.toString(),
      revocationEndpoint,
    };
  }

  private async requestToken(
    configuration: OAuthClientConfiguration,
    tokenEndpoint: string,
    values: Record<string, string>,
  ): Promise<OAuthTokenPair> {
    const response = await this.fetchSameOrigin(
      new URL(tokenEndpoint),
      configuration.baseUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(values).toString(),
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new ProviderReauthorizationRequiredError();
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Integration token exchange failed.',
      );
    }

    const body = await this.readJson(
      response,
      'Integration token response is invalid.',
    );

    if (
      !this.isBoundedToken(body.access_token) ||
      (body.refresh_token !== undefined &&
        body.refresh_token !== null &&
        !this.isBoundedToken(body.refresh_token)) ||
      !this.isExpiresIn(body.expires_in)
    ) {
      throw new ServiceUnavailableException(
        'Integration token response is invalid.',
      );
    }

    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === 'string' ? body.refresh_token : null,
      expiresAt: new Date(Date.now() + body.expires_in * 1000),
    };
  }

  private requiredEndpoint(value: unknown, baseUrl: string): URL {
    if (typeof value !== 'string') {
      throw new ServiceUnavailableException(
        'Integration discovery is invalid.',
      );
    }

    try {
      return this.urlPolicy.assertProviderEndpoint(value, baseUrl);
    } catch {
      throw new ServiceUnavailableException(
        'Integration discovery is invalid.',
      );
    }
  }

  private async fetchSameOrigin(
    url: URL,
    baseUrl: string,
    init: RequestInit,
  ): Promise<Response> {
    let currentUrl = await this.urlPolicy.assertSafeRequestUrl(url, baseUrl);

    for (let redirectCount = 0; redirectCount < 3; redirectCount += 1) {
      let response: Response;

      try {
        response = await fetch(currentUrl, {
          ...init,
          redirect: 'manual',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new ServiceUnavailableException(
          'Integration endpoint is unavailable.',
        );
      }

      if (response.status < 300 || response.status >= 400) {
        return response;
      }

      if (init.method && init.method !== 'GET') {
        throw new BadRequestException('Integration redirect is invalid.');
      }

      const location = response.headers.get('location');

      if (!location) {
        throw new BadRequestException('Integration redirect is invalid.');
      }

      currentUrl = await this.urlPolicy.assertSafeRequestUrl(
        this.urlPolicy.assertProviderEndpoint(
          new URL(location, currentUrl).toString(),
          baseUrl,
        ),
        baseUrl,
      );
    }

    throw new BadRequestException('Integration redirect is invalid.');
  }

  private async readJson(
    response: Response,
    message: string,
  ): Promise<Record<string, unknown>> {
    const contentLength = Number(response.headers.get('content-length'));

    if (
      Number.isFinite(contentLength) &&
      (contentLength < 0 || contentLength > MAX_RESPONSE_BYTES)
    ) {
      throw new ServiceUnavailableException(message);
    }

    let text: string;

    try {
      text = await response.text();
    } catch {
      throw new ServiceUnavailableException(message);
    }

    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new ServiceUnavailableException(message);
    }

    try {
      const value: unknown = JSON.parse(text);

      if (!this.isRecord(value)) {
        throw new Error('not a record');
      }

      return value;
    } catch {
      throw new ServiceUnavailableException(message);
    }
  }

  private isExpiresIn(value: unknown): value is number {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 7_776_000
    );
  }

  private isBoundedToken(value: unknown): value is string {
    return (
      typeof value === 'string' && value.length > 0 && value.length <= 16_384
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private sha256Base64Url(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
  }
}
