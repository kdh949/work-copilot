import { CleanupHealthService } from './cleanup-health.service';
import { DeletedBriefDraftCleanupService } from './deleted-brief-draft-cleanup.service';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

describe('DeletedBriefDraftCleanupService', () => {
  const createService = (
    draftsRepository: Record<string, jest.Mock>,
    publicationsRepository: Record<string, jest.Mock>,
    retentionDays: string | undefined = undefined,
  ) => {
    const cleanupHealth = new CleanupHealthService(
      { get: jest.fn().mockReturnValue(retentionDays) } as never,
      new WorkCopilotMetricsService(),
    );

    return {
      cleanupHealth,
      service: new DeletedBriefDraftCleanupService(
        draftsRepository as never,
        publicationsRepository as never,
        { get: jest.fn().mockReturnValue(retentionDays) } as never,
        cleanupHealth,
      ),
    };
  };

  const jobStatus = (cleanupHealth: CleanupHealthService) =>
    cleanupHealth
      .snapshot()
      .jobs.find((job) => job.job === 'deleted_brief_drafts');

  it('reports a run that deleted nothing as healthy', async () => {
    const { service, cleanupHealth } = createService(
      { find: jest.fn().mockResolvedValue([]), delete: jest.fn() },
      { find: jest.fn(), delete: jest.fn() },
    );

    await service.purgeExpired();

    // Most runs delete nothing. Treating that as a problem would train
    // operators to ignore the signal that matters.
    expect(jobStatus(cleanupHealth)).toMatchObject({
      status: 'healthy',
      lastDeletedCount: 0,
      lastSkippedCount: 0,
    });
  });

  // R13: registering the job is what makes a stopped retention run visible.
  it('reports a failed run without recording a success', async () => {
    const { service, cleanupHealth } = createService(
      {
        find: jest
          .fn()
          .mockRejectedValue(new Error('brief content must never be logged')),
        delete: jest.fn(),
      },
      { find: jest.fn(), delete: jest.fn() },
    );

    await service.purgeExpired();

    const job = jobStatus(cleanupHealth);
    expect(job?.status).toBe('degraded');
    expect(job?.lastSuccessAt).toBeNull();
    expect(JSON.stringify(cleanupHealth.snapshot())).not.toContain(
      'brief content',
    );
  });

  // A skipped draft cannot happen through the application, so it must not be
  // reported as a clean run — this is the only signal that it happened.
  it('degrades the job when a draft was skipped', async () => {
    const { service, cleanupHealth } = createService(
      {
        find: jest.fn().mockResolvedValue([{ id: 'draft-1' }]),
        delete: jest.fn(),
      },
      {
        find: jest.fn().mockResolvedValue([
          {
            id: 'publication-1',
            draftId: 'draft-1',
            executionMode: 'real',
            confluenceContentId: 'confluence-page-1',
          },
        ]),
        delete: jest.fn(),
      },
    );

    await service.purgeExpired();

    expect(jobStatus(cleanupHealth)).toMatchObject({
      status: 'degraded',
      lastSkippedCount: 1,
    });
  });

  it('does not leave a timer running after shutdown', () => {
    const { service } = createService(
      { find: jest.fn().mockResolvedValue([]), delete: jest.fn() },
      { find: jest.fn(), delete: jest.fn() },
    );

    service.onModuleInit();
    service.onModuleDestroy();

    expect(jest.getTimerCount?.() ?? 0).toBe(0);
  });
});
