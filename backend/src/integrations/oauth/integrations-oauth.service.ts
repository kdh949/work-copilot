import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import {
  DataSource,
  EntityManager,
  IsNull,
  MoreThan,
  Repository,
} from 'typeorm';
import {
  AtlassianOAuthConnection,
  type OAuthConnectionStatus,
} from './entities/atlassian-oauth-connection.entity';
import { OAuthAuthorizationAttempt } from './entities/oauth-authorization-attempt.entity';
import {
  AtlassianOAuthClientService,
  type OAuthClientConfiguration,
  type OAuthTokenPair,
  ProviderReauthorizationRequiredError,
} from './atlassian-oauth-client.service';
import { IntegrationProfile } from '../profiles/entities/integration-profile.entity';
import { SecurityAuditEvent } from '../profiles/entities/security-audit-event.entity';
import {
  IntegrationProfileCryptoService,
  type EncryptedProfileSecret,
} from '../profiles/integration-profile-crypto.service';
import type { IntegrationProvider } from '../profiles/integration-profile-url.policy';

const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 30 * 1000;

type StoredTokenPair = {
  accessToken: string;
  refreshToken: string | null;
};

export type IntegrationConnectionResponse = {
  provider: IntegrationProvider;
  status: OAuthConnectionStatus | 'authorization_required';
};

@Injectable()
export class IntegrationsOAuthService {
  constructor(
    @InjectRepository(IntegrationProfile)
    private readonly profilesRepository: Repository<IntegrationProfile>,
    @InjectRepository(OAuthAuthorizationAttempt)
    private readonly attemptsRepository: Repository<OAuthAuthorizationAttempt>,
    @InjectRepository(AtlassianOAuthConnection)
    private readonly connectionsRepository: Repository<AtlassianOAuthConnection>,
    @InjectRepository(SecurityAuditEvent)
    private readonly auditRepository: Repository<SecurityAuditEvent>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cryptoService: IntegrationProfileCryptoService,
    private readonly oauthClient: AtlassianOAuthClientService,
  ) {}

  async list(userId: number): Promise<IntegrationConnectionResponse[]> {
    const profile = await this.findActiveProfile();

    if (!profile) {
      return [];
    }

    const connections = await this.connectionsRepository.find({
      where: { userId, profileId: profile.id },
    });
    const connectionByProvider = new Map(
      connections.map((connection) => [connection.provider, connection]),
    );

    return (['jira', 'confluence'] as const).map((provider) => {
      const connection = connectionByProvider.get(provider);

      return {
        provider,
        status: connection
          ? this.safeStatus(connection)
          : 'authorization_required',
      };
    });
  }

  async createAuthorizationUrl(
    providerValue: string,
    userId: number,
    correlationId: string,
  ): Promise<{ authorizationUrl: string }> {
    const provider = this.provider(providerValue);
    const profile = await this.findActiveProfile(undefined, true);

    if (!profile) {
      throw new ConflictException('An active integration profile is required.');
    }

    const state = this.randomUrlSafeValue();
    const verifier = this.randomUrlSafeValue(48);
    const encryptedVerifier = this.cryptoService.encrypt(verifier);
    const configuration = this.configuration(profile, provider);
    const authorizationUrl = await this.oauthClient.createAuthorizationUrl(
      configuration,
      state,
      verifier,
    );

    await this.dataSource.transaction(async (manager) => {
      const attempt = manager.create(OAuthAuthorizationAttempt, {
        provider,
        userId,
        profileId: profile.id,
        stateHash: this.hash(state),
        pkceVerifierCiphertext: encryptedVerifier.ciphertext,
        pkceVerifierIv: encryptedVerifier.iv,
        pkceVerifierTag: encryptedVerifier.authenticationTag,
        encryptionKeyVersion: encryptedVerifier.keyVersion,
        expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
        consumedAt: null,
      });
      await manager.save(attempt);
      await this.writeAudit(
        manager,
        userId,
        'OAUTH_AUTHORIZATION_STARTED',
        profile.id,
        null,
        correlationId,
        'STARTED',
      );
    });

    return { authorizationUrl };
  }

