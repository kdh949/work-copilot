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
  const dataSource = {
    getRepository: jest.fn((entity: unknown) =>
      entity === TransientEvidenceFragment
        ? fragmentsRepository
        : eventsRepository,
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('purges both TTL tables and reports only safe job metadata', async () => {
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
        },
        {
          job: 'source_change_events',
          outcome: 'success',
          deletedCount: 5,
        },
      ],
    });
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
    });
    expect(JSON.stringify(result)).not.toContain('raw source evidence');
  });
});
