import { In, type DataSource } from 'typeorm';
import { BriefPublication } from '../publications/entities/brief-publication.entity';
import { publicationBlocksDraftDeletionSql } from '../publications/publication-deletion-safety';
import { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';

export const DEFAULT_BRIEF_DRAFT_RETENTION_DAYS = 90;
const MAX_BRIEF_DRAFT_RETENTION_DAYS = 365;
/** Bounded so one run cannot hold a long transaction over the whole table. */
const MAX_DRAFTS_PER_RUN = 200;
const DELETED_BRIEF_DRAFT_CLEANUP_LOCK =
  'work-copilot:deleted-brief-draft-cleanup';

export type DeletedBriefDraftPurgeResult = {
  deletedCount: number;
  /**
   * Soft-deleted drafts left in place because their stored publication history
   * proves an external write or cannot safely rule one out. A non-zero value
   * is not routine: deletion is refused for exactly those drafts, so reaching
   * this state means a row was changed outside the application. It must stay
   * visible instead of being purged quietly.
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
 * run with it. The 409 rules on the delete endpoint mean the only publication
 * histories that can reach this point have no external write or unresolved
 * step evidence, so their rows are removed first (their steps cascade) and
 * the draft follows. Anything with real, active, or indeterminate publication
 * evidence is skipped and counted rather than deleted.
 *
 * `readiness_assessments` and `transient_evidence_fragments` cascade.
 */
export async function purgeDeletedBriefDrafts(
  dataSource: Pick<DataSource, 'transaction'>,
  cutoff: Date,
): Promise<DeletedBriefDraftPurgeResult> {
  return dataSource.transaction(async (manager) => {
    // Multiple web instances and the standalone cron share this lock. Keeping
    // selection and both DELETEs in this transaction prevents an interleaved
    // job from splitting a publication delete from its draft delete.
    const [lock] = await manager.query<Array<{ locked: boolean }>>(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS "locked"',
      [DELETED_BRIEF_DRAFT_CLEANUP_LOCK],
    );
    if (!lock?.locked) {
      return { deletedCount: 0, skippedCount: 0 };
    }

    const blockingPublication = publicationBlocksDraftDeletionSql();
    // Select removable rows, rather than taking the oldest 200 and then
    // filtering them. Otherwise 200 retained drafts could starve every later
    // removable draft indefinitely. This is the SQL equivalent of the shared
    // API deletion guard, including durable step evidence.
    const removable = await manager.query<Array<{ id: string }>>(
      `SELECT draft."id"
         FROM "work_brief_drafts" draft
        WHERE draft."deletedAt" <= $1
          AND NOT EXISTS (
            SELECT 1
              FROM "brief_publications" publication
              LEFT JOIN "publication_steps" step
                ON step."publicationId" = publication."id"
             WHERE publication."draftId" = draft."id"
               AND (${blockingPublication})
          )
        ORDER BY draft."deletedAt" ASC, draft."id" ASC
        LIMIT $2`,
      [cutoff, MAX_DRAFTS_PER_RUN],
    );
    const [blocked] = await manager.query<Array<{ count: string | number }>>(
      `SELECT COUNT(*)::int AS "count"
         FROM "work_brief_drafts" draft
        WHERE draft."deletedAt" <= $1
          AND EXISTS (
            SELECT 1
              FROM "brief_publications" publication
              LEFT JOIN "publication_steps" step
                ON step."publicationId" = publication."id"
             WHERE publication."draftId" = draft."id"
               AND (${blockingPublication})
          )`,
      [cutoff],
    );
    const skippedCount = Number(blocked?.count ?? 0);

    if (removable.length === 0) {
      return { deletedCount: 0, skippedCount };
    }

    const draftIds = removable.map((draft) => draft.id);
    const publications = manager.getRepository(BriefPublication);
    const drafts = manager.getRepository(WorkBriefDraft);

    // `brief_publications.draftId` is RESTRICT, so delete in this order. The
    // surrounding transaction rolls the publication rows back if the draft
    // delete fails, preserving a retryable, internally consistent state.
    await publications.delete({ draftId: In(draftIds) });
    const deleted = await drafts.delete({ id: In(draftIds) });

    return {
      deletedCount: deleted.affected ?? 0,
      skippedCount,
    };
  });
}