  async completeAuthorization(
    providerValue: string,
    code: string,
    state: string,
    userId: number,
    correlationId: string,
  ): Promise<void> {
    const provider = this.provider(providerValue);

    if (
      !this.isBoundedCallbackValue(code) ||
      !this.isBoundedCallbackValue(state)
    ) {
      throw new UnauthorizedException('OAuth callback is invalid.');
    }

    const attempt = await this.consumeAttempt(state);

    if (attempt.provider !== provider || attempt.userId !== userId) {
      throw new UnauthorizedException('OAuth callback is invalid.');
    }

    try {
      const profile = await this.findActiveProfile(attempt.profileId, true);

      if (!profile) {
        throw new ConflictException(
          'The integration profile is no longer active.',
        );
      }

      const verifier = this.cryptoService.decrypt({
        ciphertext: attempt.pkceVerifierCiphertext,
        iv: attempt.pkceVerifierIv,
        authenticationTag: attempt.pkceVerifierTag,
        keyVersion: attempt.encryptionKeyVersion,
      });
      const tokenPair = await this.oauthClient.exchangeAuthorizationCode(
        this.configuration(profile, provider),
        code,
        verifier,
      );
      await this.storeTokenPair(
        userId,
        profile.id,
        provider,
        tokenPair,
        correlationId,
      );
    } catch (error) {
      await this.writeAudit(
        this.auditRepository.manager,
        userId,
        'OAUTH_AUTHORIZATION_COMPLETED',
        attempt.profileId,
        null,
        correlationId,
        'FAILED',
      );
      throw error;
    }
  }

