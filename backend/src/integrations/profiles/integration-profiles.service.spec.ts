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
  childTaskIssueTypeId: '10001',
  childTaskTemplateFields: { customfield_10100: `value-${suffix}` },
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
        childTaskIssueTypeId: '10001',
        childTaskTemplateFields: { customfield_10100: 'value-one' },
      }),
    );
    expect(first).not.toHaveProperty('jiraClientSecret');
    expect(first).not.toHaveProperty('confluenceClientSecret');
    expect(JSON.stringify(auditEvents)).not.toContain('jira-secret-one');
    expect(JSON.stringify(auditEvents)).not.toContain('confluence-secret-one');
    expect(auditEvents.map((event) => event.action)).toContain(
      'INTEGRATION_PROFILE_ACTIVATED',
    );

    const deactivated = await service.deactivate(second.id, 7, 'corr-5');
    expect(deactivated.isActive).toBe(false);
    expect(profiles.filter((profile) => profile.isActive)).toHaveLength(0);
    expect(auditEvents.map((event) => event.action)).toContain(
      'INTEGRATION_PROFILE_DEACTIVATED',
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
        { ...profileDto('invalidscope'), jiraScopes: ['READ_ALL'] },
        7,
        'corr-5',
      ),
    ).rejects.toMatchObject({
      diagnosticCode: 'INTEGRATION_PROFILE_SCOPE_NOT_ALLOWLISTED',
    });
    await expect(
      service.create(
        { ...profileDto('emptyproject'), allowedProjectKeys: ['   '] },
        7,
        'corr-6',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(
        {
          ...profileDto('templatesecret'),
          childTaskTemplateFields: {
            customfield_10100: 'sk-proj-abc123456789',
          },
        },
        7,
        'corr-7',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rotates a profile-specific webhook route secret without returning it or writing it to audit metadata', async () => {
    const now = new Date('2026-08-02T00:00:00.000Z');
    const profile = {
      id: '11111111-1111-4111-8111-111111111111',
      jiraBaseUrl: 'https://jira.example.test',
      confluenceBaseUrl: 'https://confluence.example.test',
      jiraClientId: 'jira-client',
      confluenceClientId: 'confluence-client',
      jiraClientSecretCiphertext: 'jira-ciphertext',
      jiraClientSecretIv: 'jira-iv',
      jiraClientSecretTag: 'jira-tag',
      confluenceClientSecretCiphertext: 'confluence-ciphertext',
      confluenceClientSecretIv: 'confluence-iv',
      confluenceClientSecretTag: 'confluence-tag',
      webhookRouteSecretCiphertext: null,
      webhookRouteSecretIv: null,
      webhookRouteSecretTag: null,
      encryptionKeyVersion: 1,
      allowedProjectKeys: ['ENG'],
      allowedSpaceKeys: ['ENG'],
      briefParentPageId: 'parent-1',
      policy: { oauthScopes: { jira: ['READ'], confluence: ['READ'] } },
      isActive: false,
      createdAt: now,
      updatedAt: now,
    } as IntegrationProfile;
    const auditEvents: SecurityAuditEvent[] = [];
    const profileQuery = {
      addSelect: jest.fn(),
      where: jest.fn(),
      getOne: jest.fn(() => Promise.resolve(profile)),
    };
    profileQuery.addSelect.mockReturnValue(profileQuery);
    profileQuery.where.mockReturnValue(profileQuery);
    const manager = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => profileQuery),
      })),
      create: jest.fn(<T>(_entity: unknown, value: T) => value),
      save: jest.fn((value: IntegrationProfile | SecurityAuditEvent) => {
        if ('action' in value) {
          auditEvents.push(value);
        }
        return Promise.resolve(value);
      }),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(
        (operation: (transactionManager: EntityManager) => unknown) =>
          operation(manager),
      ),
    } as unknown as DataSource;
    const routeSecret = 'rotating-route-secret-1234';
    const service = new IntegrationProfilesService(
      {} as Repository<IntegrationProfile>,
      { manager } as Repository<SecurityAuditEvent>,
      dataSource,
      {} as ConfigService,
      {
        currentKeyVersion: jest.fn(() => 2),
        decrypt: jest.fn(
          (value: { ciphertext: string }) => `plain-${value.ciphertext}`,
        ),
        encrypt: jest.fn((value: string) => ({
          ciphertext: `${value}-ciphertext`,
          iv: 'iv',
          authenticationTag: 'tag',
          keyVersion: 2,
        })),
      } as unknown as IntegrationProfileCryptoService,
      {} as IntegrationProfileUrlPolicy,
      {} as IntegrationProfileConnectionTestService,
    );

    const response = await service.rotateWebhookRouteSecret(
      profile.id,
      { webhookRouteSecret: routeSecret },
      7,
      'webhook-correlation-1',
    );

    expect(response.webhookRouteSecretConfigured).toBe(true);
    expect(response).not.toHaveProperty('webhookRouteSecret');
    expect(profile.encryptionKeyVersion).toBe(2);
    expect(profile.jiraClientSecretCiphertext).toBe(
      'plain-jira-ciphertext-ciphertext',
    );
    expect(profile.confluenceClientSecretCiphertext).toBe(
      'plain-confluence-ciphertext-ciphertext',
    );
    expect(JSON.stringify(auditEvents)).not.toContain(routeSecret);
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'WEBHOOK_ROUTE_SECRET_ROTATED' }),
      ]),
    );
  });
});
