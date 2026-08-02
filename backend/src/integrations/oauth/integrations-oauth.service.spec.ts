import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  AtlassianOAuthClientService,
  ProviderReauthorizationRequiredError,
} from './atlassian-oauth-client.service';
import { AtlassianOAuthConnection } from './entities/atlassian-oauth-connection.entity';
import { OAuthAuthorizationAttempt } from './entities/oauth-authorization-attempt.entity';
import { IntegrationsOAuthService } from './integrations-oauth.service';
import { IntegrationProfile } from '../profiles/entities/integration-profile.entity';
import { SecurityAuditEvent } from '../profiles/entities/security-audit-event.entity';
import { IntegrationProfileCryptoService } from '../profiles/integration-profile-crypto.service';

const profileId = 'e2eef39f-cf17-4ef9-a780-b6e6f9b7dcf4';
const secretCiphertext = Buffer.from('client-secret').toString('base64');

type TestHarness = ReturnType<typeof makeHarness>;

function makeHarness() {
  const profile: IntegrationProfile = {
    id: profileId,
    jiraBaseUrl: 'https://jira.example.test/',
    confluenceBaseUrl: 'https://confluence.example.test/',
    jiraClientId: 'jira-client',
    confluenceClientId: 'confluence-client',
    jiraClientSecretCiphertext: secretCiphertext,
    jiraClientSecretIv: 'iv',
    jiraClientSecretTag: 'tag',
    confluenceClientSecretCiphertext: secretCiphertext,
    confluenceClientSecretIv: 'iv',
    confluenceClientSecretTag: 'tag',
    webhookRouteSecretCiphertext: secretCiphertext,
    webhookRouteSecretIv: 'iv',
    webhookRouteSecretTag: 'tag',
    encryptionKeyVersion: 1,
    allowedProjectKeys: ['ENG'],
    allowedSpaceKeys: ['ENG'],
    briefParentPageId: null,
    policy: { oauthScopes: { jira: ['READ'], confluence: ['READ'] } },
    isActive: true,
    createdAt: new Date('2026-08-02T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  };
  const attempts: OAuthAuthorizationAttempt[] = [];
  const connections: AtlassianOAuthConnection[] = [];
  const auditEvents: SecurityAuditEvent[] = [];
  let id = 0;

  const profileUpdate = jest.fn(
    (_criteria: unknown, values: Partial<IntegrationProfile>) => {
      Object.assign(profile, values);
      return Promise.resolve({ affected: 1 });
    },
  );
  const profileRepository = {
    createQueryBuilder: jest.fn(() => {
      let requestedProfileId: string | undefined;
      const query = {
        where: () => query,
        andWhere: (_sql: string, values: { id?: string }) => {
          requestedProfileId = values.id;
          return query;
        },
        addSelect: () => query,
        getOne: () =>
          Promise.resolve(
            !requestedProfileId || requestedProfileId === profile.id
              ? profile
              : null,
          ),
      };
      return query;
    }),
    update: profileUpdate,
  } as unknown as Repository<IntegrationProfile>;

  const attemptsRepository = {
    findOne: jest.fn(() =>
      Promise.resolve(attempts.find((attempt) => !attempt.consumedAt) ?? null),
    ),
    update: jest.fn(
      (_criteria: unknown, values: Partial<OAuthAuthorizationAttempt>) => {
        const attempt = attempts.find((candidate) => !candidate.consumedAt);

        if (!attempt) {
          return Promise.resolve({ affected: 0 });
        }

        Object.assign(attempt, values);
        return Promise.resolve({ affected: 1 });
      },
    ),
  } as unknown as Repository<OAuthAuthorizationAttempt>;

  const connectionsRepository = {
    find: jest.fn(
      ({
        where,
      }: {
        where: Pick<AtlassianOAuthConnection, 'userId' | 'profileId'>;
      }) =>
        Promise.resolve(
          connections.filter(
            (connection) =>
              connection.userId === where.userId &&
              connection.profileId === where.profileId,
          ),
        ),
    ),
  } as unknown as Repository<AtlassianOAuthConnection>;

  const connectionQuery = () => {
    const filters: Partial<AtlassianOAuthConnection> = {};
    const query = {
      where: (_sql: string, values: Partial<AtlassianOAuthConnection>) => {
        Object.assign(filters, values);
        return query;
      },
      andWhere: (_sql: string, values: Partial<AtlassianOAuthConnection>) => {
        Object.assign(filters, values);
        return query;
      },
      addSelect: () => query,
      getOne: () =>
        Promise.resolve(
          connections.find(
            (connection) =>
              connection.userId === filters.userId &&
              connection.profileId === filters.profileId &&
              connection.provider === filters.provider,
          ) ?? null,
        ),
    };
    return query;
  };

  const save = jest.fn((value: unknown) => {
    if (isAuditEvent(value)) {
      auditEvents.push(value);
      return Promise.resolve(value);
    }

    if (isAuthorizationAttempt(value)) {
      value.id ||= `attempt-${++id}`;
      if (!attempts.includes(value)) {
        attempts.push(value);
      }
      return Promise.resolve(value);
    }

    if (isConnection(value)) {
      value.id ||= `connection-${++id}`;
      if (!connections.includes(value)) {
        connections.push(value);
      }
      return Promise.resolve(value);
    }

    return Promise.resolve(value);
  });
  const manager = {
    create: jest.fn(<T>(_entity: unknown, value: T): T => value),
    save,
    remove: jest.fn((value: AtlassianOAuthConnection) => {
      const index = connections.indexOf(value);
      if (index >= 0) {
        connections.splice(index, 1);
      }
      return Promise.resolve(value);
    }),
    query: jest.fn(() => Promise.resolve()),
    getRepository: jest.fn(() => ({ createQueryBuilder: connectionQuery })),
  } as unknown as EntityManager;

  let pendingTransaction = Promise.resolve();
  const dataSource = {
    transaction: jest.fn(
      async (operation: (manager: EntityManager) => unknown) => {
        const previous = pendingTransaction;
        let release: (() => void) | undefined;
        pendingTransaction = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;

        try {
          return await operation(manager);
        } finally {
          release?.();
        }
      },
    ),
  } as unknown as DataSource;

  const currentKeyVersion = jest.fn(() => 1);
  const needsReencryption = jest.fn((keyVersion: number) => keyVersion !== 1);
  const decrypt = jest.fn((value: { ciphertext: string }) =>
    Buffer.from(value.ciphertext, 'base64').toString(),
  );
  const crypto = {
    encrypt: jest.fn((value: string) => ({
      ciphertext: Buffer.from(value).toString('base64'),
      iv: 'iv',
      authenticationTag: 'tag',
      keyVersion: 1,
    })),
    decrypt,
    currentKeyVersion,
    needsReencryption,
  } as unknown as IntegrationProfileCryptoService;
  const createAuthorizationUrl = jest.fn(
    (_configuration: unknown, state: string, verifier: string) =>
      Promise.resolve(
        `https://jira.example.test/authorize?state=${state}&challenge=${verifier}`,
      ),
  );
  const exchangeAuthorizationCode = jest.fn(() =>
    Promise.resolve({
      accessToken: 'access-token-user-a',
      refreshToken: 'refresh-token-user-a',
      expiresAt: new Date(Date.now() + 60_000),
    }),
  );
  const refresh = jest.fn();
  const revoke = jest.fn(() => Promise.resolve());
  const oauthClient = {
    configurationFromProfile: jest.fn((provider: 'jira' | 'confluence') => ({
      provider,
      baseUrl: `${provider === 'jira' ? 'https://jira' : 'https://confluence'}.example.test/`,
      clientId: `${provider}-client`,
      clientSecret: 'client-secret',
      scopes: ['READ'],
      redirectUri: `https://api.example.test/integrations/${provider}/callback`,
    })),
    createAuthorizationUrl,
    exchangeAuthorizationCode,
    refresh,
    revoke,
  } as unknown as AtlassianOAuthClientService;
  const service = new IntegrationsOAuthService(
    profileRepository,
    attemptsRepository,
    connectionsRepository,
    { manager } as unknown as Repository<SecurityAuditEvent>,
    dataSource,
    crypto,
    oauthClient,
  );

  return {
    service,
    attempts,
    connections,
    auditEvents,
    oauthClient,
    exchangeAuthorizationCode,
    refresh,
    revoke,
    crypto,
    profile,
    profileUpdate,
    currentKeyVersion,
    decrypt,
    needsReencryption,
    save,
    manager,
  };
}

function isAuditEvent(value: unknown): value is SecurityAuditEvent {
  return typeof value === 'object' && value !== null && 'action' in value;
}

function isAuthorizationAttempt(
  value: unknown,
): value is OAuthAuthorizationAttempt {
  return typeof value === 'object' && value !== null && 'stateHash' in value;
}

function isConnection(value: unknown): value is AtlassianOAuthConnection {
  return (
    typeof value === 'object' && value !== null && 'tokensCiphertext' in value
  );
}

describe('IntegrationsOAuthService', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = makeHarness();
  });

  it('keeps authorization state single-use and stores an encrypted token pair only for its user', async () => {
    const {
      service,
      attempts,
      connections,
      auditEvents,
      exchangeAuthorizationCode,
    } = harness;

    const started = await service.createAuthorizationUrl('jira', 101, 'corr-a');
    const state = new URL(started.authorizationUrl).searchParams.get('state');

    expect(state).toBeTruthy();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].userId).toBe(101);
    expect(attempts[0].stateHash).not.toBe(state);
    expect(attempts[0].pkceVerifierCiphertext).not.toBe(
      new URL(started.authorizationUrl).searchParams.get('challenge'),
    );

    await service.completeAuthorization(
      'jira',
      'authorization-code',
      state as string,
      101,
      'corr-b',
    );

    expect(connections).toHaveLength(1);
    expect(connections[0]).toEqual(
      expect.objectContaining({
        userId: 101,
        profileId,
        provider: 'jira',
        status: 'connected',
        tokenVersion: 1,
      }),
    );
    expect(connections[0].tokensCiphertext).not.toContain(
      'access-token-user-a',
    );
    await expect(service.list(101)).resolves.toEqual([
      { provider: 'jira', status: 'connected' },
      { provider: 'confluence', status: 'authorization_required' },
    ]);
    await expect(service.list(202)).resolves.toEqual([
      { provider: 'jira', status: 'authorization_required' },
      { provider: 'confluence', status: 'authorization_required' },
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain('access-token-user-a');
    expect(JSON.stringify(auditEvents)).not.toContain('refresh-token-user-a');

    await expect(
      service.completeAuthorization(
        'jira',
        'authorization-code',
        state as string,
        101,
        'corr-c',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
  });

  it('re-encrypts all profile secrets when a legacy profile is read for OAuth', async () => {
    const { service, profile, profileUpdate, decrypt } = harness;
    profile.encryptionKeyVersion = 0;
    profile.jiraClientSecretCiphertext = Buffer.from(
      'legacy-jira-client-secret',
    ).toString('base64');
    profile.confluenceClientSecretCiphertext = Buffer.from(
      'legacy-confluence-client-secret',
    ).toString('base64');
    profile.webhookRouteSecretCiphertext = Buffer.from(
      'legacy-webhook-route-secret',
    ).toString('base64');

    const result = await service.createAuthorizationUrl(
      'jira',
      101,
      'corr-profile-rotation',
    );

    expect(typeof result.authorizationUrl).toBe('string');

    expect(profileUpdate).toHaveBeenCalledWith(
      { id: profileId, encryptionKeyVersion: 0 },
      expect.objectContaining({ encryptionKeyVersion: 1 }),
    );
    expect(profile.encryptionKeyVersion).toBe(1);
    expect(decrypt).toHaveBeenCalledWith(
      expect.objectContaining({
        ciphertext: Buffer.from('legacy-jira-client-secret').toString('base64'),
        keyVersion: 0,
      }),
    );
    expect(JSON.stringify(profileUpdate.mock.calls)).not.toContain(
      'legacy-jira-client-secret',
    );
    expect(JSON.stringify(profileUpdate.mock.calls)).not.toContain(
      'legacy-confluence-client-secret',
    );
    expect(JSON.stringify(profileUpdate.mock.calls)).not.toContain(
      'legacy-webhook-route-secret',
    );
  });

  it('rejects a callback state from a different signed-in user before token exchange', async () => {
    const { service, exchangeAuthorizationCode } = harness;
    const started = await service.createAuthorizationUrl('jira', 101, 'corr-a');
    const state = new URL(started.authorizationUrl).searchParams.get('state');

    await expect(
      service.completeAuthorization(
        'jira',
        'authorization-code',
        state as string,
        202,
        'corr-b',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('serializes refresh rotation so concurrent calls retain one latest token pair', async () => {
    const { service, connections, refresh, crypto } = harness;
    const encrypted = crypto.encrypt(
      JSON.stringify({
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
      }),
    );
    connections.push({
      id: 'connection-1',
      userId: 101,
      profileId,
      provider: 'jira',
      tokensCiphertext: encrypted.ciphertext,
      tokensIv: encrypted.iv,
      tokensTag: encrypted.authenticationTag,
      encryptionKeyVersion: encrypted.keyVersion,
      tokenExpiresAt: new Date(Date.now() - 1),
      tokenVersion: 1,
      status: 'connected',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    refresh.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.list(101)).resolves.toEqual([
      { provider: 'jira', status: 'expired' },
      { provider: 'confluence', status: 'authorization_required' },
    ]);

    await expect(
      Promise.all([
        service.getAccessToken(101, 'jira', 'corr-a'),
        service.getAccessToken(101, 'jira', 'corr-b'),
      ]),
    ).resolves.toEqual(['new-access', 'new-access']);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(connections).toHaveLength(1);
    expect(connections[0].tokenVersion).toBe(2);
    expect(
      crypto.decrypt({ ciphertext: connections[0].tokensCiphertext }),
    ).toBe(
      JSON.stringify({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }),
    );
  });

  it('re-encrypts a still-valid legacy token pair when it is read', async () => {
    const { service, connections, crypto, needsReencryption, save } = harness;
    const encrypted = crypto.encrypt(
      JSON.stringify({
        accessToken: 'legacy-access',
        refreshToken: 'legacy-refresh',
      }),
    );
    connections.push({
      id: 'connection-legacy',
      userId: 101,
      profileId,
      provider: 'jira',
      tokensCiphertext: encrypted.ciphertext,
      tokensIv: encrypted.iv,
      tokensTag: encrypted.authenticationTag,
      encryptionKeyVersion: 0,
      tokenExpiresAt: new Date(Date.now() + 60_000),
      tokenVersion: 1,
      status: 'connected',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.getAccessToken(101, 'jira', 'corr-legacy'),
    ).resolves.toBe('legacy-access');

    expect(needsReencryption).toHaveBeenCalledWith(0);
    expect(connections[0]).toEqual(
      expect.objectContaining({
        encryptionKeyVersion: 1,
        tokenVersion: 1,
      }),
    );
    expect(connections[0]?.tokenExpiresAt).toBeInstanceOf(Date);
    expect(JSON.stringify(save.mock.calls)).not.toContain('legacy-access');
    expect(JSON.stringify(save.mock.calls)).not.toContain('legacy-refresh');
  });

  it('revokes when possible and always removes only the current user connection', async () => {
    const { service, connections, revoke, crypto } = harness;
    const encrypted = crypto.encrypt(
      JSON.stringify({
        accessToken: 'access-token-user-a',
        refreshToken: 'refresh-token-user-a',
      }),
    );
    connections.push({
      id: 'connection-1',
      userId: 101,
      profileId,
      provider: 'jira',
      tokensCiphertext: encrypted.ciphertext,
      tokensIv: encrypted.iv,
      tokensTag: encrypted.authenticationTag,
      encryptionKeyVersion: encrypted.keyVersion,
      tokenExpiresAt: new Date(Date.now() + 60_000),
      tokenVersion: 1,
      status: 'connected',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(service.disconnect('jira', 101, 'corr-a')).resolves.toEqual({
      disconnected: true,
    });

    expect(revoke).toHaveBeenCalledWith(
      expect.any(Object),
      'refresh-token-user-a',
    );
    expect(connections).toEqual([]);
    await expect(service.list(202)).resolves.toEqual([
      { provider: 'jira', status: 'authorization_required' },
      { provider: 'confluence', status: 'authorization_required' },
    ]);
  });

  it('removes the local credential even when remote revocation is unavailable', async () => {
    const { service, connections, revoke, crypto } = harness;
    const encrypted = crypto.encrypt(
      JSON.stringify({
        accessToken: 'access-token-user-a',
        refreshToken: 'refresh-token-user-a',
      }),
    );
    connections.push({
      id: 'connection-1',
      userId: 101,
      profileId,
      provider: 'jira',
      tokensCiphertext: encrypted.ciphertext,
      tokensIv: encrypted.iv,
      tokensTag: encrypted.authenticationTag,
      encryptionKeyVersion: encrypted.keyVersion,
      tokenExpiresAt: new Date(Date.now() + 60_000),
      tokenVersion: 1,
      status: 'connected',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    revoke.mockRejectedValue(new Error('provider unavailable'));

    await expect(service.disconnect('jira', 101, 'corr-a')).resolves.toEqual({
      disconnected: true,
    });
    expect(connections).toEqual([]);
  });

  it('turns provider reauthorization failures into a safe reconnect state', async () => {
    const { service, connections, refresh, crypto } = harness;
    const encrypted = crypto.encrypt(
      JSON.stringify({
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
      }),
    );
    connections.push({
      id: 'connection-1',
      userId: 101,
      profileId,
      provider: 'jira',
      tokensCiphertext: encrypted.ciphertext,
      tokensIv: encrypted.iv,
      tokensTag: encrypted.authenticationTag,
      encryptionKeyVersion: encrypted.keyVersion,
      tokenExpiresAt: new Date(Date.now() - 1),
      tokenVersion: 1,
      status: 'connected',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    refresh.mockRejectedValue(new ProviderReauthorizationRequiredError());

    await expect(service.getAccessToken(101, 'jira')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.list(101)).resolves.toEqual([
      { provider: 'jira', status: 'reauthorization_required' },
      { provider: 'confluence', status: 'authorization_required' },
    ]);
  });
});
