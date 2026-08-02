import { LessThanOrEqual, type DataSource, type Repository } from 'typeorm';
import { SourceChangeEvent } from '../webhooks/entities/source-change-event.entity';
import { TransientEvidenceFragment } from '../work-briefs/entities/transient-evidence-fragment.entity';

export type CleanupRunnerJob =
  | 'transient_evidence'
  | 'source_change_events';

export type CleanupRunnerResult = {
  succeeded: boolean;
  jobs: Array<{
    job: CleanupRunnerJob;
    outcome: 'success' | 'failure';
    deletedCount: number;
  }>;
};

type ExpiringRecord = { expiresAt: Date };
type ExpiringRepository = Pick<Repository<ExpiringRecord>, 'delete'>;

/**
 * Performs the TTL deletion work in a short-lived process.  The result is
 * deliberately limited to counts and outcome codes so a cron log cannot
 * expose external source text or database error details.
 */
export async function runExpiredWorkCopilotCleanup(
  dataSource: Pick<DataSource, 'getRepository'>,
  now = new Date(),
): Promise<CleanupRunnerResult> {
  const jobs: Array<[CleanupRunnerJob, ExpiringRepository]> = [
    [
      'transient_evidence',
      dataSource.getRepository(
        TransientEvidenceFragment,
      ) as unknown as ExpiringRepository,
    ],
    [
      'source_change_events',
      dataSource.getRepository(SourceChangeEvent) as unknown as ExpiringRepository,
    ],
  ];
  const results: CleanupRunnerResult['jobs'] = [];

  for (const [job, repository] of jobs) {
    try {
      const result = await repository.delete({
        expiresAt: LessThanOrEqual(now),
      } as never);
      results.push({
        job,
        outcome: 'success',
        deletedCount: result.affected ?? 0,
      });
    } catch {
      results.push({ job, outcome: 'failure', deletedCount: 0 });
    }
  }

  return {
    succeeded: results.every((result) => result.outcome === 'success'),
    jobs: results,
  };
}
