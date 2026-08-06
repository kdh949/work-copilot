import { CleanupHealthService } from './cleanup-health.service';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

describe('CleanupHealthService', () => {
  it('uses the pilot alert threshold of 70 minutes when no override is configured', () => {
    const service = new CleanupHealthService(
      { get: jest.fn().mockReturnValue(undefined) } as never,
      new WorkCopilotMetricsService(),
    );

    service.recordSuccess('transient_evidence', 0);
    service.recordSuccess('source_change_events', 0);
    service.recordSuccess('deleted_brief_drafts', 0);

    const snapshot = service.snapshot(
      new Date(Date.now() + 70 * 60 * 1_000 + 1),
    );
    expect(snapshot.maxAgeSeconds).toBe(70 * 60);
    expect(snapshot.status).toBe('degraded');
  });

  it('reports pending, healthy, and stale cleanup state without retaining cleanup errors', () => {
    const service = new CleanupHealthService(
      { get: jest.fn().mockReturnValue('60') } as never,
      new WorkCopilotMetricsService(),
    );

    expect(service.snapshot().status).toBe('pending');

    service.recordSuccess('transient_evidence', 2);
    service.recordSuccess('source_change_events', 1);
    service.recordSuccess('deleted_brief_drafts', 0);
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

  // A retention run that refused to delete rows is not a clean run. Reporting
  // it as success would hide the only evidence that a draft with an external
  // write reached the retention window, which the application cannot produce.
  it('degrades a job that skipped rows even though the run succeeded', () => {
    const service = new CleanupHealthService(
      { get: jest.fn().mockReturnValue(undefined) } as never,
      new WorkCopilotMetricsService(),
    );

    service.recordSuccess('transient_evidence', 0);
    service.recordSuccess('source_change_events', 0);
    service.recordSuccess('deleted_brief_drafts', 0, 2);

    const snapshot = service.snapshot();
    expect(snapshot.status).toBe('degraded');
    expect(snapshot.jobs).toContainEqual(
      expect.objectContaining({
        job: 'deleted_brief_drafts',
        status: 'degraded',
        lastSkippedCount: 2,
      }),
    );
  });

  it('registers the retention job so a stopped run is visible', () => {
    const service = new CleanupHealthService(
      { get: jest.fn().mockReturnValue(undefined) } as never,
      new WorkCopilotMetricsService(),
    );

    expect(service.snapshot().jobs.map((job) => job.job)).toContain(
      'deleted_brief_drafts',
    );
  });
});
