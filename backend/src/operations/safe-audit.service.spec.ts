import { SafeAuditService } from './safe-audit.service';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

describe('SafeAuditService', () => {
  it('writes bounded metadata but rejects secret-looking targets before persistence', async () => {
    const repository = {
      create: jest.fn(
        <T extends Record<string, unknown>>(value: T): T => value,
      ),
      save: jest.fn(() => Promise.resolve()),
    };
    const metrics = new WorkCopilotMetricsService();
    const service = new SafeAuditService(repository as never, metrics);

    await service.record({
      actorUserId: 42,
      action: 'WEBHOOK_SHADOW_PROCESSED',
      profileId: '11111111-1111-4111-8111-111111111111',
      targetId: '100',
      correlationId: 'webhook-correlation-1',
      resultCode: 'REVIEW_REQUIRED',
    });
    await service.record({
      actorUserId: 42,
      action: 'WEBHOOK_SHADOW_PROCESSED',
      profileId: '11111111-1111-4111-8111-111111111111',
      targetId: 'sk-proj-abcdefghijklmnopqrstuv',
      correlationId: 'webhook-correlation-2',
      resultCode: 'REVIEW_REQUIRED',
    });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 42 }),
    );
    expect(JSON.stringify(repository.save.mock.calls)).not.toContain(
      'sk-proj-abcdefghijklmnopqrstuv',
    );
    expect(metrics.snapshot()).toContainEqual(
      expect.objectContaining({
        name: 'audit_write_failure_total',
        labels: { outcome: 'blocked' },
      }),
    );
  });
});
