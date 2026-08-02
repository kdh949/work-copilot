import { CleanupHealthService } from './cleanup-health.service';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

describe('CleanupHealthService', () => {
  it('reports pending, healthy, and stale cleanup state without retaining cleanup errors', () => {
    const service = new CleanupHealthService(
      { get: jest.fn().mockReturnValue('60') } as never,
      new WorkCopilotMetricsService(),
    );

    expect(service.snapshot().status).toBe('pending');

    service.recordSuccess('transient_evidence', 2);
    service.recordSuccess('source_change_events', 1);
    const healthy = service.snapshot();
    expect(healthy.status).toBe('healthy');
    expect(healthy.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          job: 'transient_evidence',
          status: 'healthy',
          lastDeletedCount: 2,
        }),
      ]),
    );

    const stale = service.snapshot(new Date(Date.now() + 61_000));
    expect(stale.status).toBe('degraded');
  });
});
