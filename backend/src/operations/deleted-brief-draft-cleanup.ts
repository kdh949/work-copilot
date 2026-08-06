import { In, LessThanOrEqual, type Repository } from 'typeorm';
import { BriefPublication } from '../publications/entities/brief-publication.entity';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';

export const DEFAULT_BRIEF_DRAFT_RETENTION_DAYS = 90;
const MAX_BRIEF_DRAFT_RETENTION_DAYS = 365;
/** Bounded so one run cannot hold a long transaction over the whole table. */
const MAX_DRAFTS_PER_RUN = 200;

export type DeletedBriefDraftPurgeResult = {
  deletedCount: number;
  /**
   * Soft-deleted drafts left in place because something exists in Atlassian
   * because of them.  A non-zero value is not routine: deletion is refused for
   * exactly those drafts, so reaching this state means a row was changed
   * outside the application.  It must stay visible instead of being purged
   * quietly.
   */
  skippedCount: number;
};

export function briefDraftRetentionDays(
  configured: string | undefined,
): number {
  const parsed = Number(configured);

  return Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_BRIEF_DRAFT_RETENTION_DAYS
    ? parsed
    : DEFAULT_BRIEF_DRAFT_RETENTION_DAYS;
}

export function briefDraftRetentionCutoff(
  retentionDays: number,
  now: Date,
): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000);
}

/**
 * Hard-delete soft-deleted drafts past the retention window.
 *
 * `brief_publications` is ON DELETE RESTRICT, so a draft that was ever
 * published cannot simply be deleted — the FK would fail and take the whole
 * run with it.  The 409 rules on the delete endpoint mean the only
 * publications that can reach this point are mock runs or Confluence attempts
 * that never produced a page, so their rows are removed first (their steps
 * cascade) and the draft follows.  Anything with a real external write is
 * skipped and counted rather than deleted.
 *
 * `readiness_assessments` and `transient_evidence_fragments` cascade.
 */
export async function purgeDeletedBriefDrafts(
  draftsRepository: Pick<Repository<WorkBriefDraft>, 'find' | 'delete'>,
  publicationsRepository: Pick<Repository<BriefPublication>, 'find' | 'delete'>,
  cutoff: Date,
): Promise<DeletedBriefDraftPurgeResult> {
  const expired = await draftsRepository.find({
    // Soft-deleted rows are invisible to `find` unless asked for explicitly,
    // and those are the only rows this job may touch.
    withDeleted: true,
    select: { id: true },
    where: { deletedAt: LessThanOrEqual(cutoff) },
    take: MAX_DRAFTS_PER_RUN,
  });

  if (expired.length === 0) {
    return { deletedCount: 0, skippedCount: 0 };
  }

  const draftIds = expired.map((draft) => draft.id);
  const publications = await publicationsRepository.find({
    select: {
      id: true,
      draftId: true,
      executionMode: true,
      confluenceContentId: true,
    },
    where: { draftId: In(draftIds) },
  });
  const blocked = new Set(
    publications
      .filter(
        (publication) =>
          publication.executionMode === 'real' &&
          Boolean(publication.confluenceContentId),
      )
      .map((publication) => publication.draftId),
  );
  const removable = draftIds.filter((draftId) => !blocked.has(draftId));

  if (removable.length === 0) {
    return { deletedCount: 0, skippedCount: blocked.size };
  }

  await publicationsRepository.delete({ draftId: In(removable) });
  const deleted = await draftsRepository.delete({ id: In(removable) });

  return {
    deletedCount: deleted.affected ?? 0,
    skippedCount: blocked.size,
  };
}
