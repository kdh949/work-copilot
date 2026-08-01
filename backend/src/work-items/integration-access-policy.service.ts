import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import {
  IntegrationProfileUrlPolicy,
  type IntegrationProvider,
} from '../integrations/profiles/integration-profile-url.policy';

@Injectable()
export class IntegrationAccessPolicyService {
  constructor(
    @InjectRepository(IntegrationProfile)
    private readonly profilesRepository: Repository<IntegrationProfile>,
    private readonly urlPolicy: IntegrationProfileUrlPolicy,
  ) {}

  async activeProfile(): Promise<IntegrationProfile> {
    const profile = await this.profilesRepository.findOne({
      where: { isActive: true },
    });

    if (!profile) {
      throw new ConflictException('An active integration profile is required.');
    }

    return profile;
  }

  assertAllowedProject(
    profile: IntegrationProfile,
    projectKey: string,
  ): string {
    const normalized = this.resourceKey(projectKey, 'project');

    if (!profile.allowedProjectKeys.includes(normalized)) {
      throw new ForbiddenException('Jira project is not allowed.');
    }

    return normalized;
  }

  assertAllowedSpace(profile: IntegrationProfile, spaceKey: string): string {
    const normalized = this.resourceKey(spaceKey, 'space');

    if (!profile.allowedSpaceKeys.includes(normalized)) {
      throw new ForbiddenException('Confluence space is not allowed.');
    }

    return normalized;
  }

  providerBaseUrl(
    profile: IntegrationProfile,
    provider: IntegrationProvider,
  ): string {
    return provider === 'jira'
      ? profile.jiraBaseUrl
      : profile.confluenceBaseUrl;
  }

  providerUrl(
    profile: IntegrationProfile,
    provider: IntegrationProvider,
    path: string,
  ): URL {
    return this.urlPolicy.providerUrl(
      this.providerBaseUrl(profile, provider),
      path,
    );
  }

  private resourceKey(value: string, resource: 'project' | 'space'): string {
    const normalized = value.trim().toUpperCase();

    if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(normalized)) {
      throw new ForbiddenException(`Integration ${resource} key is invalid.`);
    }

    return normalized;
  }
}