  async getAccessToken(
    userId: number,
    providerValue: string,
    correlationId = 'missing-correlation-id',
  ): Promise<string> {
    const provider = this.provider(providerValue);
    const profile = await this.findActiveProfile(undefined, true);

    if (!profile) {
      throw new ConflictException('An active integration profile is required.');
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockConnection(manager, userId, profile.id, provider);
        const connection = await this.findConnection(
          manager,
          userId,
          profile.id,
          provider,
          true,
        );

        if (!connection || connection.status === 'reauthorization_required') {
          throw new ProviderReauthorizationRequiredError();
        }

        const tokens = this.tokensFromConnection(connection);

        if (
          connection.tokenExpiresAt &&
          connection.tokenExpiresAt.getTime() >
            Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS
        ) {
          return tokens.accessToken;
        }

        if (!tokens.refreshToken) {
          throw new ProviderReauthorizationRequiredError();
        }

        const refreshed = await this.oauthClient.refresh(
          this.configuration(profile, provider),
          tokens.refreshToken,
        );
        const nextPair: OAuthTokenPair = {
          ...refreshed,
          refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
        };
        this.assignTokenPair(connection, nextPair);
        connection.tokenVersion += 1;
        connection.status = 'connected';
        await manager.save(connection);
        await this.writeAudit(
          manager,
          userId,
          'OAUTH_TOKEN_REFRESHED',
          profile.id,
          connection.id,
          correlationId,
          'REFRESHED',
        );

        return nextPair.accessToken;
      });
    } catch (error) {
      if (!(error instanceof ProviderReauthorizationRequiredError)) {
        throw error;
      }

      await this.markReauthorizationRequired(
        userId,
        profile.id,
        provider,
        correlationId,
      );
      throw new ConflictException('Reconnect the integration to continue.');
    }
  }

  async disconnect(
    providerValue: string,
    userId: number,
    correlationId: string,
  ): Promise<{ disconnected: true }> {
    const provider = this.provider(providerValue);
    const profile = await this.findActiveProfile(undefined, true);

    if (!profile) {
      return { disconnected: true };
    }

    return this.dataSource.transaction(async (manager) => {
      await this.lockConnection(manager, userId, profile.id, provider);
      const connection = await this.findConnection(
        manager,
        userId,
        profile.id,
        provider,
        true,
      );

      if (!connection) {
        await this.writeAudit(
          manager,
          userId,
          'OAUTH_CONNECTION_DISCONNECTED',
          profile.id,
          null,
          correlationId,
          'ALREADY_DISCONNECTED',
        );
        return { disconnected: true };
      }

      let tokens: StoredTokenPair | null = null;

      try {
        tokens = this.tokensFromConnection(connection);
      } catch {
        // A corrupt local token must not prevent a user from disconnecting.
      }

      if (tokens?.refreshToken) {
        try {
          await this.oauthClient.revoke(
            this.configuration(profile, provider),
            tokens.refreshToken,
          );
        } catch {
          // Removing a local user credential must not depend on provider availability.
        }
      }

      await manager.remove(connection);
      await this.writeAudit(
        manager,
        userId,
        'OAUTH_CONNECTION_DISCONNECTED',
        profile.id,
        connection.id,
        correlationId,
        'DISCONNECTED',
      );

      return { disconnected: true };
    });
  }

  private async consumeAttempt(
    state: string,
  ): Promise<OAuthAuthorizationAttempt> {
    const attempt = await this.attemptsRepository.findOne({
      where: {
        stateHash: this.hash(state),
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      select: {
        id: true,
        provider: true,
        userId: true,
        profileId: true,
        stateHash: true,
        pkceVerifierCiphertext: true,
        pkceVerifierIv: true,
        pkceVerifierTag: true,
        encryptionKeyVersion: true,
        expiresAt: true,
        consumedAt: true,
      },
    });

    if (!attempt || attempt.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('OAuth callback is invalid or expired.');
    }

    const update = await this.attemptsRepository.update(
      {
        id: attempt.id,
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      { consumedAt: new Date() },
    );

    if (update.affected !== 1) {
      throw new UnauthorizedException('OAuth callback is invalid or expired.');
    }

    return attempt;
  }

  private async storeTokenPair(
    userId: number,
    profileId: string,
    provider: IntegrationProvider,
    tokenPair: OAuthTokenPair,
    correlationId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockConnection(manager, userId, profileId, provider);
      const existing = await this.findConnection(
        manager,
        userId,
        profileId,
        provider,
        true,
      );
      const connection =
        existing ??
        manager.create(AtlassianOAuthConnection, {
          userId,
          profileId,
          provider,
          tokenVersion: 0,
          status: 'connected',
        });

      this.assignTokenPair(connection, tokenPair);
      connection.tokenVersion += 1;
      connection.status = 'connected';
      const savedConnection = await manager.save(connection);
      await this.writeAudit(
        manager,
        userId,
        'OAUTH_AUTHORIZATION_COMPLETED',
        profileId,
        savedConnection.id,
        correlationId,
        'CONNECTED',
      );
    });
  }

  private async markReauthorizationRequired(
    userId: number,
    profileId: string,
    provider: IntegrationProvider,
    correlationId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockConnection(manager, userId, profileId, provider);
      const connection = await this.findConnection(
        manager,
        userId,
        profileId,
        provider,
        false,
      );

      if (!connection) {
        return;
      }

      connection.status = 'reauthorization_required';
      await manager.save(connection);
      await this.writeAudit(
        manager,
        userId,
        'OAUTH_REAUTHORIZATION_REQUIRED',
        profileId,
        connection.id,
        correlationId,
        'RECONNECT_REQUIRED',
      );
    });
  }

  private async findActiveProfile(
    id?: string,
    includeClientSecrets = false,
  ): Promise<IntegrationProfile | null> {
    const query = this.profilesRepository
      .createQueryBuilder('profile')
      .where('profile.isActive = :isActive', { isActive: true });

    if (id) {
      query.andWhere('profile.id = :id', { id });
    }

    if (includeClientSecrets) {
      query.addSelect([
        'profile.jiraClientSecretCiphertext',
        'profile.jiraClientSecretIv',
        'profile.jiraClientSecretTag',
        'profile.confluenceClientSecretCiphertext',
        'profile.confluenceClientSecretIv',
        'profile.confluenceClientSecretTag',
      ]);
    }

    return query.getOne();
  }

  private configuration(
    profile: IntegrationProfile,
    provider: IntegrationProvider,
  ): OAuthClientConfiguration {
    const encryptedSecret =
      provider === 'jira'
        ? {
            ciphertext: profile.jiraClientSecretCiphertext,
            iv: profile.jiraClientSecretIv,
            authenticationTag: profile.jiraClientSecretTag,
          }
        : {
            ciphertext: profile.confluenceClientSecretCiphertext,
            iv: profile.confluenceClientSecretIv,
            authenticationTag: profile.confluenceClientSecretTag,
          };

    if (
      !encryptedSecret.ciphertext ||
      !encryptedSecret.iv ||
      !encryptedSecret.authenticationTag
    ) {
      throw new ServiceUnavailableException(
        'Integration client credentials are unavailable.',
      );
    }

    return this.oauthClient.configurationFromProfile(
      provider,
      profile,
      this.cryptoService.decrypt({
        ...encryptedSecret,
        keyVersion: profile.encryptionKeyVersion,
      } as EncryptedProfileSecret),
    );
  }

  private async findConnection(
    manager: EntityManager,
    userId: number,
    profileId: string,
    provider: IntegrationProvider,
    includeTokens: boolean,
  ): Promise<AtlassianOAuthConnection | null> {
    const query = manager
      .getRepository(AtlassianOAuthConnection)
      .createQueryBuilder('connection')
      .where('connection.userId = :userId', { userId })
      .andWhere('connection.profileId = :profileId', { profileId })
      .andWhere('connection.provider = :provider', { provider });

    if (includeTokens) {
      query.addSelect([
        'connection.tokensCiphertext',
        'connection.tokensIv',
        'connection.tokensTag',
      ]);
    }

    return query.getOne();
  }

  private async lockConnection(
    manager: EntityManager,
    userId: number,
    profileId: string,
    provider: IntegrationProvider,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `oauth-connection:${userId}:${profileId}:${provider}`,
    ]);
  }

  private assignTokenPair(
    connection: AtlassianOAuthConnection,
    tokenPair: OAuthTokenPair,
  ): void {
    const encrypted = this.cryptoService.encrypt(
      JSON.stringify({
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
      }),
    );
    connection.tokensCiphertext = encrypted.ciphertext;
    connection.tokensIv = encrypted.iv;
    connection.tokensTag = encrypted.authenticationTag;
    connection.encryptionKeyVersion = encrypted.keyVersion;
    connection.tokenExpiresAt = tokenPair.expiresAt;
  }

  private tokensFromConnection(
    connection: AtlassianOAuthConnection,
  ): StoredTokenPair {
    const value = this.cryptoService.decrypt({
      ciphertext: connection.tokensCiphertext,
      iv: connection.tokensIv,
      authenticationTag: connection.tokensTag,
      keyVersion: connection.encryptionKeyVersion,
    });

    try {
      const tokens: unknown = JSON.parse(value);

      if (
        !this.isRecord(tokens) ||
        !this.isBoundedToken(tokens.accessToken) ||
        (tokens.refreshToken !== null &&
          !this.isBoundedToken(tokens.refreshToken))
      ) {
        throw new Error('invalid token pair');
      }

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    } catch {
      throw new ProviderReauthorizationRequiredError();
    }
  }

  private safeStatus(
    connection: AtlassianOAuthConnection,
  ): OAuthConnectionStatus {
    if (connection.status === 'reauthorization_required') {
      return 'reauthorization_required';
    }

    if (
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() <= Date.now()
    ) {
      return 'expired';
    }

    return 'connected';
  }

  private async writeAudit(
    manager: EntityManager,
    actorUserId: number,
    action: string,
    profileId: string,
    targetId: string | null,
    correlationId: string,
    resultCode: string,
  ): Promise<void> {
    await manager.save(
      manager.create(SecurityAuditEvent, {
        actorUserId,
        action,
        profileId,
        targetId,
        correlationId,
        resultCode,
      }),
    );
  }

  private provider(value: string): IntegrationProvider {
    if (value === 'jira' || value === 'confluence') {
      return value;
    }

    throw new UnauthorizedException('Integration provider is invalid.');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
  }

  private randomUrlSafeValue(size = 32): string {
    return randomBytes(size).toString('base64url');
  }

  private isBoundedCallbackValue(value: string): boolean {
    return (
      value.length > 0 &&
      value.length <= 4096 &&
      ![...value].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      })
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
}
