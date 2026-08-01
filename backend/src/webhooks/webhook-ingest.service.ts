import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { LessThanOrEqual, Repository } from 'typeorm';
import { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import {
  IntegrationProfileCryptoService,
  type EncryptedProfileSecret,
} from '../integrations/profiles/integration-profile-crypto.service';
import { CleanupHealthService } from '../operations/cleanup-health.service';
import { SafeAuditService } from '../operations/safe-audit.service';
import { WebhookIngressBoundaryService } from '../operations/webhook-ingress-boundary.service';
import { WorkCopilotMetricsService } from '../operations/work-copilot-metrics.service';
import { BriefPublication } from '../publications/entities/brief-publication.entity';
import {
  SourceChangeEvent,
  type SourceChangeProvider,
} from './entities/source-change-event.entity';
import { FreshnessReviewService } from './freshness-review.service';
import { WebhookPayloadParserService } from './webhook-payload-parser.service';

const MAX_EVENT_TTL_SECONDS = 24 * 60 * 60;

export type WebhookIngestResponse = {
  outcome:
    | 'shadow_processed'
    | 'replay_ignored'
    | 'self_event_ignored'
    | 'manual_refresh_required';
  refreshRequired: boolean;
};

type WebhookIngestInput = {
  profileId: string;
  provider: string;
  payload: unknown;
  routeSecret: string | undefined;
  remoteAddress: string | undefined;
  correlationId: string;
};

@Injectable()
export class WebhookIngestService implements OnModuleInit, OnModuleDestroy {
  private purgeTimer: NodeJS.Timeout | undefined;

  constructor(
    @InjectRepository(IntegrationProfile)
    private readonly profilesRepository: Repository<IntegrationProfile>,
    @InjectRepository(SourceChangeEvent)
    private readonly eventsRepository: Repository<SourceChangeEvent>,
    @InjectRepository(BriefPublication)
    private readonly publicationsRepository: Repository<BriefPublication>,
    private readonly configService: ConfigService,
    private readonly cryptoService: IntegrationProfileCryptoService,
    private readonly ingressBoundary: WebhookIngressBoundaryService,
    private readonly payloadParser: WebhookPayloadParserService,
    private readonly freshnessReview: FreshnessReviewService,
    private readonly audit: SafeAuditService,
    private readonly metrics: WorkCopilotMetricsService,
    private readonly cleanupHealth: CleanupHealthService,
  ) {}

  onModuleInit(): void {
    void this.purgeExpired();
    this.purgeTimer = setInterval(() => {
      void this.purgeExpired();
    }, this.purgeIntervalSeconds() * 1_000);
    this.purgeTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = undefined;
    }
  }

  async ingest(input: WebhookIngestInput): Promise<WebhookIngestResponse> {
    const provider = this.provider(input.provider);
    const profile = await this.findActiveProfile(input.profileId);
    if (!profile) {
      this.metrics.increment('webhook_intake_total', {
        provider,
        outcome: 'manual_refresh',
      });
      return this.manualRefresh();
    }

    const decision = this.ingressBoundary.authenticate(
      input.remoteAddress,
      input.routeSecret,
      this.routeSecret(profile),
    );
    if (decision.kind === 'manual_refresh') {
      this.metrics.increment('webhook_intake_total', {
        provider,
        outcome: 'manual_refresh',
      });
      await this.audit.record({
        action: 'WEBHOOK_INGRESS_FALLBACK',
        profileId: profile.id,
        targetId: null,
        correlationId: input.correlationId,
        resultCode: 'MANUAL_REFRESH',
      });
      return this.manualRefresh();
    }
    if (decision.kind === 'rejected') {
      this.metrics.increment('webhook_ingress_rejection_total', {
        provider,
        outcome: 'rejected',
      });
      await this.audit.record({
        action: 'WEBHOOK_INGRESS_REJECTED',
        profileId: profile.id,
        targetId: null,
        correlationId: input.correlationId,
        resultCode: decision.code,
      });
      throw new UnauthorizedException('Webhook request is not accepted.');
    }

    const change = this.payloadParser.parse(provider, input.payload);
    if (!change) {
      this.metrics.increment('webhook_intake_total', {
        provider,
        outcome: 'malformed',
      });
      await this.audit.record({
        action: 'WEBHOOK_PAYLOAD_REJECTED',
        profileId: profile.id,
        targetId: null,
        correlationId: input.correlationId,
        resultCode: 'MALFORMED',
      });
      throw new BadRequestException('Webhook payload is invalid.');
    }

    if (await this.isOwnConfluenceOperation(provider, change.operationId)) {
      this.metrics.increment('webhook_intake_total', {
        provider,
        outcome: 'self_event',
      });
      await this.audit.record({
        action: 'WEBHOOK_EVENT_IGNORED',
        profileId: profile.id,
        targetId: change.sourceId,
        correlationId: input.correlationId,
        resultCode: 'SELF_OPERATION',
      });
      return { outcome: 'self_event_ignored', refreshRequired: false };
    }

    const event = this.eventsRepository.create({
      provider,
      profileId: profile.id,
      sourceId: change.sourceId,
      sourceVersion: change.sourceVersion,
      eventTime: change.eventTime,
      eventFingerprint: this.fingerprint(
        profile.id,
        provider,
        change.sourceId,
        change.sourceVersion,
      ),
      ingressAuthResult: 'SHADOW_ACCEPTED',
      expiresAt: new Date(Date.now() + this.eventTtlSeconds() * 1_000),
    });

    try {
      await this.eventsRepository.save(event);
    } catch (error) {
      if (this.isDuplicateEvent(error)) {
        this.metrics.increment('webhook_intake_total', {
          provider,
          outcome: 'replay',
        });
        await this.audit.record({
          action: 'WEBHOOK_EVENT_IGNORED',
          profileId: profile.id,
          targetId: change.sourceId,
          correlationId: input.correlationId,
          resultCode: 'REPLAY',
        });
        return { outcome: 'replay_ignored', refreshRequired: false };
      }
      throw error;
    }

    const result = await this.freshnessReview.markReviewRequired(
      profile.id,
      provider,
      change.sourceId,
    );
    this.metrics.increment('webhook_intake_total', {
      provider,
      outcome: 'accepted',
    });
    for (let index = 0; index < result.affectedDraftCount; index += 1) {
      this.metrics.increment('draft_review_required_total', { provider });
    }
    await this.audit.record({
      action: 'WEBHOOK_SHADOW_PROCESSED',
      profileId: profile.id,
      targetId: change.sourceId,
      correlationId: input.correlationId,
      resultCode: 'REVIEW_REQUIRED',
    });

    return { outcome: 'shadow_processed', refreshRequired: false };
  }

  async purgeExpired(): Promise<void> {
    try {
      const result = await this.eventsRepository.delete({
        expiresAt: LessThanOrEqual(new Date()),
      });
      this.cleanupHealth.recordSuccess(
        'source_change_events',
        result.affected ?? 0,
      );
    } catch {
      // Retain no provider request body or database error details in logs.
      this.cleanupHealth.recordFailure('source_change_events');
    }
  }

  private provider(value: string): SourceChangeProvider {
    if (value === 'jira' || value === 'confluence') {
      return value;
    }
    throw new BadRequestException('Webhook provider is invalid.');
  }

  private async findActiveProfile(
    profileId: string,
  ): Promise<IntegrationProfile | null> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        profileId,
      )
    ) {
      return null;
    }

    return this.profilesRepository
      .createQueryBuilder('profile')
      .addSelect([
        'profile.webhookRouteSecretCiphertext',
        'profile.webhookRouteSecretIv',
        'profile.webhookRouteSecretTag',
      ])
      .where('profile.id = :profileId', { profileId })
      .andWhere('profile.isActive = :isActive', { isActive: true })
      .getOne();
  }

  private routeSecret(profile: IntegrationProfile): string | null {
    if (
      !profile.webhookRouteSecretCiphertext ||
      !profile.webhookRouteSecretIv ||
      !profile.webhookRouteSecretTag
    ) {
      return null;
    }

    try {
      return this.cryptoService.decrypt({
        ciphertext: profile.webhookRouteSecretCiphertext,
        iv: profile.webhookRouteSecretIv,
        authenticationTag: profile.webhookRouteSecretTag,
        keyVersion: profile.encryptionKeyVersion,
      } satisfies EncryptedProfileSecret);
    } catch {
      return null;
    }
  }

  private async isOwnConfluenceOperation(
    provider: SourceChangeProvider,
    operationId: string | null,
  ): Promise<boolean> {
    if (provider !== 'confluence' || !operationId) {
      return false;
    }

    return Boolean(
      await this.publicationsRepository.findOneBy({ operationId }),
    );
  }

  private fingerprint(
    profileId: string,
    provider: SourceChangeProvider,
    sourceId: string,
    sourceVersion: string,
  ): string {
    return createHash('sha256')
      .update(`${profileId}:${provider}:${sourceId}:${sourceVersion}`)
      .digest('hex');
  }

  private isDuplicateEvent(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }

  private manualRefresh(): WebhookIngestResponse {
    return { outcome: 'manual_refresh_required', refreshRequired: true };
  }

  private eventTtlSeconds(): number {
    return this.boundedPositiveSeconds(
      'SOURCE_CHANGE_EVENT_TTL_SECONDS',
      MAX_EVENT_TTL_SECONDS,
      MAX_EVENT_TTL_SECONDS,
    );
  }

  private purgeIntervalSeconds(): number {
    return this.boundedPositiveSeconds(
      'SOURCE_CHANGE_EVENT_PURGE_INTERVAL_SECONDS',
      15 * 60,
      60 * 60,
    );
  }

  private boundedPositiveSeconds(
    key: string,
    defaultValue: number,
    maxValue: number,
  ): number {
    const configured = Number(this.configService.get<string>(key));
    return Number.isInteger(configured) &&
      configured >= 60 &&
      configured <= maxValue
      ? configured
      : defaultValue;
  }
}
