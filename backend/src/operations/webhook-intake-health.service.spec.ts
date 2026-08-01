import { WebhookIngressBoundaryService } from './webhook-ingress-boundary.service';
import { WebhookIntakeHealthService } from './webhook-intake-health.service';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

describe('WebhookIntakeHealthService', () => {
  it('returns only safe intake timing and aggregate rejection state', async () => {
    const metrics = new WorkCopilotMetricsService();
    metrics.increment('webhook_ingress_rejection_total', {
      provider: 'jira',
      outcome: 'rejected',
    });
    const service = new WebhookIntakeHealthService(
      {
        findOne: jest.fn().mockResolvedValue({
          createdAt: new Date('2026-08-02T10:00:00.000Z'),
        }),
      } as never,
      new WebhookIngressBoundaryService({
        get: jest.fn(
          (key: string) =>
            ({
              WEBHOOK_SHADOW_MODE: 'true',
              WEBHOOK_INGRESS_VERIFIED: 'true',
              WEBHOOK_INGRESS_ALLOWED_CIDRS: '127.0.0.1/32',
            })[key],
        ),
      } as never),
      metrics,
    );

    await expect(service.snapshot()).resolves.toEqual({
      mode: 'shadow',
      ingressVerified: true,
      allowedCidrCount: 1,
      lastReceivedAt: '2026-08-02T10:00:00.000Z',
      ingressRejectionCount: 1,
    });
  });
});
