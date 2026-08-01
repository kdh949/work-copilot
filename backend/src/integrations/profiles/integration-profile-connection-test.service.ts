import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IntegrationProfile } from './entities/integration-profile.entity';
import {
  IntegrationProfileUrlPolicy,
  type IntegrationProvider,
} from './integration-profile-url.policy';

type DiscoveryDocument = {
  authorization_endpoint?: unknown;
};

type ProbeStatus = 'reachable' | 'authorization_required' | 'unavailable';

type ProviderTestResult = {
  discovery: 'reachable';
  authorizationUrl: string;
  allowedResources: Record<string, ProbeStatus>;
};

export type IntegrationProfileTestResult = {
  jira: ProviderTestResult;
  confluence: ProviderTestResult & {
    parentPage: ProbeStatus | 'not_configured';
  };
};

@Injectable()
export class IntegrationProfileConnectionTestService {
  constructor(private readonly urlPolicy: IntegrationProfileUrlPolicy) {}

  async test(
    profile: IntegrationProfile,
  ): Promise<IntegrationProfileTestResult> {
    const [jira, confluence] = await Promise.all([
      this.testJira(profile),
      this.testConfluence(profile),
    ]);

    return { jira, confluence };
  }

  private async testJira(
    profile: IntegrationProfile,
  ): Promise<ProviderTestResult> {
    const authorizationUrl = await this.buildAuthorizationUrl(
      'jira',
      profile.jiraBaseUrl,
      profile.jiraClientId,
      this.scopes(profile, 'jira'),
    );
    const allowedResources: Record<string, ProbeStatus> = {};

    for (const projectKey of profile.allowedProjectKeys) {
      const resourceUrl = this.urlPolicy.providerUrl(
        profile.jiraBaseUrl,
        `rest/api/2/project/${encodeURIComponent(projectKey)}`,
      );
      allowedResources[projectKey] = await this.probe(
        resourceUrl,
        profile.jiraBaseUrl,
      );
    }

    return {
      discovery: 'reachable',
      authorizationUrl,
      allowedResources,
    };
  }

  private async testConfluence(
    profile: IntegrationProfile,
  ): Promise<
    ProviderTestResult & { parentPage: ProbeStatus | 'not_configured' }
  > {
    const authorizationUrl = await this.buildAuthorizationUrl(
      'confluence',
      profile.confluenceBaseUrl,
      profile.confluenceClientId,
      this.scopes(profile, 'confluence'),
    );
    const allowedResources: Record<string, ProbeStatus> = {};

    for (const spaceKey of profile.allowedSpaceKeys) {
      const resourceUrl = this.urlPolicy.providerUrl(
        profile.confluenceBaseUrl,
        `rest/api/space/${encodeURIComponent(spaceKey)}`,
      );
      allowedResources[spaceKey] = await this.probe(
        resourceUrl,
        profile.confluenceBaseUrl,
      );
    }

    const parentPage = profile.briefParentPageId
      ? await this.probe(
          this.urlPolicy.providerUrl(
            profile.confluenceBaseUrl,
            `rest/api/content/${encodeURIComponent(profile.briefParentPageId)}`,
          ),
          profile.confluenceBaseUrl,
        )
      : 'not_configured';

    return {
      discovery: 'reachable',
      authorizationUrl,
      allowedResources,
      parentPage,
    };
  }

  private async buildAuthorizationUrl(
    provider: IntegrationProvider,
    baseUrl: string,
    clientId: string,
    scopes: string[],
  ): Promise<string> {
    const discoveryUrl = this.urlPolicy.providerUrl(
      baseUrl,
      '.well-known/openid-configuration',
    );
    const response = await this.fetchSameOrigin(discoveryUrl, baseUrl);

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Integration discovery is unavailable.',
      );
    }

    let document: DiscoveryDocument;

    try {
      document = (await response.json()) as DiscoveryDocument;
    } catch {
      throw new ServiceUnavailableException(
        'Integration discovery is invalid.',
      );
    }

    if (typeof document.authorization_endpoint !== 'string') {
      throw new ServiceUnavailableException(
        'Integration discovery is invalid.',
      );
    }

    const authorizationUrl = this.urlPolicy.assertProviderEndpoint(
      document.authorization_endpoint,
      baseUrl,
    );
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set(
      'redirect_uri',
      this.urlPolicy.buildCallbackUrl(provider),
    );
    authorizationUrl.searchParams.set('scope', scopes.join(' '));

    return authorizationUrl.toString();
  }

  private async probe(url: URL, baseUrl: string): Promise<ProbeStatus> {
    const response = await this.fetchSameOrigin(url, baseUrl);

    if (response.ok) {
      return 'reachable';
    }

    if (response.status === 401 || response.status === 403) {
      return 'authorization_required';
    }

    return 'unavailable';
  }

  private async fetchSameOrigin(url: URL, baseUrl: string): Promise<Response> {
    let currentUrl = await this.urlPolicy.assertSafeRequestUrl(url, baseUrl);

    for (let redirectCount = 0; redirectCount < 3; redirectCount += 1) {
      let response: Response;

      try {
        response = await fetch(currentUrl, {
          headers: { Accept: 'application/json' },
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        throw new ServiceUnavailableException(
          'Integration endpoint is unavailable.',
        );
      }

      if (response.status < 300 || response.status >= 400) {
        return response;
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

  private scopes(
    profile: IntegrationProfile,
    provider: IntegrationProvider,
  ): string[] {
    const scopes = profile.policy.oauthScopes?.[provider];

    if (!scopes || scopes.length === 0) {
      throw new BadRequestException('Integration scopes are not configured.');
    }

    return scopes;
  }
}
