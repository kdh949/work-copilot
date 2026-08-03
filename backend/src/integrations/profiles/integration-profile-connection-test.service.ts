import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IntegrationProfile } from './entities/integration-profile.entity';
import {
  ATLASSIAN_OAUTH_AUTHORIZE_PATH,
  IntegrationProfileUrlPolicy,
  type IntegrationProvider,
} from './integration-profile-url.policy';

type ProbeStatus = 'reachable' | 'authorization_required' | 'unavailable';

type ProviderTestResult = {
  authorizationEndpoint: 'configured';
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
    const authorizationUrl = this.buildAuthorizationUrl(
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
      authorizationEndpoint: 'configured',
      authorizationUrl,
      allowedResources,
    };
  }

  private async testConfluence(
    profile: IntegrationProfile,
  ): Promise<
    ProviderTestResult & { parentPage: ProbeStatus | 'not_configured' }
  > {
    const authorizationUrl = this.buildAuthorizationUrl(
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
      authorizationEndpoint: 'configured',
      authorizationUrl,
      allowedResources,
      parentPage,
    };
  }

  private buildAuthorizationUrl(
    provider: IntegrationProvider,
    baseUrl: string,
    clientId: string,
    scopes: string[],
  ): string {
    const authorizationUrl = this.urlPolicy.providerUrl(
      baseUrl,
      ATLASSIAN_OAUTH_AUTHORIZE_PATH,
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

    if (
      (response.status >= 300 && response.status < 400) ||
      response.status === 401 ||
      response.status === 403
    ) {
      return 'authorization_required';
    }

    return 'unavailable';
  }

  private async fetchSameOrigin(url: URL, baseUrl: string): Promise<Response> {
    const safeUrl = await this.urlPolicy.assertSafeRequestUrl(url, baseUrl);

    try {
      return await fetch(safeUrl, {
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Integration endpoint is unavailable.',
      );
    }
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
