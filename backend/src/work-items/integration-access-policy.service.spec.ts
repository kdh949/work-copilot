import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import { IntegrationProfileUrlPolicy } from '../integrations/profiles/integration-profile-url.policy';
import { IntegrationAccessPolicyService } from './integration-access-policy.service';

const profile = {
  id: 'profile-1',
  jiraBaseUrl: 'https://jira.example.test/jira/',
  confluenceBaseUrl: 'https://confluence.example.test/confluence/',
  allowedProjectKeys: ['ENG'],
  allowedSpaceKeys: ['ENG'],
  isActive: true,
} as IntegrationProfile;

describe('IntegrationAccessPolicyService', () => {
  it('loads the active profile and rejects resource keys outside its allowlists', async () => {
    const profilesRepository = {
      findOne: jest.fn(() => Promise.resolve(profile)),
    } as unknown as Repository<IntegrationProfile>;
    const urlPolicy = {
      providerUrl: jest.fn(
        (baseUrl: string, path: string) => new URL(path, baseUrl),
      ),
    } as unknown as IntegrationProfileUrlPolicy;
    const service = new IntegrationAccessPolicyService(
      profilesRepository,
      urlPolicy,
    );

    await expect(service.activeProfile()).resolves.toBe(profile);
    expect(service.assertAllowedProject(profile, 'eng')).toBe('ENG');
    expect(service.assertAllowedSpace(profile, 'eng')).toBe('ENG');
    expect(() => service.assertAllowedProject(profile, 'HR')).toThrow(
      ForbiddenException,
    );
    expect(() => service.assertAllowedSpace(profile, 'HR')).toThrow(
      ForbiddenException,
    );
    expect(
      service.providerUrl(profile, 'jira', 'rest/api/2/issue/ENG-1'),
    ).toEqual(new URL('https://jira.example.test/jira/rest/api/2/issue/ENG-1'));
  });

  it('fails closed when no integration profile is active', async () => {
    const service = new IntegrationAccessPolicyService(
      {
        findOne: jest.fn(() => Promise.resolve(null)),
      } as unknown as Repository<IntegrationProfile>,
      {} as IntegrationProfileUrlPolicy,
    );

    await expect(service.activeProfile()).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
