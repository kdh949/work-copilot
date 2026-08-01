import { UnauthorizedException } from '@nestjs/common';
import type { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import { CleanupHealthService } from '../operations/cleanup-health.service';
import { WebhookIngressBoundaryService } from '../operations/webhook-ingress-boundary.service';
import { WorkCopilotMetricsService } from '../operations/work-copilot-metrics.service';
import { WebhookIngestService } from './webhook-ingest.service';
import { WebhookPayloadParserService } from './webhook-payload-parser.service';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const ROUTE_SECRET = 'rotating-route-secret';

type ConfigValues = Record<string, string | undefined>;

function createHarness(values: ConfigValues = {}) {
  const configService = {
    get: jest.fn((key: string) => {
      const defaults: ConfigValues = {
        WEBHOOK_SHADOW_MODE: 'true',
        WEBHOOK_INGRESS_VERIFIED: 'true',
        WEBHOOK_INGRESS_ALLOWED_CIDRS: '127.0.0.1/32',
        SOURCE_CHANGE_EVENT_TTL_SECONDS: '86400',
        SOURCE_CHANGE_EVENT_PURGE_INTERVAL_SECONDS: '900',
      };
      return values[key] ?? defaults[key];
    }),
  };
  const profile = {
    id: PROFILE_ID,
    isActive: true,
    encryptionKeyVersion: 1,
    webhookRouteSecretCiphertext: 'ciphertext-only',
    webhookRouteSecretIv: 'iv',
    webhookRouteSecretTag: 'tag',
  } as IntegrationProfile;
  const profileQuery = {
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    getOne: jest.fn(() => Promise.resolve(profile)),
  };
  profileQuery.addSelect.mockReturnValue(profileQuery);
  profileQuery.where.mockReturnValue(profileQuery);
  profileQuery.andWhere.mockReturnValue(profileQuery);
  const profilesRepository = {
    createQueryBuilder: jest.fn(() => profileQuery),
  };
  const storedEvents: Record<string, unknown>[] = [];
  const eventsRepository = {
    create: jest.fn((event: Record<string, unknown>) => event),
    save: jest.fn((event: Record<string, unknown>) => {
      storedEvents.push(event);
      return Promise.resolve(event);
    }),
    delete: jest.fn(() => Promise.resolve({ affected: 2 })),
  };
  const publicationsRepository = {
    findOneBy: jest.fn(() => Promise.resolve(null)),
  };
  const freshnessReview = {
    markReviewRequired: jest.fn(() =>
      Promise.resolve({ affectedDraftCount: 1 }),
    ),
  };
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const metrics = new WorkCopilotMetricsService();
  const cleanupHealth = new CleanupHealthService(
    configService as never,
    metrics,
  );
  const service = new WebhookIngestService(
    profilesRepository as never,
    eventsRepository as never,
    publicationsRepository as never,
    configService as never,
    { decrypt: jest.fn(() => ROUTE_SECRET) } as never,
    new WebhookIngressBoundaryService(configService as never),
    new WebhookPayloadParserService(),
    freshnessReview as never,
    audit as never,
    metrics,
    cleanupHealth,
  );

  return {
    service,
    eventsRepository,
    publicationsRepository,
    freshnessReview,
    audit,
    metrics,
    cleanupHealth,
  };
}

const request = (
  payload: unknown,
  overrides: Record<string, unknown> = {},
) => ({
  profileId: PROFILE_ID,
  provider: 'jira',
  payload,
  routeSecret: ROUTE_SECRET,
  remoteAddress: '127.0.0.1',
  correlationId: 'webhook-correlation-1',
  ...overrides,
});

describe('WebhookIngestService', () => {
  it('stores only safe source metadata and marks the matching draft for shadow re-review', async () => {
    const harness = createHarness();
    const koreanPii = '김민수 고객의 배포 요청';
    const databaseUri = 'postgresql://db-user:db-password@db.example/internal';
    const apiKey = 'sk-proj-synthetic-key-1234567890';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature';
    const pem =
      '-----BEGIN PRIVATE KEY----- synthetic -----END PRIVATE KEY-----';

    await expect(
      harness.service.ingest(
        request({
          issue: {
            id: '100',
            updated: '2026-08-02T10:00:00.000Z',
            fields: {
              summary: koreanPii,
              description: databaseUri,
              jwt,
              pem,
            },
          },
          comment: { body: `fixture/.env ${apiKey}` },
          timestamp: '2026-08-02T10:00:00.000Z',
        }),
      ),
    ).resolves.toEqual({ outcome: 'shadow_processed', refreshRequired: false });

    const stored = harness.eventsRepository.save.mock.calls[0]?.[0];
    expect(stored).toEqual(
      expect.objectContaining({
        provider: 'jira',
        profileId: PROFILE_ID,
        sourceId: '100',
        sourceVersion: '2026-08-02T10:00:00.000Z',
        ingressAuthResult: 'SHADOW_ACCEPTED',
      }),
    );
    expect(stored).not.toHaveProperty('payload');
    expect(JSON.stringify(stored)).not.toContain(koreanPii);
    expect(JSON.stringify(stored)).not.toContain(databaseUri);
    expect(JSON.stringify(stored)).not.toContain(apiKey);
    expect(JSON.stringify(stored)).not.toContain(jwt);
    expect(JSON.stringify(stored)).not.toContain(pem);
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain(
      koreanPii,
    );
    expect(harness.freshnessReview.markReviewRequired).toHaveBeenCalledWith(
      PROFILE_ID,
      'jira',
      '100',
    );
  });

  it('suppresses a replay by unique fingerprint before triggering another freshness transition', async () => {
    const harness = createHarness();
    harness.eventsRepository.save.mockRejectedValueOnce({ code: '23505' });

    await expect(
      harness.service.ingest(
        request({
          issue: { id: '100', updated: '2026-08-02T10:00:00.000Z' },
          timestamp: '2026-08-02T10:00:00.000Z',
        }),
      ),
    ).resolves.toEqual({ outcome: 'replay_ignored', refreshRequired: false });

    expect(harness.freshnessReview.markReviewRequired).not.toHaveBeenCalled();
    expect(harness.metrics.snapshot()).toContainEqual(
      expect.objectContaining({
        name: 'webhook_intake_total',
        labels: { provider: 'jira', outcome: 'replay' },
      }),
    );
  });

  it('falls back to manual refresh before parsing or persisting an ingress whose boundary is unverified', async () => {
    const harness = createHarness({ WEBHOOK_INGRESS_VERIFIED: 'false' });

    await expect(
      harness.service.ingest(
        request({
          issue: {
            id: '100',
            updated: '2026-08-02T10:00:00.000Z',
            fields: { description: 'fixture/.env' },
          },
        }),
      ),
    ).resolves.toEqual({
      outcome: 'manual_refresh_required',
      refreshRequired: true,
    });

    expect(harness.eventsRepository.save).not.toHaveBeenCalled();
    expect(harness.freshnessReview.markReviewRequired).not.toHaveBeenCalled();
  });

  it('rejects an invalid route secret without saving the incoming payload', async () => {
    const harness = createHarness();

    await expect(
      harness.service.ingest(
        request(
          {
            issue: { id: '100', updated: '2026-08-02T10:00:00.000Z' },
            timestamp: '2026-08-02T10:00:00.000Z',
          },
          { routeSecret: 'wrong-route-secret' },
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(harness.eventsRepository.save).not.toHaveBeenCalled();
  });

  it('filters Confluence events carrying this publication operation ID', async () => {
    const harness = createHarness();
    harness.publicationsRepository.findOneBy.mockResolvedValue({
      id: 'publication-1',
    });

    await expect(
      harness.service.ingest(
        request(
          {
            content: { id: '200', version: { number: 8 } },
            timestamp: 1_786_000_000_000,
            operationId: 'operation-123',
          },
          { provider: 'confluence' },
        ),
      ),
    ).resolves.toEqual({
      outcome: 'self_event_ignored',
      refreshRequired: false,
    });

    expect(harness.eventsRepository.save).not.toHaveBeenCalled();
    expect(harness.freshnessReview.markReviewRequired).not.toHaveBeenCalled();
  });

  it('reports source-event cleanup health without retaining a cleanup error', async () => {
    const harness = createHarness();

    await harness.service.purgeExpired();

    expect(harness.cleanupHealth.snapshot().jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          job: 'source_change_events',
          status: 'healthy',
          lastDeletedCount: 2,
        }),
      ]),
    );
  });
});
