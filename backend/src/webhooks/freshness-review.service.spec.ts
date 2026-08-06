import { IsNull } from 'typeorm';
import type { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import { FreshnessReviewService } from './freshness-review.service';

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';

const draft = (overrides: Partial<WorkBriefDraft> = {}): WorkBriefDraft =>
  ({
    id: 'draft-1',
    profileId: PROFILE_ID,
    sourceJiraId: '100',
    freshnessStatus: 'current',
    evidence: [
      {
        id: 'confluence:200',
        provider: 'confluence',
        sourceId: '200',
      },
    ],
    ...overrides,
  }) as WorkBriefDraft;

describe('FreshnessReviewService', () => {
  it('marks only matching drafts and their publication metadata for re-review', async () => {
    const jiraDraft = draft();
    const accessChangedDraft = draft({
      id: 'draft-2',
      sourceJiraId: '101',
      freshnessStatus: 'access_changed',
    });
    const unrelated = draft({ id: 'draft-3', sourceJiraId: '999' });
    const draftsRepository = {
      find: jest
        .fn()
        .mockResolvedValue([jiraDraft, accessChangedDraft, unrelated]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const publicationsRepository = {
      update: jest.fn().mockResolvedValue({ affected: 2 }),
    };
    const service = new FreshnessReviewService(
      draftsRepository as never,
      publicationsRepository as never,
    );

    await expect(
      service.markReviewRequired(PROFILE_ID, 'jira', '100'),
    ).resolves.toEqual({ affectedDraftCount: 1 });

    expect(draftsRepository.update).toHaveBeenCalledWith(
      { id: 'draft-1', profileId: PROFILE_ID, deletedAt: IsNull() },
      expect.objectContaining({
        status: 'review_required',
        freshnessStatus: 'review_required',
      }),
    );
    expect(publicationsRepository.update).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(draftsRepository.update.mock.calls)).not.toContain(
      '비공개',
    );
  });

  it('finds matching Confluence evidence and preserves an access-change blocker', async () => {
    const confluenceDraft = draft({ freshnessStatus: 'access_changed' });
    const draftsRepository = {
      find: jest.fn().mockResolvedValue([confluenceDraft]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const publicationsRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const service = new FreshnessReviewService(
      draftsRepository as never,
      publicationsRepository as never,
    );

    await service.markReviewRequired(PROFILE_ID, 'confluence', '200');

    expect(draftsRepository.update).toHaveBeenCalledWith(
      { id: 'draft-1', profileId: PROFILE_ID, deletedAt: IsNull() },
      expect.objectContaining({ freshnessStatus: 'access_changed' }),
    );
  });
});
