import { BriefPublication } from '../publications/entities/brief-publication.entity';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { CleanupHealthService } from './cleanup-health.service';
import { DeletedBriefDraftCleanupService } from './deleted-brief-draft-cleanup.service';
import { WorkCopilotMetricsService } from './work-copilot-metrics.service';

const createDataSource = ({
  blockedCount = 0,
  queryError,
}: {
  blockedCount?: number;
  queryError?: Error;
} = {}) => {
  const manager = {
    query: jest.fn((statement: string) => {
      if (queryError) return Promise.reject(queryError);
      if (statement.includes('pg_try_advisory_xact_lock')) {
        return Promise.resolve([{ locked: true }]);
      }
      if (statement.includes('SELECT draft."id"')) return Promise.resolve([]);
      if (statement.includes('COUNT(*)::int')) {
        return Promise.resolve([{ count: blockedCount }]);
      }
      return Promise.reject(new Error(`Unexpected query: ${statement}`));
    }),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === BriefPublication || entity === WorkBriefDraft) {
        return { delete: jest.fn() };
      }
      throw new Error('Unregistered entity');
    }),
  };

  return {
    manager,
    transaction: jest.fn(
      async (callback: (transactionManager: typeof manager) => unknown) =>
        callback(manager),
    ),
  };
};

describe('DeletedBriefDraftCleanupService', () => {
  const createService = (
    dataSource: ReturnType<typeof createDataSource>,
    retentionDays: string | undefined = undefined,
  ) => {
    const cleanupHealth = new CleanupHealthService(
      { get: jest.fn().mockReturnValue(retentionDays) } as never,
      new WorkCopilotMetricsService(),
    );

    return {
      cleanupHealth,
      service: new DeletedBriefDraftCleanupService(
        dataSource as never,
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
    const { service, cleanupHealth } = createService(createDataSource());

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
      createDataSource({
        queryError: new Error('brief content must never be logged'),
      }),
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
      createDataSource({ blockedCount: 1 }),
    );

    await service.purgeExpired();

    expect(jobStatus(cleanupHealth)).toMatchObject({
      status: 'degraded',
      lastSkippedCount: 1,
    });
  });

  it('does not leave a timer running after shutdown', () => {
    const { service } = createService(createDataSource());

    service.onModuleInit();
    service.onModuleDestroy();

    expect(jest.getTimerCount?.() ?? 0).toBe(0);
  });
});
