import { BriefPublication } from '../publications/entities/brief-publication.entity';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import {
  DEFAULT_BRIEF_DRAFT_RETENTION_DAYS,
  briefDraftRetentionCutoff,
  briefDraftRetentionDays,
  purgeDeletedBriefDrafts,
} from './deleted-brief-draft-cleanup';

const NOW = new Date('2026-08-06T00:00:00.000Z');

type PurgeHarnessOptions = {
  removable?: Array<{ id: string }>;
  blockedCount?: number | string;
  lockAcquired?: boolean;
  draftDeleteError?: Error;
};

const createPurgeHarness = ({
  removable = [],
  blockedCount = 0,
  lockAcquired = true,
  draftDeleteError,
}: PurgeHarnessOptions = {}) => {
  const order: string[] = [];
  const publicationsRepository = {
    delete: jest.fn().mockImplementation(async () => {
      order.push('publications');
      return { affected: removable.length };
    }),
  };
  const draftsRepository = {
    delete: jest.fn().mockImplementation(async () => {
      order.push('drafts');
      if (draftDeleteError) {
        throw draftDeleteError;
      }
      return { affected: removable.length };
    }),
  };
  const manager = {
    query: jest.fn((statement: string) => {
      if (statement.includes('pg_try_advisory_xact_lock')) {
        return Promise.resolve([{ locked: lockAcquired }]);
      }
      if (statement.includes('SELECT draft."id"')) {
        return Promise.resolve(removable);
      }
      if (statement.includes('COUNT(*)::int')) {
        return Promise.resolve([{ count: blockedCount }]);
      }
      return Promise.reject(new Error(`Unexpected query: ${statement}`));
    }),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === BriefPublication) return publicationsRepository;
      if (entity === WorkBriefDraft) return draftsRepository;
      throw new Error('Unregistered entity');
    }),
  };
  const dataSource = {
    transaction: jest.fn(
      async (callback: (transactionManager: typeof manager) => unknown) =>
        callback(manager),
    ),
  };

  return {
    dataSource,
    draftsRepository,
    manager,
    order,
    publicationsRepository,
  };
};

describe('briefDraftRetentionDays', () => {
  it('falls back to 90 days for anything not a usable whole number of days', () => {
    for (const value of [undefined, '', 'ninety', '0', '-1', '9.5', '400']) {
      expect(briefDraftRetentionDays(value)).toBe(
        DEFAULT_BRIEF_DRAFT_RETENTION_DAYS,
      );
    }
    expect(briefDraftRetentionDays('30')).toBe(30);
  });

  it('computes the cutoff behind the current time', () => {
    expect(briefDraftRetentionCutoff(90, NOW).toISOString()).toBe(
      '2026-05-08T00:00:00.000Z',
    );
  });
});

describe('purgeDeletedBriefDrafts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses a transaction lock and deterministically selects only removable soft-deleted rows', async () => {
    const { dataSource, draftsRepository, manager, publicationsRepository } =
      createPurgeHarness();

    await expect(
      purgeDeletedBriefDrafts(dataSource as never, NOW),
    ).resolves.toEqual({
      deletedCount: 0,
      skippedCount: 0,
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.query.mock.calls[0]).toEqual([
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS "locked"',
      ['work-copilot:deleted-brief-draft-cleanup'],
    ]);
    const [selection, selectionParams] = manager.query.mock.calls.find(
      ([statement]: [string]) => statement.includes('SELECT draft."id"'),
    ) as [string, [Date, number]];
    expect(selection).toContain('draft."deletedAt" <= $1');
    expect(selection).toContain('NOT EXISTS');
    expect(selection).toContain('PUBLICATION_RECONCILIATION_INDETERMINATE');
    expect(selection).toContain('step."providerObjectId" IS NOT NULL');
    expect(selection).toContain(
      'ORDER BY draft."deletedAt" ASC, draft."id" ASC',
    );
    expect(selectionParams).toEqual([NOW, 200]);
    expect(publicationsRepository.delete).not.toHaveBeenCalled();
    expect(draftsRepository.delete).not.toHaveBeenCalled();
  });

  it('does not let retained drafts starve a later removable draft', async () => {
    const { dataSource, draftsRepository, publicationsRepository } =
      createPurgeHarness({
        removable: [{ id: 'draft-201' }],
        blockedCount: 200,
      });

    await expect(
      purgeDeletedBriefDrafts(dataSource as never, NOW),
    ).resolves.toEqual({
      deletedCount: 1,
      skippedCount: 200,
    });
    expect(publicationsRepository.delete).toHaveBeenCalledTimes(1);
    expect(draftsRepository.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes publications before drafts inside the same transaction', async () => {
    const { dataSource, order } = createPurgeHarness({
      removable: [{ id: 'draft-1' }],
      blockedCount: '2',
    });

    await expect(
      purgeDeletedBriefDrafts(dataSource as never, NOW),
    ).resolves.toEqual({
      deletedCount: 1,
      skippedCount: 2,
    });
    expect(order).toEqual(['publications', 'drafts']);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('rolls the transaction back when the draft delete fails after publication deletion', async () => {
    const { dataSource, order } = createPurgeHarness({
      removable: [{ id: 'draft-1' }],
      draftDeleteError: new Error('draft delete failed'),
    });

    await expect(
      purgeDeletedBriefDrafts(dataSource as never, NOW),
    ).rejects.toThrow('draft delete failed');
    // TypeORM rolls the surrounding transaction back after the callback
    // rejects; this asserts both deletes are inside that one callback.
    expect(order).toEqual(['publications', 'drafts']);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('leaves the run empty when another cleanup process owns the advisory lock', async () => {
    const { dataSource, draftsRepository, manager, publicationsRepository } =
      createPurgeHarness({ lockAcquired: false });

    await expect(
      purgeDeletedBriefDrafts(dataSource as never, NOW),
    ).resolves.toEqual({
      deletedCount: 0,
      skippedCount: 0,
    });
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(publicationsRepository.delete).not.toHaveBeenCalled();
    expect(draftsRepository.delete).not.toHaveBeenCalled();
  });

  it('never carries brief content in its result', async () => {
    const { dataSource } = createPurgeHarness({
      removable: [{ id: 'draft-1' }],
    });

    const result = await purgeDeletedBriefDrafts(dataSource as never, NOW);

    expect(Object.keys(result).sort()).toEqual([
      'deletedCount',
      'skippedCount',
    ]);
  });
});
