import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreateIntegrationProfileDto } from './dto/create-integration-profile.dto';
import { RotateWebhookRouteSecretDto } from './dto/rotate-webhook-route-secret.dto';
import { UpdateIntegrationProfileDto } from './dto/update-integration-profile.dto';
import {
  ChildTaskTemplate,
  ChildTaskTemplateFieldValue,
  IntegrationProfile,
  OAuthScopePolicy,
} from './entities/integration-profile.entity';
import { SecurityAuditEvent } from './entities/security-audit-event.entity';
import { IntegrationProfileConnectionTestService } from './integration-profile-connection-test.service';
import {
  EncryptedProfileSecret,
  IntegrationProfileCryptoService,
} from './integration-profile-crypto.service';
import { IntegrationProfileUrlPolicy } from './integration-profile-url.policy';

type Provider = 'jira' | 'confluence';

const CHILD_TASK_TEMPLATE_SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/i,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s'"`]+/i,
  /(?:^|[\r\n])\s*[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|DB_URI)\s*=/m,
  /\b(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{8,}/i,
  /(?:^|[/:])\.env(?:[./:]|$)/i,
];

export type IntegrationProfileResponse = {
  id: string;
  jiraBaseUrl: string;
  confluenceBaseUrl: string;
  jiraClientId: string;
  confluenceClientId: string;
  jiraClientSecretConfigured: boolean;
  confluenceClientSecretConfigured: boolean;
  webhookRouteSecretConfigured: boolean;
  jiraScopes: string[];
  confluenceScopes: string[];
  allowedProjectKeys: string[];
  allowedSpaceKeys: string[];
  briefParentPageId: string | null;
  childTaskIssueTypeId: string | null;
  childTaskTemplateFields: Record<string, ChildTaskTemplateFieldValue>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class IntegrationProfilesService {
  constructor(
    @InjectRepository(IntegrationProfile)
    private readonly profilesRepository: Repository<IntegrationProfile>,
    @InjectRepository(SecurityAuditEvent)
    private readonly auditRepository: Repository<SecurityAuditEvent>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly cryptoService: IntegrationProfileCryptoService,
    private readonly urlPolicy: IntegrationProfileUrlPolicy,
    private readonly connectionTestService: IntegrationProfileConnectionTestService,
  ) {}

  async findAll(): Promise<IntegrationProfileResponse[]> {
    const profiles = await this.profilesRepository
      .createQueryBuilder('profile')
      .addSelect([
        'profile.jiraClientSecretCiphertext',
        'profile.confluenceClientSecretCiphertext',
        'profile.webhookRouteSecretCiphertext',
      ])
      .orderBy('profile.createdAt', 'DESC')
      .getMany();

    return profiles.map((profile) => this.toResponse(profile));
  }

  async create(
    dto: CreateIntegrationProfileDto,
    actorUserId: number,
    correlationId: string,
  ): Promise<IntegrationProfileResponse> {
    const input = this.normalizeCreate(dto);

    return this.dataSource.transaction(async (manager) => {
      const profile = manager.create(IntegrationProfile, {
        ...input,
        isActive: false,
      });
      const savedProfile = await manager.save(profile);

      await this.writeAudit(
        manager,
        actorUserId,
        'INTEGRATION_PROFILE_CREATED',
        savedProfile.id,
        correlationId,
        'CREATED',
      );

      return this.toResponse(savedProfile);
    });
  }

  async update(
    id: string,
    dto: UpdateIntegrationProfileDto,
    actorUserId: number,
    correlationId: string,
  ): Promise<IntegrationProfileResponse> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await this.findProfile(manager, id);
      const input = await this.normalizeUpdate(dto, existing);
      const profile = Object.assign(existing, input);
      const savedProfile = await manager.save(profile);

      await this.writeAudit(
        manager,
        actorUserId,
        'INTEGRATION_PROFILE_UPDATED',
        savedProfile.id,
        correlationId,
        'UPDATED',
      );

      return this.toResponse(savedProfile);
    });
  }

  async activate(
    id: string,
    actorUserId: number,
    correlationId: string,
  ): Promise<IntegrationProfileResponse> {
    return this.dataSource.transaction(async (manager) => {
      const profile = await this.findProfile(manager, id);
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext('integration_profiles.active'))",
      );
      await manager.update(
        IntegrationProfile,
        { isActive: true },
        { isActive: false },
      );
      const result = await manager.update(
        IntegrationProfile,
        { id: profile.id },
        { isActive: true },
      );

      if (result.affected !== 1) {
        throw new NotFoundException('Integration profile was not found.');
      }

      profile.isActive = true;
      await this.writeAudit(
        manager,
        actorUserId,
        'INTEGRATION_PROFILE_ACTIVATED',
        profile.id,
        correlationId,
        'ACTIVATED',
      );

      return this.toResponse(profile);
    });
  }

  async deactivate(
    id: string,
    actorUserId: number,
    correlationId: string,
  ): Promise<IntegrationProfileResponse> {
    return this.dataSource.transaction(async (manager) => {
      const profile = await this.findProfile(manager, id);
      const result = await manager.update(
        IntegrationProfile,
        { id: profile.id },
        { isActive: false },
      );
      if (result.affected !== 1) {
        throw new NotFoundException('Integration profile was not found.');
      }

      profile.isActive = false;
      await this.writeAudit(
        manager,
        actorUserId,
        'INTEGRATION_PROFILE_DEACTIVATED',
        profile.id,
        correlationId,
        'DEACTIVATED',
      );

      return this.toResponse(profile);
    });
  }

  async rotateWebhookRouteSecret(
    id: string,
    dto: RotateWebhookRouteSecretDto,
    actorUserId: number,
    correlationId: string,
  ): Promise<IntegrationProfileResponse> {
    return this.dataSource.transaction(async (manager) => {
      const profile = await this.findProfile(manager, id);
      const secret = this.cryptoService.encrypt(
        this.normalizeSecret(dto.webhookRouteSecret),
      );
      Object.assign(
        profile,
        this.reencryptProfileSecretsIfNeeded(profile),
        this.webhookSecretColumns(secret),
        { encryptionKeyVersion: secret.keyVersion },
      );
      const savedProfile = await manager.save(profile);

      await this.writeAudit(
        manager,
        actorUserId,
        'WEBHOOK_ROUTE_SECRET_ROTATED',
        savedProfile.id,
        correlationId,
        'ROTATED',
      );

      return this.toResponse(savedProfile);
    });
  }

  async remove(
    id: string,
    actorUserId: number,
    correlationId: string,
  ): Promise<{ deleted: true }> {
    return this.dataSource.transaction(async (manager) => {
      const profile = await this.findProfile(manager, id);

      if (profile.isActive) {
        throw new ConflictException(
          'Deactivate an integration profile before deleting it.',
        );
      }

      await manager.delete(IntegrationProfile, { id: profile.id });
      await this.writeAudit(
        manager,
        actorUserId,
        'INTEGRATION_PROFILE_DELETED',
        profile.id,
        correlationId,
        'DELETED',
      );

      return { deleted: true };
    });
  }

  async test(
    id: string,
    actorUserId: number,
    correlationId: string,
  ): Promise<
    Awaited<ReturnType<IntegrationProfileConnectionTestService['test']>>
  > {
    const profile = await this.profilesRepository.findOne({
      where: { id },
    });

    if (!profile) {
      throw new NotFoundException('Integration profile was not found.');
    }

    try {
      const result = await this.connectionTestService.test(profile);
      await this.writeAudit(
        this.auditRepository.manager,
        actorUserId,
        'INTEGRATION_PROFILE_TESTED',
        profile.id,
        correlationId,
        'TEST_COMPLETED',
      );
      return result;
    } catch (error) {
      await this.writeAudit(
        this.auditRepository.manager,
        actorUserId,
        'INTEGRATION_PROFILE_TESTED',
        profile.id,
        correlationId,
        'TEST_FAILED',
      );
      throw error;
    }
  }

  private normalizeCreate(
    dto: CreateIntegrationProfileDto,
  ): Partial<IntegrationProfile> {
    const jiraSecret = this.cryptoService.encrypt(dto.jiraClientSecret);
    const confluenceSecret = this.cryptoService.encrypt(
      dto.confluenceClientSecret,
    );

    if (jiraSecret.keyVersion !== confluenceSecret.keyVersion) {
      throw new BadRequestException(
        'Integration encryption key version changed.',
      );
    }

    return {
      jiraBaseUrl: this.urlPolicy.normalizeBaseUrl(dto.jiraBaseUrl),
      confluenceBaseUrl: this.urlPolicy.normalizeBaseUrl(dto.confluenceBaseUrl),
      jiraClientId: this.normalizeClientId(dto.jiraClientId),
      confluenceClientId: this.normalizeClientId(dto.confluenceClientId),
      ...this.secretColumns('jira', jiraSecret),
      ...this.secretColumns('confluence', confluenceSecret),
      encryptionKeyVersion: jiraSecret.keyVersion,
      allowedProjectKeys: this.normalizeResourceKeys(
        dto.allowedProjectKeys,
        'project',
      ),
      allowedSpaceKeys: this.normalizeResourceKeys(
        dto.allowedSpaceKeys,
        'space',
      ),
      briefParentPageId: this.normalizeParentPageId(dto.briefParentPageId),
      policy: this.policy(
        this.validateScopes('jira', dto.jiraScopes),
        this.validateScopes('confluence', dto.confluenceScopes),
        this.normalizeChildTaskTemplate(
          dto.childTaskIssueTypeId,
          dto.childTaskTemplateFields,
        ),
      ),
      isActive: false,
    };
  }

  private async normalizeUpdate(
    dto: UpdateIntegrationProfileDto,
    existing: IntegrationProfile,
  ): Promise<Partial<IntegrationProfile>> {
    const update: Partial<IntegrationProfile> = {
      ...this.reencryptProfileSecretsIfNeeded(existing),
    };

    if (dto.jiraBaseUrl !== undefined) {
      update.jiraBaseUrl = this.urlPolicy.normalizeBaseUrl(dto.jiraBaseUrl);
    }
    if (dto.confluenceBaseUrl !== undefined) {
      update.confluenceBaseUrl = this.urlPolicy.normalizeBaseUrl(
        dto.confluenceBaseUrl,
      );
    }
    if (dto.jiraClientId !== undefined) {
      update.jiraClientId = this.normalizeClientId(dto.jiraClientId);
    }
    if (dto.confluenceClientId !== undefined) {
      update.confluenceClientId = this.normalizeClientId(
        dto.confluenceClientId,
      );
    }
    if (dto.allowedProjectKeys !== undefined) {
      update.allowedProjectKeys = this.normalizeResourceKeys(
        dto.allowedProjectKeys,
        'project',
      );
    }
    if (dto.allowedSpaceKeys !== undefined) {
      update.allowedSpaceKeys = this.normalizeResourceKeys(
        dto.allowedSpaceKeys,
        'space',
      );
    }
    if (dto.briefParentPageId !== undefined) {
      update.briefParentPageId = this.normalizeParentPageId(
        dto.briefParentPageId,
      );
    }

    const currentScopes = this.scopesFrom(existing.policy);
    const jiraScopes =
      dto.jiraScopes === undefined
        ? currentScopes.jira
        : this.validateScopes('jira', dto.jiraScopes);
    const confluenceScopes =
      dto.confluenceScopes === undefined
        ? currentScopes.confluence
        : this.validateScopes('confluence', dto.confluenceScopes);

    const currentChildTaskTemplate = this.childTaskTemplateFrom(
      existing.policy,
    );
    update.policy = this.policy(
      jiraScopes,
      confluenceScopes,
      this.normalizeChildTaskTemplate(
        dto.childTaskIssueTypeId === undefined
          ? currentChildTaskTemplate?.issueTypeId
          : dto.childTaskIssueTypeId,
        dto.childTaskTemplateFields === undefined
          ? currentChildTaskTemplate?.fields
          : dto.childTaskTemplateFields,
      ),
    );

    const encryptedSecrets: Array<[Provider, EncryptedProfileSecret]> = [];

    if (dto.jiraClientSecret !== undefined) {
      encryptedSecrets.push([
        'jira',
        this.cryptoService.encrypt(this.normalizeSecret(dto.jiraClientSecret)),
      ]);
    }
    if (dto.confluenceClientSecret !== undefined) {
      encryptedSecrets.push([
        'confluence',
        this.cryptoService.encrypt(
          this.normalizeSecret(dto.confluenceClientSecret),
        ),
      ]);
    }

    if (encryptedSecrets.length > 0) {
      const keyVersion = encryptedSecrets[0][1].keyVersion;

      if (
        encryptedSecrets.some(([, secret]) => secret.keyVersion !== keyVersion)
      ) {
        throw new BadRequestException(
          'Integration encryption key version changed.',
        );
      }

      for (const [provider, secret] of encryptedSecrets) {
        Object.assign(update, this.secretColumns(provider, secret));
      }
      update.encryptionKeyVersion = keyVersion;
    }

    return update;
  }

  private reencryptProfileSecretsIfNeeded(
    profile: IntegrationProfile,
  ): Partial<IntegrationProfile> {
    if (
      profile.encryptionKeyVersion === this.cryptoService.currentKeyVersion()
    ) {
      return {};
    }

    const update: Partial<IntegrationProfile> = {};
    const reencrypt = (
      encrypted: {
        ciphertext: string | null;
        iv: string | null;
        authenticationTag: string | null;
      },
      apply: (value: EncryptedProfileSecret) => void,
    ): void => {
      if (
        !encrypted.ciphertext &&
        !encrypted.iv &&
        !encrypted.authenticationTag
      ) {
        return;
      }

      if (
        !encrypted.ciphertext ||
        !encrypted.iv ||
        !encrypted.authenticationTag
      ) {
        throw new InternalServerErrorException(
          'Integration secret cannot be rotated.',
        );
      }

      const ciphertext = encrypted.ciphertext;
      const iv = encrypted.iv;
      const authenticationTag = encrypted.authenticationTag;
      apply(
        this.cryptoService.encrypt(
          this.cryptoService.decrypt({
            ciphertext,
            iv,
            authenticationTag,
            keyVersion: profile.encryptionKeyVersion,
          }),
        ),
      );
    };

    reencrypt(
      {
        ciphertext: profile.jiraClientSecretCiphertext,
        iv: profile.jiraClientSecretIv,
        authenticationTag: profile.jiraClientSecretTag,
      },
      (secret) => Object.assign(update, this.secretColumns('jira', secret)),
    );
    reencrypt(
      {
        ciphertext: profile.confluenceClientSecretCiphertext,
        iv: profile.confluenceClientSecretIv,
        authenticationTag: profile.confluenceClientSecretTag,
      },
      (secret) =>
        Object.assign(update, this.secretColumns('confluence', secret)),
    );
    reencrypt(
      {
        ciphertext: profile.webhookRouteSecretCiphertext,
        iv: profile.webhookRouteSecretIv,
        authenticationTag: profile.webhookRouteSecretTag,
      },
      (secret) => Object.assign(update, this.webhookSecretColumns(secret)),
    );

    update.encryptionKeyVersion = this.cryptoService.currentKeyVersion();
    return update;
  }

  private secretColumns(
    provider: Provider,
    secret: EncryptedProfileSecret,
  ): Partial<IntegrationProfile> {
    if (provider === 'jira') {
      return {
        jiraClientSecretCiphertext: secret.ciphertext,
        jiraClientSecretIv: secret.iv,
        jiraClientSecretTag: secret.authenticationTag,
      };
    }

    return {
      confluenceClientSecretCiphertext: secret.ciphertext,
      confluenceClientSecretIv: secret.iv,
      confluenceClientSecretTag: secret.authenticationTag,
    };
  }

  private webhookSecretColumns(
    secret: EncryptedProfileSecret,
  ): Partial<IntegrationProfile> {
    return {
      webhookRouteSecretCiphertext: secret.ciphertext,
      webhookRouteSecretIv: secret.iv,
      webhookRouteSecretTag: secret.authenticationTag,
    };
  }

  private normalizeClientId(value: string): string {
    const normalized = value.trim();

    if (!normalized) {
      throw new BadRequestException('Integration client ID is invalid.');
    }

    return normalized;
  }

  private normalizeSecret(value: string): string {
    if (!value) {
      throw new BadRequestException('Integration secret is invalid.');
    }

    return value;
  }

  private normalizeResourceKeys(
    values: string[],
    type: 'project' | 'space',
  ): string[] {
    const normalized = [
      ...new Set(values.map((value) => value.trim().toUpperCase())),
    ]
      .filter(Boolean)
      .sort();
    const pattern = /^[A-Z][A-Z0-9_]{0,31}$/;

    if (
      normalized.length === 0 ||
      normalized.some((value) => !pattern.test(value))
    ) {
      throw new BadRequestException(`Integration ${type} key is invalid.`);
    }

    return normalized;
  }

  private normalizeParentPageId(
    value: string | null | undefined,
  ): string | null {
    if (value === undefined || value === null || value.trim() === '') {
      return null;
    }

    const normalized = value.trim();

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
      throw new BadRequestException('Integration parent page ID is invalid.');
    }

    return normalized;
  }

  private validateScopes(provider: Provider, values: string[]): string[] {
    const normalized = [
      ...new Set(values.map((value) => value.trim().toUpperCase())),
    ]
      .filter(Boolean)
      .sort();
    const allowedScopes = this.scopeAllowlist(provider);

    if (
      normalized.length === 0 ||
      !normalized.includes('READ') ||
      normalized.some((scope) => !allowedScopes.includes(scope))
    ) {
      throw new BadRequestException('Integration scope is not allowlisted.');
    }

    return normalized;
  }

  private scopeAllowlist(provider: Provider): string[] {
    const configKey =
      provider === 'jira'
        ? 'INTEGRATION_JIRA_SCOPE_ALLOWLIST'
        : 'INTEGRATION_CONFLUENCE_SCOPE_ALLOWLIST';
    const configured = this.configService.get<string>(configKey);

    return (configured ?? 'READ')
      .split(',')
      .map((scope) => scope.trim().toUpperCase())
      .filter(Boolean);
  }

  private policy(
    jiraScopes: string[],
    confluenceScopes: string[],
    childTaskTemplate?: ChildTaskTemplate,
  ): OAuthScopePolicy {
    return {
      oauthScopes: { jira: jiraScopes, confluence: confluenceScopes },
      ...(childTaskTemplate ? { childTaskTemplate } : {}),
    };
  }

  private normalizeChildTaskTemplate(
    issueTypeId: string | undefined,
    values: Record<string, unknown> | undefined,
  ): ChildTaskTemplate | undefined {
    const normalizedIssueTypeId = issueTypeId?.trim() ?? '';
    const fields = values ?? {};

    if (!normalizedIssueTypeId) {
      if (Object.keys(fields).length > 0) {
        throw new BadRequestException('Child task issue type is required.');
      }
      return undefined;
    }

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedIssueTypeId)) {
      throw new BadRequestException('Child task issue type is invalid.');
    }

    const entries = Object.entries(fields);
    if (entries.length > 50) {
      throw new BadRequestException('Child task template is invalid.');
    }

    const normalizedFields: Record<string, ChildTaskTemplateFieldValue> = {};
    for (const [fieldId, value] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(fieldId)) {
        throw new BadRequestException('Child task template field is invalid.');
      }
      normalizedFields[fieldId] = this.normalizeChildTaskTemplateValue(value);
    }

    return { issueTypeId: normalizedIssueTypeId, fields: normalizedFields };
  }

  private normalizeChildTaskTemplateValue(
    value: unknown,
  ): ChildTaskTemplateFieldValue {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.length <= 512) {
      this.assertSafeChildTaskTemplateValue(value);
      return value;
    }
    if (
      Array.isArray(value) &&
      value.length <= 20 &&
      value.every((item) => typeof item === 'string' && item.length <= 512)
    ) {
      const normalized: string[] = [];
      for (const item of value) {
        if (typeof item !== 'string') {
          throw new BadRequestException(
            'Child task template value is invalid.',
          );
        }
        this.assertSafeChildTaskTemplateValue(item);
        normalized.push(item);
      }
      return normalized;
    }

    throw new BadRequestException('Child task template value is invalid.');
  }

  private assertSafeChildTaskTemplateValue(value: string): void {
    if (
      CHILD_TASK_TEMPLATE_SECRET_PATTERNS.some((pattern) => pattern.test(value))
    ) {
      throw new BadRequestException('Child task template value is invalid.');
    }
  }

  private childTaskTemplateFrom(
    policy: OAuthScopePolicy,
  ): ChildTaskTemplate | undefined {
    return policy.childTaskTemplate;
  }

  private scopesFrom(policy: OAuthScopePolicy): {
    jira: string[];
    confluence: string[];
  } {
    return {
      jira: policy.oauthScopes?.jira ?? [],
      confluence: policy.oauthScopes?.confluence ?? [],
    };
  }

  private async findProfile(
    manager: EntityManager,
    id: string,
  ): Promise<IntegrationProfile> {
    const profile = await manager
      .getRepository(IntegrationProfile)
      .createQueryBuilder('profile')
      .addSelect([
        'profile.jiraClientSecretCiphertext',
        'profile.confluenceClientSecretCiphertext',
        'profile.webhookRouteSecretCiphertext',
      ])
      .where('profile.id = :id', { id })
      .getOne();

    if (!profile) {
      throw new NotFoundException('Integration profile was not found.');
    }

    return profile;
  }

  private async writeAudit(
    manager: EntityManager,
    actorUserId: number,
    action: string,
    profileId: string,
    correlationId: string,
    resultCode: string,
  ): Promise<void> {
    await manager.save(
      manager.create(SecurityAuditEvent, {
        actorUserId,
        action,
        profileId,
        targetId: profileId,
        correlationId,
        resultCode,
      }),
    );
  }

  private toResponse(profile: IntegrationProfile): IntegrationProfileResponse {
    const scopes = this.scopesFrom(profile.policy);
    const childTaskTemplate = this.childTaskTemplateFrom(profile.policy);

    return {
      id: profile.id,
      jiraBaseUrl: profile.jiraBaseUrl,
      confluenceBaseUrl: profile.confluenceBaseUrl,
      jiraClientId: profile.jiraClientId,
      confluenceClientId: profile.confluenceClientId,
      jiraClientSecretConfigured: Boolean(profile.jiraClientSecretCiphertext),
      confluenceClientSecretConfigured: Boolean(
        profile.confluenceClientSecretCiphertext,
      ),
      webhookRouteSecretConfigured: Boolean(
        profile.webhookRouteSecretCiphertext,
      ),
      jiraScopes: scopes.jira,
      confluenceScopes: scopes.confluence,
      allowedProjectKeys: profile.allowedProjectKeys,
      allowedSpaceKeys: profile.allowedSpaceKeys,
      briefParentPageId: profile.briefParentPageId,
      childTaskIssueTypeId: childTaskTemplate?.issueTypeId ?? null,
      childTaskTemplateFields: childTaskTemplate?.fields ?? {},
      isActive: profile.isActive,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
