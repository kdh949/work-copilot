import { BriefPublication } from '../publications/entities/brief-publication.entity';
import { SourceChangeEvent } from '../webhooks/entities/source-change-event.entity';
import { TransientEvidenceFragment } from '../work-briefs/entities/transient-evidence-fragment.entity';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { runExpiredWorkCopilotCleanup } from './cleanup-runner';

describe('runExpiredWorkCopilotCleanup', () => {
  const fragmentsRepository = {
    delete: jest.fn(),
  };
  const eventsRepository = {
    delete: jest.fn(),
  };
  const draftsRepository = {
    find: jest.fn(),
    delete: jest.fn(),
  };
  const publicationsRepository = {
    find: jest.fn(),
    delete: jest.fn(),
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === TransientEvidenceFragment) return fragmentsRepository;
      if (entity === SourceChangeEvent) return eventsRepository;
      if (entity === WorkBriefDraft) return draftsRepository;
      if (entity === BriefPublication) return publicationsRepository;
      throw new Error('unregistered entity');
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    draftsRepository.find.mockResolvedValue([]);
    publicationsRepository.find.mockResolvedValue([]);
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

  // The retention job needs entities the TTL jobs never asked for. Missing one
  // fails at runtime in a cron process, where nobody is watching.
  it('asks only for entities the cleanup process registers', async () => {
    fragmentsRepository.delete.mockResolvedValue({ affected: 0 });
    eventsRepository.delete.mockResolvedValue({ affected: 0 });

    const result = await runExpiredWorkCopilotCleanup(dataSource as never);

    expect(result.succeeded).toBe(true);
    expect(dataSource.getRepository).toHaveBeenCalledWith(WorkBriefDraft);
    expect(dataSource.getRepository).toHaveBeenCalledWith(BriefPublication);
  });

  it('uses the configured retention window when computing the cutoff', async () => {
    fragmentsRepository.delete.mockResolvedValue({ affected: 0 });
    eventsRepository.delete.mockResolvedValue({ affected: 0 });

    await runExpiredWorkCopilotCleanup(
      dataSource as never,
      new Date('2026-08-06T00:00:00.000Z'),
      { WORK_BRIEF_DRAFT_RETENTION_DAYS: '30' },
    );

    const [criteria] = draftsRepository.find.mock.calls[0] as [
      { where: { deletedAt: { _value: Date } } },
    ];
    expect(criteria.where.deletedAt._value.toISOString()).toBe(
      '2026-07-07T00:00:00.000Z',
    );
  });

  it('keeps the TTL jobs succeeding when the retention job fails', async () => {
    fragmentsRepository.delete.mockResolvedValue({ affected: 1 });
    eventsRepository.delete.mockResolvedValue({ affected: 1 });
    draftsRepository.find.mockRejectedValue(
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
