import {
  DEFAULT_BRIEF_DRAFT_RETENTION_DAYS,
  briefDraftRetentionCutoff,
  briefDraftRetentionDays,
  purgeDeletedBriefDrafts,
} from './deleted-brief-draft-cleanup';

const NOW = new Date('2026-08-06T00:00:00.000Z');

const createRepositories = (
  drafts: Array<{ id: string }>,
  publications: Array<{
    id: string;
    draftId: string;
    executionMode: 'mock' | 'real';
    confluenceContentId: string | null;
  }>,
) => ({
  draftsRepository: {
    find: jest.fn().mockResolvedValue(drafts),
    delete: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ affected: drafts.length })),
  },
  publicationsRepository: {
    find: jest.fn().mockResolvedValue(publications),
    delete: jest.fn().mockResolvedValue({ affected: publications.length }),
  },
});

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

  it('only looks at soft-deleted rows past the cutoff', async () => {
    const { draftsRepository, publicationsRepository } = createRepositories(
      [],
      [],
    );

    await purgeDeletedBriefDrafts(
      draftsRepository,
      publicationsRepository,
      NOW,
    );

    const [criteria] = draftsRepository.find.mock.calls[0] as [
      Record<string, unknown>,
    ];
    // Soft-deleted rows are invisible to `find` by default, so omitting this
    // would silently make the job a no-op forever.
    expect(criteria.withDeleted).toBe(true);
    expect(criteria.where).toHaveProperty('deletedAt');
    expect(publicationsRepository.find).not.toHaveBeenCalled();
    expect(draftsRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes publications before drafts so the RESTRICT foreign key holds', async () => {
    const { draftsRepository, publicationsRepository } = createRepositories(
      [{ id: 'draft-1' }],
      [
        {
          id: 'publication-1',
          draftId: 'draft-1',
          executionMode: 'mock',
          confluenceContentId: null,
        },
      ],
    );
    const order: string[] = [];
    publicationsRepository.delete.mockImplementation(() => {
      order.push('publications');
      return Promise.resolve({ affected: 1 });
    });
    draftsRepository.delete.mockImplementation(() => {
      order.push('drafts');
      return Promise.resolve({ affected: 1 });
    });

    await expect(
      purgeDeletedBriefDrafts(
        draftsRepository as never,
        publicationsRepository as never,
        NOW,
      ),
    ).resolves.toEqual({ deletedCount: 1, skippedCount: 0 });
    expect(order).toEqual(['publications', 'drafts']);
  });

  // R14: brief_publications is ON DELETE RESTRICT. A draft with a real
  // external write must be left alone rather than blowing up the run — and
  // must stay countable, because reaching this state means a row was changed
  // outside the application.
  it('skips and counts a draft that already wrote to Confluence', async () => {
    const { draftsRepository, publicationsRepository } = createRepositories(
      [{ id: 'draft-1' }],
      [
        {
          id: 'publication-1',
          draftId: 'draft-1',
          executionMode: 'real',
          confluenceContentId: 'confluence-page-1',
        },
      ],
    );

    await expect(
      purgeDeletedBriefDrafts(
        draftsRepository as never,
        publicationsRepository as never,
        NOW,
      ),
    ).resolves.toEqual({ deletedCount: 0, skippedCount: 1 });
    expect(publicationsRepository.delete).not.toHaveBeenCalled();
    expect(draftsRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes the removable drafts of a mixed batch and skips the rest', async () => {
    const { draftsRepository, publicationsRepository } = createRepositories(
      [{ id: 'draft-1' }, { id: 'draft-2' }],
      [
        {
          id: 'publication-1',
          draftId: 'draft-1',
          executionMode: 'real',
          confluenceContentId: 'confluence-page-1',
        },
        {
          id: 'publication-2',
          draftId: 'draft-2',
          executionMode: 'real',
          // A Confluence attempt that never produced a page wrote nothing.
          confluenceContentId: null,
        },
      ],
    );
    draftsRepository.delete.mockResolvedValue({ affected: 1 });

    await expect(
      purgeDeletedBriefDrafts(
        draftsRepository as never,
        publicationsRepository as never,
        NOW,
      ),
    ).resolves.toEqual({ deletedCount: 1, skippedCount: 1 });

    const [publicationCriteria] = publicationsRepository.delete.mock
      .calls[0] as [{ draftId: { _value: string[] } }];
    expect(publicationCriteria.draftId._value).toEqual(['draft-2']);
  });

  it('reads publications once for the whole batch', async () => {
    const { draftsRepository, publicationsRepository } = createRepositories(
      [{ id: 'draft-1' }, { id: 'draft-2' }, { id: 'draft-3' }],
      [],
    );

    await purgeDeletedBriefDrafts(
      draftsRepository,
      publicationsRepository,
      NOW,
    );

    expect(publicationsRepository.find).toHaveBeenCalledTimes(1);
    expect(publicationsRepository.delete).toHaveBeenCalledTimes(1);
    expect(draftsRepository.delete).toHaveBeenCalledTimes(1);
  });

  it('never carries brief content in its result', async () => {
    const { draftsRepository, publicationsRepository } = createRepositories(
      [{ id: 'draft-1' }],
      [],
    );

    const result = await purgeDeletedBriefDrafts(
      draftsRepository,
      publicationsRepository,
      NOW,
    );

    expect(Object.keys(result).sort()).toEqual([
      'deletedCount',
      'skippedCount',
    ]);
  });
});
