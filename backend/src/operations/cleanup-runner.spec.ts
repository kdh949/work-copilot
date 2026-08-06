import { SourceChangeEvent } from '../webhooks/entities/source-change-event.entity';
import { TransientEvidenceFragment } from '../work-briefs/entities/transient-evidence-fragment.entity';
import { runExpiredWorkCopilotCleanup } from './cleanup-runner';

describe('runExpiredWorkCopilotCleanup', () => {
  const fragmentsRepository = {
    delete: jest.fn(),
  };
  const eventsRepository = {
    delete: jest.fn(),
  };
  const retentionManager = {
    query: jest.fn(),
    getRepository: jest.fn(),
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === TransientEvidenceFragment) return fragmentsRepository;
      if (entity === SourceChangeEvent) return eventsRepository;
      throw new Error('unregistered entity');
    }),
    transaction: jest.fn(
      async (callback: (manager: typeof retentionManager) => unknown) =>
        callback(retentionManager),
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    retentionManager.query.mockImplementation((statement: string) => {
      if (statement.includes('pg_try_advisory_xact_lock')) {
        return Promise.resolve([{ locked: true }]);
      }
      if (statement.includes('SELECT draft."id"')) return Promise.resolve([]);
      if (statement.includes('COUNT(*)::int'))
        return Promise.resolve([{ count: 0 }]);
      return Promise.reject(new Error(`Unexpected query: ${statement}`));
    });
  });

  it('purges both TTL tables and the retention table, reporting only safe job metadata', async () => {
    fragmentsRepository.delete.mockResolvedValue({ affected: 3 });
    eventsRepository.delete.mockResolvedValue({ affected: 5 });

    await expect(
      runExpiredWorkCopilotCleanup(dataSource as never),
    ).resolves.toEqual({
      succeeded: true,
      jobs: [
        {
          job: 'transient_evidence',
          outcome: 'success',
          deletedCount: 3,
          skippedCount: 0,
        },
        {
          job: 'source_change_events',
          outcome: 'success',
          deletedCount: 5,
          skippedCount: 0,
        },
        {
          job: 'deleted_brief_drafts',
          outcome: 'success',
          deletedCount: 0,
          skippedCount: 0,
        },
      ],
    });
  });

  // The retention job needs a transaction-capable data source rather than
  // independently injected repositories. Missing that capability fails only
  // in the standalone cron process, where nobody is watching.
  it('runs retention through the shared transaction boundary', async () => {
    fragmentsRepository.delete.mockResolvedValue({ affected: 0 });
    eventsRepository.delete.mockResolvedValue({ affected: 0 });

    const result = await runExpiredWorkCopilotCleanup(dataSource as never);

    expect(result.succeeded).toBe(true);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(dataSource.getRepository).toHaveBeenCalledWith(
      TransientEvidenceFragment,
    );
    expect(dataSource.getRepository).toHaveBeenCalledWith(SourceChangeEvent);
  });

  it('uses the configured retention window when computing the cutoff', async () => {
    fragmentsRepository.delete.mockResolvedValue({ affected: 0 });
    eventsRepository.delete.mockResolvedValue({ affected: 0 });

    await runExpiredWorkCopilotCleanup(
      dataSource as never,
      new Date('2026-08-06T00:00:00.000Z'),
      { WORK_BRIEF_DRAFT_RETENTION_DAYS: '30' },
    );

    const [, params] = retentionManager.query.mock.calls.find(
      ([statement]: [string]) => statement.includes('SELECT draft."id"'),
    ) as [string, [Date, number]];
    expect(params).toEqual([new Date('2026-07-07T00:00:00.000Z'), 200]);
  });

  it('keeps the TTL jobs succeeding when the retention job fails', async () => {
    fragmentsRepository.delete.mockResolvedValue({ affected: 1 });
    eventsRepository.delete.mockResolvedValue({ affected: 1 });
    retentionManager.query.mockRejectedValue(
      new Error('brief content must never be logged'),
    );

    const result = await runExpiredWorkCopilotCleanup(dataSource as never);

    expect(result.succeeded).toBe(false);
    expect(result.jobs).toContainEqual({
      job: 'deleted_brief_drafts',
      outcome: 'failure',
      deletedCount: 0,
      skippedCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain('brief content');
  });

  it('fails the cron run without serializing a database error', async () => {
    fragmentsRepository.delete.mockRejectedValue(
      new Error('raw source evidence must never be logged'),
    );
    eventsRepository.delete.mockResolvedValue({ affected: 1 });

    const result = await runExpiredWorkCopilotCleanup(dataSource as never);

    expect(result.succeeded).toBe(false);
    expect(result.jobs).toContainEqual({
      job: 'transient_evidence',
      outcome: 'failure',
      deletedCount: 0,
      skippedCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain('raw source evidence');
  });
});
