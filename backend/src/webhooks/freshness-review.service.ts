import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { BriefPublication } from '../publications/entities/brief-publication.entity';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import type { SourceChangeProvider } from './entities/source-change-event.entity';

export type FreshnessReviewResult = {
  affectedDraftCount: number;
};

@Injectable()
export class FreshnessReviewService {
  constructor(
    @InjectRepository(WorkBriefDraft)
    private readonly draftsRepository: Repository<WorkBriefDraft>,
    @InjectRepository(BriefPublication)
    private readonly publicationsRepository: Repository<BriefPublication>,
  ) {}

  async markReviewRequired(
    profileId: string,
    provider: SourceChangeProvider,
    sourceId: string,
  ): Promise<FreshnessReviewResult> {
    const drafts = await this.draftsRepository.find({
      select: {
        id: true,
        profileId: true,
        sourceJiraId: true,
        freshnessStatus: true,
        evidence: true,
      },
      where: { profileId },
    });
    const affectedDrafts = drafts.filter((draft) =>
      this.referencesSource(draft, provider, sourceId),
    );
    const now = new Date();

    for (const draft of affectedDrafts) {
      await this.draftsRepository.update(
        // `find()` above already excludes soft-deleted drafts, but `update()`
        // does not apply that filter on its own — keep it explicit.
        { id: draft.id, profileId, deletedAt: IsNull() },
        {
          status: 'review_required',
          freshnessStatus:
            draft.freshnessStatus === 'access_changed'
              ? 'access_changed'
              : 'review_required',
          optimisticVersion: () => '"optimisticVersion" + 1',
          updatedAt: now,
        },
      );
    }

    if (affectedDrafts.length > 0) {
      await this.publicationsRepository.update(
        { draftId: In(affectedDrafts.map((draft) => draft.id)) },
        { reviewRequiredAt: now, updatedAt: now },
      );
    }

    return { affectedDraftCount: affectedDrafts.length };
  }

  private referencesSource(
    draft: Pick<WorkBriefDraft, 'sourceJiraId' | 'evidence'>,
    provider: SourceChangeProvider,
    sourceId: string,
  ): boolean {
    if (provider === 'jira' && draft.sourceJiraId === sourceId) {
      return true;
    }

    return draft.evidence.some(
      (evidence) =>
        evidence.provider === provider && evidence.sourceId === sourceId,
    );
  }
}
