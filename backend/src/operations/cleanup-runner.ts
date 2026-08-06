import { LessThanOrEqual, type DataSource, type Repository } from 'typeorm';
import { SourceChangeEvent } from '../webhooks/entities/source-change-event.entity';
import { TransientEvidenceFragment } from '../work-briefs/entities/transient-evidence-fragment.entity';
import {
  briefDraftRetentionCutoff,
  briefDraftRetentionDays,
  purgeDeletedBriefDrafts,
} from './deleted-brief-draft-cleanup';

export type CleanupRunnerJob =
  'transient_evidence' | 'source_change_events' | 'deleted_brief_drafts';

export type CleanupRunnerResult = {
  succeeded: boolean;
  jobs: Array<{
    job: CleanupRunnerJob;
    outcome: 'success' | 'failure';
    deletedCount: number;
    /** Rows the retention job refused to delete. See the runner's own docs. */
    skippedCount: number;
  }>;
};

type ExpiringRecord = { expiresAt: Date };
type ExpiringRepository = Pick<Repository<ExpiringRecord>, 'delete'>;

/**
 * Performs the TTL deletion work in a short-lived process.  The result is
 * deliberately limited to counts and outcome codes so a cron log cannot
 * expose external source text or database error details.
 *
 * The two TTL jobs delete on `expiresAt <= now`.  Deleted brief drafts do not
 * fit that shape — they expire relative to when the user deleted them and
 * their rows are referenced by a RESTRICT foreign key — so they run through a
 * separate branch instead of being forced into the same predicate.
 */
export async function runExpiredWorkCopilotCleanup(
  dataSource: Pick<DataSource, 'getRepository' | 'transaction'>,
  now = new Date(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CleanupRunnerResult> {
  const jobs: Array<[CleanupRunnerJob, ExpiringRepository]> = [
    ['transient_evidence', dataSource.getRepository(TransientEvidenceFragment)],
    ['source_change_events', dataSource.getRepository(SourceChangeEvent)],
  ];
  const results: CleanupRunnerResult['jobs'] = [];

  for (const [job, repository] of jobs) {
    try {
      const result = await repository.delete({
        expiresAt: LessThanOrEqual(now),
      });
      results.push({
        job,
        outcome: 'success',
        deletedCount: result.affected ?? 0,
        skippedCount: 0,
      });
    } catch {
      results.push({
        job,
        outcome: 'failure',
        deletedCount: 0,
        skippedCount: 0,
      });
    }
  }

  try {
    const retention = await purgeDeletedBriefDrafts(
      dataSource,
      briefDraftRetentionCutoff(
        briefDraftRetentionDays(environment.WORK_BRIEF_DRAFT_RETENTION_DAYS),
        now,
      ),
    );
    results.push({
      job: 'deleted_brief_drafts',
      outcome: 'success',
      deletedCount: retention.deletedCount,
      skippedCount: retention.skippedCount,
    });
  } catch {
    results.push({
      job: 'deleted_brief_drafts',
      outcome: 'failure',
      deletedCount: 0,
      skippedCount: 0,
    });
  }

  return {
    succeeded: results.every((result) => result.outcome === 'success'),
    jobs: results,
  };
}
