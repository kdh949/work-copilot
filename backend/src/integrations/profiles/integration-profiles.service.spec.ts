import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreateIntegrationProfileDto } from './dto/create-integration-profile.dto';
import { IntegrationProfile } from './entities/integration-profile.entity';
import { SecurityAuditEvent } from './entities/security-audit-event.entity';
import { IntegrationProfileConnectionTestService } from './integration-profile-connection-test.service';
import { IntegrationProfileCryptoService } from './integration-profile-crypto.service';
import { IntegrationProfileUrlPolicy } from './integration-profile-url.policy';
import { IntegrationProfilesService } from './integration-profiles.service';

const profileDto = (suffix: string): CreateIntegrationProfileDto => ({
  jiraBaseUrl: `https://jira-${suffix}.example.test`,
  confluenceBaseUrl: `https://confluence-${suffix}.example.test`,
  jiraClientId: `jira-client-${suffix}`,
  confluenceClientId: `confluence-client-${suffix}`,
  jiraClientSecret: `jira-secret-${suffix}`,
  confluenceClientSecret: `confluence-secret-${suffix}`,
  jiraScopes: ['read'],
  confluenceScopes: ['READ'],
  allowedProjectKeys: [`eng_${suffix}`],
  allowedSpaceKeys: [`space_${suffix}`],
  briefParentPageId: `parent-${suffix}`,
});

describe('IntegrationProfilesService', () => {
  it('encrypts secrets, keeps audit records secret-free, and atomically switches active profiles', async () => {
    const profiles: IntegrationProfile[] = [];
    const auditEvents: SecurityAuditEvent[] = [];
    let sequence = 0;
    let queryProfileId = '';
    const now = new Date('2026-08-02T00:00:00.000Z');
    type ProfileQueryBuilder = {
      addSelect: (columns: string[]) => ProfileQueryBuilder;
      where: (query: string, values: { id: string }) => ProfileQueryBuilder;
      getOne: () => Promise<IntegrationProfile | null>;
    };
    const profileQueryBuilder: ProfileQueryBuilder = {
      addSelect: () => profileQueryBuilder,
      where: (_query: string, values: { id: string }) => {
        queryProfileId = values.id;
        return profileQueryBuilder;
      },
      getOne: () =>
        Promise.resolve(
          profiles.find((profile) => profile.id === queryProfileId) ?? null,
        ),
    };
    const lockActiveProfile = jest.fn(() => Promise.resolve(undefined));
    const manager = {
      create: jest.fn(<T>(_entity: unknown, value: T): T => value),
      save: jest.fn((value: IntegrationProfile | SecurityAuditEvent) => {
        if ('action' in value) {
          auditEvents.push(value);
          return Promise.resolve(value);
        }

        const profile = value;
        if (!profile.id) {
          profile.id = `profile-${++sequence}`;
          profile.createdAt = now;
          profile.updatedAt = now;
          profiles.push(profile);
        }

        return Promise.resolve(profile);
      }),
      query: lockActiveProfile,
      update: jest.fn(
        (
          _entity: unknown,
          criteria: Partial<IntegrationProfile>,
          values: Partial<IntegrationProfile>,
        ) => {
          const matched = profiles.filter((profile) =>
            Object.entries(criteria).every(
              ([key, value]) =>
                profile[key as keyof IntegrationProfile] === value,
            ),
          );
          matched.forEach((profile) => Object.assign(profile, values));
          return Promise.resolve({ affected: matched.length });
        },
      ),
      delete: jest.fn(),
      getRepository: jest.fn(() => ({
        createQueryBuilder: () => profileQueryBuilder,
      })),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(
        (operation: (transactionManager: EntityManager) => unknown) =>
          operation(manager),
      ),
    } as unknown as DataSource;
    const profileRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
    } as unknown as Repository<IntegrationProfile>;
    const auditRepository = {
      manager,
    } as unknown as Repository<SecurityAuditEvent>;
    const cryptoService = {
      encrypt: jest.fn((value: string) => ({
        ciphertext: Buffer.from(value).toString('base64'),
        iv: 'iv',
        authenticationTag: 'tag',
        keyVersion: 1,
      })),
    } as unknown as IntegrationProfileCryptoService;
    const urlPolicy = {
      normalizeBaseUrl: jest.fn((value: string) => value),
    } as unknown as IntegrationProfileUrlPolicy;
    const service = new IntegrationProfilesService(
      profileRepository,
      auditRepository,
      dataSource,
      {
        get: jest.fn((key: string) =>
          key.includes('SCOPE_ALLOWLIST') ? 'READ,WRITE' : undefined,
        ),
      } as unknown as ConfigService,
      cryptoService,
      urlPolicy,
      {} as IntegrationProfileConnectionTestService,
    );

    const first = await service.create(profileDto('one'), 7, 'corr-1');
    const second = await service.create(profileDto('two'), 7, 'corr-2');
    await service.activate(first.id, 7, 'corr-3');
    const activatedSecond = await service.activate(second.id, 7, 'corr-4');

    expect(activatedSecond.isActive).toBe(true);
    expect(profiles.filter((profile) => profile.isActive)).toHaveLength(1);
    expect(profiles.find((profile) => profile.id === first.id)?.isActive).toBe(
      false,
    );
    expect(lockActiveProfile).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtext('integration_profiles.active'))",
    );
    expect(first).toEqual(
      expect.objectContaining({
        jiraClientSecretConfigured: true,
        confluenceClientSecretConfigured: true,
      }),
    );
    expect(first).not.toHaveProperty('jiraClientSecret');
    expect(first).not.toHaveProperty('confluenceClientSecret');
    expect(JSON.stringify(auditEvents)).not.toContain('jira-secret-one');
    expect(JSON.stringify(auditEvents)).not.toContain('confluence-secret-one');
    expect(auditEvents.map((event) => event.action)).toContain(
      'INTEGRATION_PROFILE_ACTIVATED',
    );
  });

  it('rejects broad or empty scope and resource allowlists before they are stored', async () => {
    const cryptoService = {
      encrypt: jest.fn(() => ({
        ciphertext: 'ciphertext',
        iv: 'iv',
        authenticationTag: 'tag',
        keyVersion: 1,
      })),
    } as unknown as IntegrationProfileCryptoService;
    const service = new IntegrationProfilesService(
      {} as Repository<IntegrationProfile>,
      {} as Repository<SecurityAuditEvent>,
      {} as DataSource,
      {
        get: jest.fn().mockReturnValue('READ,WRITE'),
      } as unknown as ConfigService,
      cryptoService,
      {
        normalizeBaseUrl: jest.fn((value: string) => value),
      } as unknown as IntegrationProfileUrlPolicy,
      {} as IntegrationProfileConnectionTestService,
    );

    await expect(
      service.create(
        { ...profileDto('invalid-scope'), jiraScopes: ['READ_ALL'] },
        7,
        'corr-5',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(
        { ...profileDto('empty-project'), allowedProjectKeys: ['   '] },
        7,
        'corr-6',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
